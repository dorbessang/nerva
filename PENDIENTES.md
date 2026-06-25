# Nerva — Pendientes y Roadmap

---

## 🔴 PRIORIDAD ABSOLUTA

- [ ] **Nuevo schema completo en Supabase desde cero** — incluye tablas de planes, seats, workspace_type, project_members, WS personal. Ver detalle abajo.
- [ ] **Conectar código actual del repo con el nuevo schema**
- [ ] **Implementar RLS policies completas**

---

## ETAPA 1 — Prioridad 1

- [ ] WS Personal — creación automática al registrar cualquier usuario
- [ ] WS Personal — misma estructura que WS grupal versión Free (entidades, proyectos, tareas)
- [ ] Workspace switcher en barra superior (dropdown con todos los WS del usuario)
- [ ] Workspace "Nerva Testing" — sin limitaciones, permanente, acceso controlado por Gervasio, type = 'testing'
- [ ] Deploy en Vercel
- [ ] Pasada responsive completa
- [ ] Múltiples entidades por proyecto — entidad principal + interlocutores con rol opcional
- [ ] Feature de inactividad — card en Dashboard (5 cards), filtro en Proyectos, banner alerta al login, columna last_activity_at con trigger, umbral configurable en Settings
- [ ] Settings — terminar de revisar y pulir

## ETAPA 1 — Prioridad 2

- [ ] Panel Owner: invitar usuarios, activar/desactivar, ver seats usados vs disponibles
- [ ] Flujo de invitación por email vía Supabase Auth
- [ ] Validación de seats al crear usuario (preparar función, activar en Etapa 2)
- [ ] Click en proyecto desde entidad navega a /negotiations con ese proyecto abierto
- [ ] Spinner de carga personalizado con animación del logo

---

## ETAPA 2 — Schema listo, lógica dormida en Etapa 1

- [ ] Tabla `plans` con 4 tiers: Free, Starter, Pro, Business
- [ ] Lógica de planes activa:
  - Free: WS personal only, 15 entidades, 3 proyectos activos, historial 90 días
  - Starter: 1 WS equipo, 5 seats, 100 entidades, 25 proyectos, historial 1 año
  - Pro: 1 WS equipo, 15 seats, ilimitado
  - Business: hasta 5 WS equipo, 50 seats por WS, ilimitado
- [ ] Validación activa límite entidades y proyectos activos
- [ ] UI "límite alcanzado" con CTA a upgrade
- [ ] Self-registration con creación automática de WS personal
- [ ] Sistema de permisos por proyecto (project_members):
  - Proyectos públicos dentro del WS (todo el equipo) vs privados (miembros asignados)
  - Colaboración cruzada entre WS personales en proyectos puntuales
  - Owner puede restringir visibilidad de proyectos a subset del equipo
- [ ] Landing page con pricing
- [ ] Integración Stripe (checkout, webhooks, upgrade/downgrade)
- [ ] Panel Super Admin (backoffice interno)

---

## FASE 2 — Producto comercial

- [ ] Constructor de formularios custom por workspace (tipos: selector de país, chips, texto libre, número, checkbox, lista, fecha, selector de usuario, archivo adjunto, moneda)
- [ ] Multi-workspace completo con selector al login
- [ ] Subentidades / Líneas de negocio dentro de entidades
- [ ] Vista calendario para tareas y proyectos (FullCalendar o react-big-calendar)
- [ ] Notificaciones por email con Resend

---

## DECISIONES TOMADAS

- El plan lo paga el workspace, no el usuario
- Todo usuario registrado recibe WS personal automáticamente (Free siempre)
- Para crear WS de equipo se necesita plan pago
- Usuario invitado a WS ajeno consume seat de ese WS, no necesita plan propio
- Schema se diseña completo en Etapa 1, lógica de validación inactiva hasta Etapa 2
- Workspace actual (aaaaaaaa-0000-0000-0000-000000000001) = Nerva Testing, permanente, sin límites
- Schema nuevo desde cero en Supabase (no migrar el actual)
- Código React actual se mantiene, se adapta al nuevo schema
- Desarrollo en Claude Code desde Mac personal (cuenta separada)
