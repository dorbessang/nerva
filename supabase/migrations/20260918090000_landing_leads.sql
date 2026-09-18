-- Landing pública de gonerva.com (vertical CRM) — captura de leads del
-- formulario "Pedí acceso". Todavía no hay self-registration (Etapa 2),
-- así que por ahora esto solo guarda el mail para contactar a mano.
create table public.landing_leads (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at timestamptz not null default now()
);

alter table public.landing_leads enable row level security;

-- El formulario corre sin sesión (cliente anon) — solo puede insertar su
-- propio lead, nunca leer, editar ni borrar los de otros.
create policy "anon puede dejar su mail"
  on public.landing_leads
  for insert
  to anon
  with check (true);
