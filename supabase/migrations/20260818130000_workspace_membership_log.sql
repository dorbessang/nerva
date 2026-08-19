-- Bitácora de entradas/salidas de miembros de un workspace — pedido
-- explícito del usuario, aplica a CUALQUIER miembro (sea staff o no), no
-- solo a los accesos de soporte. Vía trigger sobre workspace_members en
-- vez de logueado a mano en cada punto del código que lo toca (invite
-- aceptado, cambio de rol desde Settings, alta/baja) — así ningún camino
-- se puede olvidar de loguear.
create table public.workspace_membership_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('joined', 'role_changed', 'deactivated', 'reactivated', 'removed')),
  old_role text,
  new_role text,
  performed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.workspace_membership_log enable row level security;

create policy "workspace members view membership log"
on public.workspace_membership_log for select to public
using (workspace_id in (select my_workspace_ids()));

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
    values (old.workspace_id, old.user_id, 'removed', old.role, auth.uid());
  end if;
  return coalesce(new, old);
end;
$function$;

-- auth.uid() puede venir null acá (ej. alta automática al aceptar una
-- invitación, disparada por un trigger de auth.users sin sesión de
-- cliente detrás) — se deja el registro igual, sin "quién" en ese caso.
create trigger workspace_members_log_changes
after insert or update or delete on public.workspace_members
for each row execute function public.log_membership_change();
