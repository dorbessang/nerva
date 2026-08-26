-- "Solicitud de acción de staff por encima de su rol real" (ver
-- PENDIENTES.md). El staff puede seguir VIENDO cualquier rol sin límite
-- (RoleImpersonator no tiene techo, a propósito) -- la restricción real
-- está acá: si actúa con un privilegio por encima de su rol real en ese
-- workspace, la acción no se ejecuta directo, queda pendiente hasta que
-- un owner del workspace la aprueba. No aplica a usuarios normales -- un
-- cliente ya ni ve el botón si no tiene el rol (gateado client-side por
-- effectiveRole), esto es exclusivamente para el caso de staff con un
-- acceso de soporte de rol más bajo que el que necesita para una acción puntual.

-- Parte A: alinear RLS con lo que la UI de Proyectos/Entidades/Productos
-- ya asume ("Eliminar" es owner-only) -- hoy la política única "ALL" no
-- distinguía por comando, así que cualquier miembro activo (hasta un
-- viewer) podía borrar por API directa aunque el botón esté escondido.
-- Sin este ajuste, "solicitar aprobación para borrado masivo" no
-- serviría de nada: alcanzaría con pegarle directo a la tabla.
drop policy "crud negotiations in my workspaces" on public.negotiations;
create policy "select negotiations in my workspaces" on public.negotiations for select to public using (workspace_id in (select my_workspace_ids()));
create policy "insert negotiations in my workspaces" on public.negotiations for insert to public with check (workspace_id in (select my_workspace_ids()));
create policy "update negotiations in my workspaces" on public.negotiations for update to public using (workspace_id in (select my_workspace_ids())) with check (workspace_id in (select my_workspace_ids()));
create policy "owner deletes negotiations" on public.negotiations for delete to public using (is_workspace_owner(workspace_id));

drop policy "crud entities in my workspaces" on public.entities;
create policy "select entities in my workspaces" on public.entities for select to public using (workspace_id in (select my_workspace_ids()));
create policy "insert entities in my workspaces" on public.entities for insert to public with check (workspace_id in (select my_workspace_ids()));
create policy "update entities in my workspaces" on public.entities for update to public using (workspace_id in (select my_workspace_ids())) with check (workspace_id in (select my_workspace_ids()));
create policy "owner deletes entities" on public.entities for delete to public using (is_workspace_owner(workspace_id));

drop policy "crud products in my workspaces" on public.products;
create policy "select products in my workspaces" on public.products for select to public using (workspace_id in (select my_workspace_ids()));
create policy "insert products in my workspaces" on public.products for insert to public with check (workspace_id in (select my_workspace_ids()));
create policy "update products in my workspaces" on public.products for update to public using (workspace_id in (select my_workspace_ids())) with check (workspace_id in (select my_workspace_ids()));
create policy "owner deletes products" on public.products for delete to public using (is_workspace_owner(workspace_id));

-- Parte B: la cola de solicitudes en sí.
create table public.staff_action_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  action_type text not null check (action_type in (
    'invite_member', 'change_member_role', 'toggle_member_status', 'remove_member',
    'bulk_delete_negotiations', 'bulk_delete_entities', 'bulk_delete_products',
    'update_inactivity_alerts', 'update_approval_rules'
  )),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  resolution_message text,
  created_at timestamptz not null default now()
);

alter table public.staff_action_requests enable row level security;

create policy "workspace owners view requests of their workspace"
on public.staff_action_requests for select to public
using (is_workspace_owner(workspace_id));

create policy "staff views own requests"
on public.staff_action_requests for select to public
using (requested_by = auth.uid());

-- Sin policies de insert/update directas -- todo pasa por las funciones
-- de abajo, mismo criterio que access_grants.

create or replace function public.request_staff_action(p_workspace_id uuid, p_action_type text, p_payload jsonb)
returns public.staff_action_requests
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_req staff_action_requests;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_staff = true) then
    raise exception 'Solo el staff puede pedir esto';
  end if;
  if not exists (select 1 from workspace_members where workspace_id = p_workspace_id and user_id = auth.uid() and status = 'active') then
    raise exception 'No sos miembro de ese workspace';
  end if;

  insert into staff_action_requests (workspace_id, requested_by, action_type, payload)
  values (p_workspace_id, auth.uid(), p_action_type, p_payload)
  returning * into v_req;

  insert into notifications (workspace_id, user_id, type, title, body)
  select
    p_workspace_id, wm.user_id, 'staff_action_requested',
    'Solicitud de staff pendiente',
    coalesce((select full_name from profiles where id = auth.uid()), 'Alguien del staff') || ' pidió autorización: ' || coalesce(p_payload->>'description', p_action_type)
  from workspace_members wm
  where wm.workspace_id = p_workspace_id and wm.role = 'owner' and wm.status = 'active';

  return v_req;
end;
$function$;

create or replace function public.approve_staff_action(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_req staff_action_requests;
  v_ids uuid[];
begin
  select * into v_req from staff_action_requests where id = p_request_id and status = 'pending';
  if v_req.id is null then
    raise exception 'No hay ninguna solicitud pendiente con ese id';
  end if;
  if not is_workspace_owner(v_req.workspace_id) then
    raise exception 'Solo el owner puede aprobar esto';
  end if;
  if v_req.action_type = 'invite_member' then
    raise exception 'Esta solicitud se aprueba desde la invitación, no acá';
  end if;

  if v_req.action_type = 'change_member_role' then
    update workspace_members set role = v_req.payload->>'new_role'
    where workspace_id = v_req.workspace_id and user_id = (v_req.payload->>'user_id')::uuid;

  elsif v_req.action_type = 'toggle_member_status' then
    update workspace_members set status = v_req.payload->>'new_status'
    where workspace_id = v_req.workspace_id and user_id = (v_req.payload->>'user_id')::uuid;

  elsif v_req.action_type = 'remove_member' then
    delete from workspace_members
    where workspace_id = v_req.workspace_id and user_id = (v_req.payload->>'user_id')::uuid;

  elsif v_req.action_type = 'bulk_delete_negotiations' then
    select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(v_req.payload->'ids');
    delete from negotiations where workspace_id = v_req.workspace_id and id = any(v_ids);

  elsif v_req.action_type = 'bulk_delete_entities' then
    select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(v_req.payload->'ids');
    delete from entities where workspace_id = v_req.workspace_id and id = any(v_ids);

  elsif v_req.action_type = 'bulk_delete_products' then
    select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(v_req.payload->'ids');
    delete from products where workspace_id = v_req.workspace_id and id = any(v_ids);

  elsif v_req.action_type = 'update_inactivity_alerts' then
    update workspaces set
      low_activity_alert_days = (v_req.payload->>'low_activity_alert_days')::int,
      low_activity_inactive_days = (v_req.payload->>'low_activity_inactive_days')::int
    where id = v_req.workspace_id;

  elsif v_req.action_type = 'update_approval_rules' then
    insert into approval_rules (workspace_id, rule_type, enabled, approver_id, threshold_numeric, updated_at)
    select
      v_req.workspace_id,
      r->>'rule_type',
      (r->>'enabled')::boolean,
      nullif(r->>'approver_id', '')::uuid,
      nullif(r->>'threshold_numeric', '')::numeric,
      now()
    from jsonb_array_elements(v_req.payload->'rules') as r
    on conflict (workspace_id, rule_type) do update set
      enabled = excluded.enabled,
      approver_id = excluded.approver_id,
      threshold_numeric = excluded.threshold_numeric,
      updated_at = excluded.updated_at;
  end if;

  update staff_action_requests set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now() where id = p_request_id;

  if v_req.requested_by is not null then
    insert into notifications (workspace_id, user_id, type, title, body)
    values (v_req.workspace_id, v_req.requested_by, 'staff_action_resolved', 'Tu solicitud fue aprobada', 'El owner aprobó tu pedido y ya se ejecutó: ' || coalesce(v_req.payload->>'description', v_req.action_type));
  end if;
end;
$function$;

create or replace function public.reject_staff_action(p_request_id uuid, p_message text default null)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_req staff_action_requests;
begin
  select * into v_req from staff_action_requests where id = p_request_id and status = 'pending';
  if v_req.id is null then
    raise exception 'No hay ninguna solicitud pendiente con ese id';
  end if;
  if not is_workspace_owner(v_req.workspace_id) then
    raise exception 'Solo el owner puede rechazar esto';
  end if;

  update staff_action_requests set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), resolution_message = p_message where id = p_request_id;

  if v_req.requested_by is not null then
    insert into notifications (workspace_id, user_id, type, title, body)
    values (v_req.workspace_id, v_req.requested_by, 'staff_action_resolved', 'Tu solicitud fue rechazada', coalesce(p_message, 'El owner rechazó tu pedido: ' || coalesce(v_req.payload->>'description', v_req.action_type)));
  end if;
end;
$function$;

-- El staff puede retirar un pedido propio que todavía nadie resolvió.
create or replace function public.cancel_staff_action_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  update staff_action_requests
  set status = 'cancelled'
  where id = p_request_id and status = 'pending' and requested_by = auth.uid();
end;
$function$;
