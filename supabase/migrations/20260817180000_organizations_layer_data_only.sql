-- Capa de Organización — modela el dato ahora (aditivo, sin romper nada
-- existente) para no migrar con dolor cuando llegue el dashboard
-- unificado multi-workspace de la Fase D. Sin UI todavía: ningún
-- workspace tiene organization_id seteado hasta que se construya el
-- flujo para armar/asignar una organización.
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.organizations enable row level security;

alter table public.workspaces
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

create index if not exists idx_workspaces_organization_id on public.workspaces(organization_id);

-- Mismo criterio que el resto de la app: solo se puede ver una
-- organización si se pertenece a algún workspace que cuelgue de ella.
create policy "organizations visible to member workspaces"
on public.organizations
for select
to public
using (
  id in (
    select organization_id from public.workspaces
    where id in (select my_workspace_ids()) and organization_id is not null
  )
);
