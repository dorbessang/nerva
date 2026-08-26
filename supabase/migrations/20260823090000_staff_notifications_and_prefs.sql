-- Dos bugs reales encontrados por el usuario tras probar el sistema de
-- soporte de staff:
--   1. Las notificaciones de acceso de soporte / solicitudes de staff
--      (claim_access_grant, revoke_access_grant, request/approve/reject_
--      staff_action) se insertaban sin respetar notification_preferences
--      -- a diferencia de TODO el resto de la app (ver src/lib/
--      notifications.js, isNotificationEnabled), no había forma de
--      apagarlas.
--   2. No es directamente que "no generen notificaciones" -- el bug real
--      es de NotificationBell.jsx (arreglado aparte, sin SQL): filtraba
--      por el workspace activo, así que una notificación sobre un
--      workspace distinto al que tenías abierto en ese momento (el caso
--      típico del staff, casi siempre en un workspace de cliente
--      distinto del propio) nunca se veía.
-- Acá se soluciona el primero + se deja un helper único para no repetir
-- la lógica de gating en cada función.
create or replace function public.notify_if_enabled(
  p_workspace_id uuid, p_user_id uuid, p_type text, p_title text, p_body text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if p_user_id is null then return; end if;
  if exists (
    select 1 from notification_preferences
    where user_id = p_user_id and workspace_id = p_workspace_id and type = p_type and enabled = false
  ) then
    return;
  end if;
  insert into notifications (workspace_id, user_id, type, title, body)
  values (p_workspace_id, p_user_id, p_type, p_title, p_body);
end;
$function$;

create or replace function public.claim_access_grant(p_code text)
returns public.access_grants
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_grant access_grants;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_staff = true) then
    raise exception 'Solo el staff puede tomar un código de acceso';
  end if;

  select * into v_grant from access_grants where code = upper(trim(p_code)) and status = 'open';
  if v_grant.id is null then
    raise exception 'Código inválido o ya usado';
  end if;

  update access_grants
  set status = 'pending_confirmation', claimed_by = auth.uid(), claimed_at = now()
  where id = v_grant.id
  returning * into v_grant;

  perform notify_if_enabled(
    v_grant.workspace_id, v_grant.created_by, 'access_grant_pending_confirmation',
    'Confirmación de acceso necesaria',
    (select coalesce(full_name, email) from profiles where id = auth.uid()) || ' está esperando que confirmes su ingreso ahora.'
  );

  return v_grant;
end;
$function$;

-- El overload viejo de 1 solo parámetro quedó vivo desde la migración
-- original (create or replace con una firma distinta no reemplaza, crea
-- otro overload) -- no lo usa nada del frontend (siempre se manda
-- p_message), lo borramos para no dejar dos versiones con reglas
-- distintas (la vieja no dejaba que el propio staff cerrara su acceso).
drop function if exists public.revoke_access_grant(uuid);

create or replace function public.revoke_access_grant(p_grant_id uuid, p_message text default null)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_grant access_grants;
  v_is_workspace_admin boolean;
begin
  select * into v_grant from access_grants where id = p_grant_id and status = 'active';
  if v_grant.id is null then
    raise exception 'No hay ningún acceso activo con ese id';
  end if;

  select exists(
    select 1 from workspace_members
    where workspace_id = v_grant.workspace_id and user_id = auth.uid()
      and role in ('owner','admin') and status = 'active'
  ) into v_is_workspace_admin;

  if not v_is_workspace_admin and v_grant.claimed_by is distinct from auth.uid() then
    raise exception 'No tenés permisos para revocar este acceso';
  end if;

  delete from workspace_members where workspace_id = v_grant.workspace_id and user_id = v_grant.claimed_by;
  update access_grants
  set status = 'revoked', revoked_by = auth.uid(), revoked_at = now(), resolution_message = p_message
  where id = p_grant_id;

  if v_grant.created_by is not null and v_grant.created_by is distinct from auth.uid() then
    perform notify_if_enabled(
      v_grant.workspace_id, v_grant.created_by, 'access_grant_closed',
      'Acceso de soporte finalizado',
      coalesce(p_message, 'El acceso de soporte se cerró sin comentarios.')
    );
  end if;
end;
$function$;

create or replace function public.request_staff_action(p_workspace_id uuid, p_action_type text, p_payload jsonb)
returns public.staff_action_requests
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_req staff_action_requests;
  v_owner record;
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

  for v_owner in
    select user_id from workspace_members
    where workspace_id = p_workspace_id and role = 'owner' and status = 'active'
  loop
    perform notify_if_enabled(
      p_workspace_id, v_owner.user_id, 'staff_action_requested',
      'Solicitud de staff pendiente',
      coalesce((select full_name from profiles where id = auth.uid()), 'Alguien del staff') || ' pidió autorización: ' || coalesce(p_payload->>'description', p_action_type)
    );
  end loop;

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
    perform notify_if_enabled(
      v_req.workspace_id, v_req.requested_by, 'staff_action_resolved',
      'Tu solicitud fue aprobada',
      'El owner aprobó tu pedido y ya se ejecutó: ' || coalesce(v_req.payload->>'description', v_req.action_type)
    );
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
    perform notify_if_enabled(
      v_req.workspace_id, v_req.requested_by, 'staff_action_resolved',
      'Tu solicitud fue rechazada',
      coalesce(p_message, 'El owner rechazó tu pedido: ' || coalesce(v_req.payload->>'description', v_req.action_type))
    );
  end if;
end;
$function$;
