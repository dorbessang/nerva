-- 1. Cerrar con llave las funciones de notificaciones masivas: solo deben
-- correr desde el cron (rol postgres), no ser invocables por usuarios via
-- API REST (/rest/v1/rpc/...).
revoke execute on function public.notify_pending_events() from anon, authenticated;
revoke execute on function public.notify_custom_field_alerts() from anon, authenticated;

-- 2. Notificaciones: cada usuario borra únicamente las suyas. Se saca la
-- policy que permitía borrar notificaciones de cualquier miembro del
-- workspace (quedaba mal acotada, permitía vaciar el buzón de un
-- compañero). dismissNotificationsForTask sigue funcionando igual: al no
-- filtrar por user_id en el código, RLS ya limita en silencio el borrado a
-- las filas del propio usuario.
drop policy if exists "workspace members clear notifications about resolved tasks" on public.notifications;

-- 3. Policies duplicadas en profiles (mismo qual repetido dos veces por
-- comando) — se deja una sola de cada.
drop policy if exists "profiles visible to workspace members" on public.profiles;
drop policy if exists "update own profile" on public.profiles;

-- 4. Vista sin uso en el código, definida como SECURITY DEFINER (marcada
-- por el linter de seguridad de Supabase).
drop view if exists public.workspace_members_readable;

-- 5. search_path fijo en funciones que no lo tenían (hardening estándar
-- recomendado por Supabase para funciones SECURITY DEFINER/triggers).
alter function public.set_updated_at() set search_path = public;
alter function public.my_workspace_ids() set search_path = public;
alter function public.handle_new_user() set search_path = public;
alter function public.mark_inactive_negotiations() set search_path = public;
alter function public.update_negotiation_activity() set search_path = public;
alter function public.update_negotiation_activity_from_task() set search_path = public;
alter function public.handle_invited_user() set search_path = public;
alter function public.workspace_seats_used(uuid) set search_path = public;
