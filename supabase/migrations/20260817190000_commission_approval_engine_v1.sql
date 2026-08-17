-- Motor de aprobaciones v1, acotado a comisión — Fase B del roadmap.
-- Config a nivel workspace (un solo % + un aprobador designado, ambos
-- opcionales — si cualquiera de los dos falta, el feature queda apagado
-- y nada cambia de comportamiento). El estado de aprobación vive en la
-- propia fila de negotiation_price_history, y cada solicitud pendiente
-- se apoya en una tarea real asignada al aprobador (misma infraestructura
-- de notificaciones/asignación que ya existe, no un sistema aparte).

alter table public.workspaces
  add column if not exists commission_approval_threshold_pct numeric,
  add column if not exists commission_approver_id uuid references public.profiles(id) on delete set null;

-- Mismo criterio que enforce_low_activity_owner_only: solo el owner puede
-- cambiar el umbral o reasignar el aprobador.
create or replace function public.enforce_commission_approval_owner_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if (new.commission_approval_threshold_pct is distinct from old.commission_approval_threshold_pct
      or new.commission_approver_id is distinct from old.commission_approver_id)
     and not exists (
       select 1 from workspace_members
       where workspace_id = new.id and user_id = auth.uid() and role = 'owner' and status = 'active'
     )
  then
    raise exception 'Solo el owner del workspace puede cambiar la configuración de aprobación de comisión';
  end if;
  return new;
end;
$function$;

drop trigger if exists workspaces_enforce_commission_approval_owner on public.workspaces;
create trigger workspaces_enforce_commission_approval_owner
before update on public.workspaces
for each row execute function public.enforce_commission_approval_owner_only();

alter table public.negotiation_price_history
  add column if not exists commission_approval_status text check (commission_approval_status in ('pending','approved','rejected')),
  add column if not exists commission_approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists commission_approved_at timestamptz;

-- Vínculo opcional de una tarea a la línea de precio que la originó — así
-- aprobar/rechazar desde PriceHistory puede cerrar la tarea asociada sola.
alter table public.tasks
  add column if not exists price_history_id uuid references public.negotiation_price_history(id) on delete cascade;
