-- Bug real: borrar un usuario (Perfil -> Staff -> Eliminar cuenta) fallaba
-- con "Database error deleting user" apenas esa persona tenía alguna
-- entrada en activity_log/documents/negotiation_notes -- a diferencia de
-- toda otra columna similar de la app (tasks.assigned_to/created_by,
-- negotiations.created_by, etc.), estas 3 quedaron con ON DELETE NO ACTION
-- en vez de SET NULL, así que Postgres rechazaba el delete de auth.users
-- (que cascadea a profiles) por la FK. Se preserva el registro histórico
-- (nunca se borra la nota/documento/entrada de bitácora), solo se
-- desasocia del usuario borrado -- mismo criterio ya usado en el resto.
alter table public.activity_log
  drop constraint activity_log_actor_id_fkey,
  add constraint activity_log_actor_id_fkey
    foreign key (actor_id) references public.profiles(id) on delete set null;

alter table public.documents
  drop constraint documents_uploaded_by_fkey,
  add constraint documents_uploaded_by_fkey
    foreign key (uploaded_by) references public.profiles(id) on delete set null;

alter table public.negotiation_notes
  drop constraint negotiation_notes_created_by_fkey,
  add constraint negotiation_notes_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;
