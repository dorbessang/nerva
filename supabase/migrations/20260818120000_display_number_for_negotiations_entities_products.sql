-- Numeración estable tipo Excel para Proyectos/Entidades/Productos, por
-- workspace — primer paso del diseño de "Acceso de soporte para Staff"
-- (ver PENDIENTES.md), pero útil por sí solo para cualquier usuario: un
-- número de fila estable que no cambia aunque se borren otras filas.

create table public.workspace_counters (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  counter_name text not null,
  current_value integer not null default 0,
  primary key (workspace_id, counter_name)
);

alter table public.workspace_counters enable row level security;

create policy "workspace members view counters"
on public.workspace_counters for select to public
using (workspace_id in (select my_workspace_ids()));

-- Atómico vía UPDATE con lock de fila (upsert) — a diferencia de un simple
-- "max(display_number)+1", esto es seguro con inserts concurrentes.
create or replace function public.next_workspace_counter(p_workspace_id uuid, p_counter_name text)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_next integer;
begin
  insert into workspace_counters (workspace_id, counter_name, current_value)
  values (p_workspace_id, p_counter_name, 1)
  on conflict (workspace_id, counter_name)
  do update set current_value = workspace_counters.current_value + 1
  returning current_value into v_next;
  return v_next;
end;
$function$;

-- Un solo trigger function, reusado en las 3 tablas — usa TG_TABLE_NAME
-- como nombre del contador, así cada tabla lleva su propia numeración.
create or replace function public.set_display_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.display_number is null then
    new.display_number := next_workspace_counter(new.workspace_id, TG_TABLE_NAME);
  end if;
  return new;
end;
$function$;

alter table public.negotiations add column if not exists display_number integer;
alter table public.entities add column if not exists display_number integer;
alter table public.products add column if not exists display_number integer;

create trigger negotiations_set_display_number
before insert on public.negotiations
for each row execute function public.set_display_number();

create trigger entities_set_display_number
before insert on public.entities
for each row execute function public.set_display_number();

create trigger products_set_display_number
before insert on public.products
for each row execute function public.set_display_number();

-- Backfill de lo ya existente, en orden de creación, y se deja el
-- contador de cada workspace en el máximo asignado para que los
-- próximos inserts sigan la secuencia sin pisar nada.
with numbered as (
  select id, workspace_id, row_number() over (partition by workspace_id order by created_at) as rn
  from public.negotiations
)
update public.negotiations n set display_number = numbered.rn
from numbered where numbered.id = n.id;

insert into public.workspace_counters (workspace_id, counter_name, current_value)
select workspace_id, 'negotiations', max(display_number) from public.negotiations
where display_number is not null group by workspace_id
on conflict (workspace_id, counter_name) do update set current_value = excluded.current_value;

with numbered as (
  select id, workspace_id, row_number() over (partition by workspace_id order by created_at) as rn
  from public.entities
)
update public.entities e set display_number = numbered.rn
from numbered where numbered.id = e.id;

insert into public.workspace_counters (workspace_id, counter_name, current_value)
select workspace_id, 'entities', max(display_number) from public.entities
where display_number is not null group by workspace_id
on conflict (workspace_id, counter_name) do update set current_value = excluded.current_value;

with numbered as (
  select id, workspace_id, row_number() over (partition by workspace_id order by created_at) as rn
  from public.products
)
update public.products p set display_number = numbered.rn
from numbered where numbered.id = p.id;

insert into public.workspace_counters (workspace_id, counter_name, current_value)
select workspace_id, 'products', max(display_number) from public.products
where display_number is not null group by workspace_id
on conflict (workspace_id, counter_name) do update set current_value = excluded.current_value;
