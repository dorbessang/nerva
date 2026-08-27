-- Tareas recurrentes / "playbooks": cada workspace puede precargar su
-- rutina habitual (ej. "Onboarding proveedor nuevo") como una lista de
-- tareas con offset de días desde que se aplica -- se elige al crear un
-- proyecto o se aplica después a mano, cualquier cantidad de veces.
create table public.task_playbooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  sort_order int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.task_playbook_items (
  id uuid primary key default gen_random_uuid(),
  playbook_id uuid not null references public.task_playbooks(id) on delete cascade,
  title text not null,
  days_offset int,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  sort_order int not null default 0
);

alter table public.task_playbooks enable row level security;
alter table public.task_playbook_items enable row level security;

-- Mismo criterio que custom_states/custom_field_definitions: una sola
-- policy ALL scoped por workspace, editable por cualquier miembro activo
-- (es config de workspace, no una acción sensible tipo borrado masivo).
create policy "crud task_playbooks in my workspaces" on public.task_playbooks
for all to public
using (workspace_id in (select my_workspace_ids()))
with check (workspace_id in (select my_workspace_ids()));

create policy "crud task_playbook_items in my workspaces" on public.task_playbook_items
for all to public
using (playbook_id in (select id from task_playbooks where workspace_id in (select my_workspace_ids())))
with check (playbook_id in (select id from task_playbooks where workspace_id in (select my_workspace_ids())));
