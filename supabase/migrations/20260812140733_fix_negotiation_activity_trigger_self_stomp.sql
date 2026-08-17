create or replace function public.update_negotiation_activity()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  old_clean negotiations;
  new_clean negotiations;
begin
  -- Compara old vs new ignorando las columnas que el propio sistema
  -- actualiza por su cuenta (mark_inactive_negotiations, notify_pending_events).
  -- Si lo único que cambió fue eso, no lo tratamos como "actividad nueva":
  -- antes este trigger pisaba esos cambios y reactivaba el proyecto sin
  -- que nadie lo hubiera tocado, dejando el robot de inactividad inutilizable.
  old_clean := old;
  new_clean := new;
  old_clean.activity_status := null;
  old_clean.last_activity_at := null;
  old_clean.inactive_notified_at := null;
  old_clean.updated_at := null;
  new_clean.activity_status := null;
  new_clean.last_activity_at := null;
  new_clean.inactive_notified_at := null;
  new_clean.updated_at := null;

  if old_clean is distinct from new_clean then
    new.last_activity_at := now();
    if new.activity_status = 'inactive' then
      new.activity_status := 'active';
    end if;
  end if;

  return new;
end;
$function$;
