-- 1. Causa raíz de las "empresas fantasma": handle_new_user creaba un
-- workspace personal para CUALQUIER alta en auth.users, incluidos los
-- invitados (que ya reciben su membership real vía handle_invited_user).
-- Ahora solo crea el workspace personal si NO viene de una invitación.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  ws_id uuid;
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.email
  );

  if new.raw_user_meta_data->>'invited_workspace_id' is null then
    insert into public.workspaces (name, type, status)
    values (
      coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)) || '''s workspace',
      'personal',
      'active'
    )
    returning id into ws_id;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (ws_id, new.id, 'owner');
  end if;

  return new;
end;
$function$;

-- 2. Borrar las 5 empresas fantasma ya generadas (4 huérfanas de pruebas
-- viejas de invitación + 1 generada recién probando el envío de mail).
-- Verificado antes: cero negociaciones/entidades/tareas/campos custom
-- colgando de ninguna de estas, solo 1 fila de membership (de la prueba
-- de hoy).
delete from workspace_members where workspace_id in (
  'ca0db14b-e7d8-4f6f-a541-74a5b79e6700',
  '9d3d3b24-7adb-4975-a757-d1c349d51bec',
  '0f151579-3ad1-4930-8c9c-f06ecd98a44d',
  'e358387c-8092-4e18-8b3e-5331d47d7f40',
  '148f08f3-297e-4468-b5e4-d0cf52fdcb0e'
);
delete from workspaces where id in (
  'ca0db14b-e7d8-4f6f-a541-74a5b79e6700',
  '9d3d3b24-7adb-4975-a757-d1c349d51bec',
  '0f151579-3ad1-4930-8c9c-f06ecd98a44d',
  'e358387c-8092-4e18-8b3e-5331d47d7f40',
  '148f08f3-297e-4468-b5e4-d0cf52fdcb0e'
);

-- 3. negotiations.notes: campo legado reemplazado por 'description', nunca
-- tuvo control de UI (confirmado 0 filas con contenido, cero referencias
-- en el código).
alter table public.negotiations drop column if exists notes;

-- 4. profiles.avatar_url: nunca hay UI que lo escriba, columna siempre
-- NULL. Se saca del código (AuthContext) en el mismo commit que esto.
alter table public.profiles drop column if exists avatar_url;
