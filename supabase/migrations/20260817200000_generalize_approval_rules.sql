-- Generaliza el motor de aprobaciones de "solo comisión" a un catálogo de
-- reglas por workspace, cada una con su propio on/off — pedido explícito
-- del usuario tras ver que comisión quedaba como el único gate posible.
-- commission_approval_threshold_pct/commission_approver_id (workspaces)
-- se migran a una fila de esta tabla nueva y se borran — nadie los usó
-- todavía (recién se habían lanzado esta misma sesión), migración sin
-- costo real.
create table public.approval_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  rule_type text not null check (rule_type in ('commission', 'task', 'negotiation_close')),
  enabled boolean not null default false,
  approver_id uuid references public.profiles(id) on delete set null,
  -- % para 'commission', monto para 'task' (opcional ahí — puede
  -- gatearse solo por el tilde manual de la tarea); sin uso en
  -- 'negotiation_close'.
  threshold_numeric numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, rule_type)
);

alter table public.approval_rules enable row level security;

create policy "workspace members view approval rules"
on public.approval_rules for select to public
using (workspace_id in (select my_workspace_ids()));

-- Solo el owner puede crear/tocar/borrar reglas — mismo criterio que ya
-- regía commission_approval_threshold_pct/approver_id.
create policy "owner manages approval rules"
on public.approval_rules for all to public
using (
  workspace_id in (select my_workspace_ids())
  and exists (select 1 from workspace_members where workspace_id = approval_rules.workspace_id and user_id = auth.uid() and role = 'owner' and status = 'active')
)
with check (
  workspace_id in (select my_workspace_ids())
  and exists (select 1 from workspace_members where workspace_id = approval_rules.workspace_id and user_id = auth.uid() and role = 'owner' and status = 'active')
);

insert into public.approval_rules (workspace_id, rule_type, enabled, approver_id, threshold_numeric)
select id, 'commission', true, commission_approver_id, commission_approval_threshold_pct
from public.workspaces
where commission_approval_threshold_pct is not null and commission_approver_id is not null;

drop trigger if exists workspaces_enforce_commission_approval_owner on public.workspaces;
drop function if exists public.enforce_commission_approval_owner_only();
alter table public.workspaces
  drop column if exists commission_approval_threshold_pct,
  drop column if exists commission_approver_id;

-- Tareas que requieren autorización — el aprobador se notifica directo
-- (no hace falta una tarea "espejo" para esto: la tarea que necesita
-- aprobación YA es el objeto a bloquear, a diferencia de una línea de
-- precio, que no tenía ningún objeto de tarea propio).
alter table public.tasks
  add column if not exists requires_approval boolean not null default false,
  add column if not exists amount numeric,
  add column if not exists approval_status text check (approval_status in ('pending','approved','rejected')),
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists approved_at timestamptz;

-- Confirmación de cierre de proyecto — no bloquea el cambio de estado
-- (mismo criterio "poco intrusivo" que ya se usó en comisión), lo aplica
-- y lo deja marcado hasta que el aprobador lo confirme o lo revierta.
alter table public.negotiations
  add column if not exists close_confirmation_status text check (close_confirmation_status in ('pending','confirmed')),
  add column if not exists close_requested_from_status text;
