-- Foto de perfil (subida) o, en su defecto, un ícono elegido de una
-- galería fija (ver src/lib/avatarPresets.js para el listado — se
-- mantiene solo en el frontend, sin constraint acá, para poder sumar
-- opciones nuevas sin migración). Si no hay ninguno de los dos, se
-- sigue mostrando la inicial del nombre (comportamiento actual, sin
-- cambios) -- eso lo resuelve el componente Avatar, no la base.
alter table public.profiles
  add column avatar_url text,
  add column avatar_preset text;

-- Bucket público (a diferencia de 'documents', que es privado) -- un
-- avatar se muestra en un montón de lugares de la app (sidebar, lista de
-- miembros, etc.) y no tiene sentido pagar el costo de una signed URL en
-- cada uno de esos lugares para un dato que no es sensible.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Cada quien sube/reemplaza/borra solo su propio archivo -- carpeta =
-- su propio user id, mismo patrón que 'documents' usa workspace_id.
create policy "avatar owner uploads"
on storage.objects for insert to public
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar owner updates"
on storage.objects for update to public
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar owner deletes"
on storage.objects for delete to public
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- El bucket ya es público (se sirve por URL directa sin pasar por RLS),
-- pero se deja la policy igual por las dudas de que algo lea vía la API
-- autenticada en vez de la URL pública.
create policy "avatar public read"
on storage.objects for select to public
using (bucket_id = 'avatars');
