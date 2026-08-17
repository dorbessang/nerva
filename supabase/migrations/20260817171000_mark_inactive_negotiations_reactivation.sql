-- mark_inactive_negotiations solo pasaba de 'active' a 'inactive', nunca al
-- revés. Si un cliente subía low_activity_inactive_days después de que el
-- cron ya hubiera marcado proyectos como inactivos, esos proyectos quedaban
-- inactivos para siempre — el cron nunca los reconsideraba, solo sumaba
-- más. Ahora también reactiva los que volvieron a estar dentro de la
-- ventana vigente del workspace (no toca 'paused', eso es manual).
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

  update public.negotiations n
  set activity_status = 'active'
  from public.workspaces w
  where n.workspace_id = w.id
    and n.activity_status = 'inactive'
    and n.last_activity_at >= now() - (coalesce(w.low_activity_inactive_days, 120) || ' days')::interval;
end;
$function$;

-- Corre una vez ahora para que la vista quede al día con los umbrales que
-- ya se guardaron, sin esperar al cron de las 3am.
select public.mark_inactive_negotiations();
