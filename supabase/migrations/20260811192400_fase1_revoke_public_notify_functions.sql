-- El revoke anterior (anon, authenticated) no alcanzaba: Postgres les otorga
-- EXECUTE a todos los roles por defecto vía el pseudo-rol PUBLIC al crear la
-- función, y eso pisa por encima cualquier revoke puntual a un rol
-- específico. Hay que sacárselo a PUBLIC directamente.
revoke execute on function public.notify_pending_events() from public;
revoke execute on function public.notify_custom_field_alerts() from public;
