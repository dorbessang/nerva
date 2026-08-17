-- Reemplaza el hardcodeo de 'Completado' por un flag explícito, así el
-- nombre del estado queda libre de renombrar por workspace (antes estaba
-- protegido/bloqueado solo por ese motivo).
alter table public.custom_states
  add column if not exists is_terminal boolean not null default false;

update public.custom_states
set is_terminal = true
where object_type = 'negotiation' and name = 'Completado';
