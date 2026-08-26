-- Perfil personal más completo -- a pedido explícito del usuario, "todo lo
-- que pueda servir a futuro, y lo que no también, para recabar datos".
-- Todo opcional (nullable, sin default salvo language), sin validación
-- de formato del lado de la base -- son datos declarados por la propia
-- persona, no algo que otra pantalla dependa de que esté bien formado.
alter table public.profiles
  add column phone text,
  add column job_title text,
  add column department text,
  add column birthday date,
  add column city text,
  add column timezone text,
  add column linkedin_url text,
  add column bio text,
  add column language text not null default 'es';
