-- Tres pedidos del usuario sobre Acceso de Soporte, ver PENDIENTES.md:
--   1. Número de ticket para trazabilidad (columna identity global, no
--      por workspace -- es una cola compartida entre workspaces)
--   2. Mensaje de resolución al cerrar el acceso, visible para el
--      workspace ("le quiero contar qué pasó")
--   3. El propio miembro de staff que tomó el acceso tiene que poder
--      cerrarlo él mismo cuando termina, no solo el owner/admin del
--      workspace -- antes revoke_access_grant era exclusivo de
--      owner/admin
alter table public.access_grants
  add column ticket_number bigint generated always as identity,
  add column resolution_message text;

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

  -- Avisamos a quien generó el acceso, sea que lo haya cerrado el
  -- staff (con o sin mensaje) o el propio owner/admin.
  if v_grant.created_by is not null and v_grant.created_by is distinct from auth.uid() then
    insert into notifications (workspace_id, user_id, type, title, body)
    values (
      v_grant.workspace_id, v_grant.created_by, 'access_grant_closed',
      'Acceso de soporte finalizado',
      coalesce(p_message, 'El acceso de soporte se cerró sin comentarios.')
    );
  end if;
end;
$function$;
