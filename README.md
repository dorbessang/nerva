# Nerva CRM

CRM para negociaciones de licensing y distribución — pipeline, entidades,
productos con historial de precio y tareas con aprobación. React 19 + Vite
en el frontend, Supabase (Postgres + Auth + RLS) como backend.

## Desarrollo

```bash
npm install
cp .env.example .env   # completar con las credenciales del proyecto de Supabase
npm run dev
```

## Scripts

- `npm run dev` — servidor de desarrollo
- `npm run build` — build de producción
- `npm run preview` — sirve el build de producción localmente
- `npm run lint` — ESLint
- `npm test` — Vitest (tests unitarios y de componentes)

## Documentación

- `CHANGELOG.md` — registro detallado de cambios por sesión de trabajo
- `PENDIENTES.md` — roadmap y pendientes
