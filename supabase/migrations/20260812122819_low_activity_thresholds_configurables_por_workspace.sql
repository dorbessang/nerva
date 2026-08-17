-- Límites de "proyecto sin actividad", antes hardcodeados en 90/120 días
-- para todos los workspaces. Ahora configurables por workspace: alert_days
-- es cuándo empieza a avisar (banner de "baja actividad"), inactive_days es
-- cuándo mark_inactive_negotiations (el cron) lo marca 'inactive' de
-- verdad (banner de "pasó a inactivo").
alter table public.workspaces
  add column if not exists low_activity_alert_days integer not null default 90,
  add column if not exists low_activity_inactive_days integer not null default 120;

alter table public.workspaces
  add constraint workspaces_low_activity_days_check
  check (low_activity_alert_days > 0 and low_activity_inactive_days > low_activity_alert_days);

-- Candado a nivel base: aunque la policy de UPDATE de workspaces ya
-- permite owner+admin en general (nombre del workspace, etc.), acá
-- puntualmente el usuario pidió que SOLO el owner pueda tocar estos dos
-- campos. RLS no hace restricción por columna, así que se resuelve con un
-- trigger que solo actúa si esos dos campos cambian.
create or replace function public.enforce_low_activity_owner_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if (new.low_activity_alert_days is distinct from old.low_activity_alert_days
      or new.low_activity_inactive_days is distinct from old.low_activity_inactive_days)
     and not exists (
       select 1 from workspace_members
       where workspace_id = new.id and user_id = auth.uid() and role = 'owner' and status = 'active'
     )
  then
    raise exception 'Solo el owner del workspace puede cambiar los límites de inactividad';
  end if;
  return new;
end;
$function$;

drop trigger if exists workspaces_enforce_low_activity_owner on public.workspaces;
create trigger workspaces_enforce_low_activity_owner
before update on public.workspaces
for each row execute function public.enforce_low_activity_owner_only();

-- El cron ya no usa 120 fijo, usa el de cada workspace (default 120 si por
-- lo que sea quedara null).
create or replace function public.mark_inactive_negotiations()
returns void
language plpgsql
set search_path = public
as $function$
begin
  update public.negotiations n
  set activity_status = 'inactive'
  from public.workspaces w
  where n.workspace_id = w.id
    and n.activity_status = 'active'
    and n.last_activity_at < now() - (coalesce(w.low_activity_inactive_days, 120) || ' days')::interval;
end;
$function$;
