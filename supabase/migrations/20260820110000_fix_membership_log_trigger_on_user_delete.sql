-- Bug real (encontrado al reproducir "Database error deleting user" en
-- caliente): al borrar una cuenta, el cascade de auth.users -> profiles
-- borra la fila de profiles ANTES de que el cascade siguiente
-- (profiles -> workspace_members, ON DELETE CASCADE) dispare el trigger
-- log_membership_change() -- que intentaba insertar en
-- workspace_membership_log con user_id = old.user_id, un id que en ese
-- instante ya no existe en profiles. La FK (ON DELETE SET NULL) protege
-- filas ya insertadas cuando profiles se borra después, pero no ayuda acá
-- porque el insert nuevo pasa DURANTE el mismo cascade, con el perfil ya
-- ido. Fix: si el perfil ya no existe en ese momento, se loguea igual la
-- baja pero con user_id null -- mismo criterio "se pierde el vínculo, no
-- el registro" que ya se usa en el resto de la bitácora.
create or replace function public.log_membership_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if TG_OP = 'INSERT' then
    insert into workspace_membership_log (workspace_id, user_id, action, new_role, performed_by)
    values (new.workspace_id, new.user_id, 'joined', new.role, auth.uid());
  elsif TG_OP = 'UPDATE' then
    if new.role is distinct from old.role then
      insert into workspace_membership_log (workspace_id, user_id, action, old_role, new_role, performed_by)
      values (new.workspace_id, new.user_id, 'role_changed', old.role, new.role, auth.uid());
    end if;
    if new.status is distinct from old.status then
      insert into workspace_membership_log (workspace_id, user_id, action, old_role, new_role, performed_by)
      values (new.workspace_id, new.user_id, case when new.status = 'active' then 'reactivated' else 'deactivated' end, old.role, new.role, auth.uid());
    end if;
  elsif TG_OP = 'DELETE' then
    insert into workspace_membership_log (workspace_id, user_id, action, old_role, performed_by)
    values (
      old.workspace_id,
      (select id from profiles where id = old.user_id),
      'removed',
      old.role,
      auth.uid()
    );
  end if;
  return coalesce(new, old);
end;
$function$;
