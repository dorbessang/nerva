-- Núcleo del Acceso de Soporte para Staff (ver PENDIENTES.md) — siempre
-- por código, con dos formas de que ese código llegue al staff:
--   is_ticket = true  → aparece en la cola compartida de Staff (con el
--                        problema descripto), cualquiera lo puede tomar
--   is_ticket = false → el owner/admin genera el código y se lo pasa
--                        directo a alguien del staff por fuera de la app
-- En ambos casos, tomar el código NO da acceso — pasa a
-- "pending_confirmation" y alguien del workspace tiene que confirmar
-- activamente en ese momento antes de que se cree la membership real.
--
-- Las transiciones sensibles van por funciones SECURITY DEFINER (no
-- updates directos desde el cliente) — mismo criterio que ya se usa para
-- otras acciones delicadas (invite-user), acá resuelto 100% en Postgres
-- porque no hace falta nada que solo una Edge Function pueda hacer.
create table public.access_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code text not null unique,
  is_ticket boolean not null default false,
  problem_description text,
  role text not null check (role in ('owner','admin','editor','viewer')),
  duration_hours integer, -- null = "ilimitado" (igual se cappea a 30 días al confirmar)
  status text not null default 'open' check (status in ('open','pending_confirmation','active','expired','revoked','declined','cancelled')),
  created_by uuid references public.profiles(id) on delete set null,
  claimed_by uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  expires_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.access_grants enable row level security;

-- Lectura: cualquier miembro del workspace ve los grants de SU workspace
-- (para gestionarlos), y cualquier is_staff ve la cola pública de tickets
-- abiertos de CUALQUIER workspace (para poder tomarlos) + lo que ya tomó.
create policy "workspace members view own grants"
on public.access_grants for select to public
using (workspace_id in (select my_workspace_ids()));

create policy "staff view open tickets and own claims"
on public.access_grants for select to public
using (
  exists (select 1 from profiles where id = auth.uid() and is_staff = true)
  and (
    (is_ticket = true and status = 'open')
    or claimed_by = auth.uid()
  )
);

-- No hay policies de insert/update directas a propósito — todo pasa por
-- las funciones de abajo, que validan cada transición.

create or replace function public.generate_access_code()
returns text
language sql
as $function$
  select upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
$function$;

create or replace function public.create_access_grant(
  p_workspace_id uuid, p_role text, p_duration_hours integer,
  p_is_ticket boolean, p_problem_description text
)
returns public.access_grants
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_grant access_grants;
  v_code text;
begin
  if not exists (
    select 1 from workspace_members
    where workspace_id = p_workspace_id and user_id = auth.uid()
      and role in ('owner','admin') and status = 'active'
  ) then
    raise exception 'Solo el owner o un admin puede generar un código de acceso';
  end if;

  loop
    v_code := generate_access_code();
    exit when not exists (select 1 from access_grants where code = v_code);
  end loop;

  insert into access_grants (workspace_id, code, is_ticket, problem_description, role, duration_hours, created_by)
  values (p_workspace_id, v_code, coalesce(p_is_ticket, false), p_problem_description, p_role, p_duration_hours, auth.uid())
  returning * into v_grant;

  return v_grant;
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

  if v_grant.created_by is not null then
    insert into notifications (workspace_id, user_id, type, title, body)
    values (
      v_grant.workspace_id, v_grant.created_by, 'access_grant_pending_confirmation',
      'Confirmación de acceso necesaria',
      (select coalesce(full_name, email) from profiles where id = auth.uid()) || ' está esperando que confirmes su ingreso ahora.'
    );
  end if;

  return v_grant;
end;
$function$;

create or replace function public.confirm_access_grant(p_grant_id uuid)
returns public.access_grants
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_grant access_grants;
  v_expires timestamptz;
begin
  select * into v_grant from access_grants where id = p_grant_id and status = 'pending_confirmation';
  if v_grant.id is null then
    raise exception 'No hay ningún acceso pendiente de confirmación con ese id';
  end if;

  if not exists (
    select 1 from workspace_members
    where workspace_id = v_grant.workspace_id and user_id = auth.uid()
      and role in ('owner','admin') and status = 'active'
  ) then
    raise exception 'Solo el owner o un admin puede confirmar el acceso';
  end if;

  v_expires := case
    when v_grant.duration_hours is null then now() + interval '30 days'
    else now() + make_interval(hours => least(v_grant.duration_hours, 30 * 24))
  end;

  insert into workspace_members (workspace_id, user_id, role, status)
  values (v_grant.workspace_id, v_grant.claimed_by, v_grant.role, 'active')
  on conflict (workspace_id, user_id) do update set role = excluded.role, status = 'active';

  update access_grants
  set status = 'active', confirmed_by = auth.uid(), confirmed_at = now(), expires_at = v_expires
  where id = v_grant.id
  returning * into v_grant;

  return v_grant;
end;
$function$;

create or replace function public.decline_access_grant(p_grant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_workspace_id uuid;
begin
  select workspace_id into v_workspace_id from access_grants where id = p_grant_id and status = 'pending_confirmation';
  if v_workspace_id is null then
    raise exception 'No hay ningún acceso pendiente de confirmación con ese id';
  end if;
  if not exists (
    select 1 from workspace_members
    where workspace_id = v_workspace_id and user_id = auth.uid()
      and role in ('owner','admin') and status = 'active'
  ) then
    raise exception 'Solo el owner o un admin puede rechazar el acceso';
  end if;

  update access_grants set status = 'declined' where id = p_grant_id;
end;
$function$;

create or replace function public.revoke_access_grant(p_grant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_grant access_grants;
begin
  select * into v_grant from access_grants where id = p_grant_id and status = 'active';
  if v_grant.id is null then
    raise exception 'No hay ningún acceso activo con ese id';
  end if;
  if not exists (
    select 1 from workspace_members
    where workspace_id = v_grant.workspace_id and user_id = auth.uid()
      and role in ('owner','admin') and status = 'active'
  ) then
    raise exception 'Solo el owner o un admin puede revocar el acceso';
  end if;

  delete from workspace_members where workspace_id = v_grant.workspace_id and user_id = v_grant.claimed_by;
  update access_grants set status = 'revoked', revoked_by = auth.uid(), revoked_at = now() where id = p_grant_id;
end;
$function$;

-- Cancela un ticket/código que todavía nadie tomó — lo puede cancelar
-- quien lo creó.
create or replace function public.cancel_access_grant(p_grant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  update access_grants
  set status = 'cancelled'
  where id = p_grant_id and status = 'open' and created_by = auth.uid();
end;
$function$;

-- Barrido de vencimientos — mismo patrón que mark_inactive_negotiations,
-- corre por cron.
create or replace function public.expire_access_grants()
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_grant record;
begin
  for v_grant in select * from access_grants where status = 'active' and expires_at < now() loop
    delete from workspace_members where workspace_id = v_grant.workspace_id and user_id = v_grant.claimed_by;
    update access_grants set status = 'expired' where id = v_grant.id;
  end loop;
end;
$function$;

select cron.schedule('expire-access-grants-hourly', '0 * * * *', $$select public.expire_access_grants();$$);
