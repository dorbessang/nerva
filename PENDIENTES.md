# Nerva — Pendientes y Roadmap

---

## ETAPA 1 — Prioridad 1

- [x] Nuevo schema completo en Supabase (nuevo proyecto) — tablas, RLS, triggers
- [x] Conectar código React al nuevo schema
- [x] RLS policies completas con función helper `my_workspace_ids()`
- [x] Workspace "Nerva Testing" — type = 'testing', sin limitaciones, owner: Gervasio
- [x] WS Personal — trigger `handle_new_user` crea perfil + WS personal automáticamente al registrar usuario
- [x] Workspace switcher en header — dropdown fijo alineado con la sidebar
- [x] Deploy en Vercel
- [x] Pasada responsive completa
- [x] Múltiples entidades por proyecto — selector con búsqueda, checkbox múltiple y rol opcional por entidad
- [x] Feature de inactividad — columna activity_status + last_activity_at, triggers, pg_cron, dashboard cards "En curso"/"Completados", banner alerta 90-120 días, filtro low_activity en Proyectos
- [x] Settings — tipos de entidad con ícono, plural personalizable y edición inline
- [x] Settings — nombre del workspace se refleja en el switcher al guardar
- [x] CountrySelector — rediseño como combobox con búsqueda inline, navegación con flechas y sin autocompletado del browser
- [x] Columnas configurables por usuario — drag & drop para reordenar, toggle para mostrar/ocultar, persistido en localStorage. Aplica a tabla y mosaico
- [x] Notas tipo post-it — tabla `negotiation_notes`, colores y rotaciones pseudo-random, doble-click para editar inline, se agregan/borran desde la vista detalle
- [x] Edición inline en vista detalle — Estado, NDA y Observaciones editables sin abrir el modal de edición
- [x] Settings — paleta de colores para estados (presets + picker avanzado RGB), protección del estado "Completado", confirmación en borrado de otros estados
- [x] Modal único de proyectos — editar y volver al detalle sin cerrar todo, header azul sticky, botones Guardar/Cancelar en el header

## ETAPA 1 — Prioridad 2

- [x] Sistema de permisos por rol — owner/admin/editor/viewer con gates en proyectos, entidades, tareas y notas. DeleteConfirmModal estilo GitHub para borrados destructivos
- [x] Panel Owner: invitar usuarios, activar/desactivar, eliminar participantes del WS, ver seats usados (el tope "vs disponibles" depende del sistema de planes, Etapa 2)
- [x] Flujo de invitación por email vía Supabase Auth — Edge Function `invite-user` (invita, cancela) + trigger `handle_invited_user` que suma al workspace con el rol correcto al aceptar
- [x] Validación de seats al crear usuario — función SQL `workspace_seats_used(workspace_id)` preparada, sin bloquear nada todavía (se activa en Etapa 2)
- [x] Click en proyecto desde entidad abre el detalle inline (sin salir de la página de la entidad) — decidido a propósito, no navegar a /negotiations
- [x] Botón "Nuevo proyecto" desde el detalle de una entidad/proveedor (visible para owner, admin y editor) — el modal se abre con esa entidad ya preseleccionada en "Entidades vinculadas"
- [ ] Spinner de carga personalizado con animación del logo
- [x] Página de perfil de usuario (`/profile`) — editar full_name propio y cambiar contraseña. Accesible desde el header (ahora muestra full_name en vez del email) y desde un ítem nuevo en el sidebar, visible para cualquier rol
- [x] Staff role (`is_staff` en `profiles`) + selector "ver como rol" visible solo para equipo Nerva — base para Super Admin backoffice de Etapa 2
- [x] Cascade tasks (tareas encadenadas):
  - `tasks.predecessor_task_id` (auto-FK), seteable al crear (TaskModal, TaskModalInline) o editar (TaskDrawer), con detección de ciclos
  - La tarea sucesora aparece "bloqueada" (🔒, no se puede completar) hasta que la predecesora esté "done"
  - Owner/Admin: ven de qué tarea depende, quién la tiene y su estado
  - Editor/Viewer: ven "🔒 Pendiente de aprobación previa" sin identidad, mismo patrón que ya ocultaba tareas de terceros
  - Al completar una tarea se notifica in-app (tabla `notifications`, nueva — primera pieza de un sistema de notificaciones) al asignado de cada sucesora que se desbloquea. Campanita con contador en el header, click navega directo al proyecto/tarea correspondiente (o a `/tasks` si es una tarea suelta). Email vía Resend queda para Fase 2
  - De paso se corrigió un bug real en `TaskModalInline` (Negotiations.jsx): tenía el workspace_id hardcodeado al de Testing en vez de usar el workspace activo
- [x] Notificaciones in-app — se borran solas al leerlas (click en la notificación, o al resolverse la tarea/situación por otro camino), no se acumulan marcadas como leídas
- [x] Notificaciones in-app — evento 1/5: **asignación de tarea** (te avisa si te asignan una tarea que no creaste vos mismo; no notifica autoasignación). Cubre los 4 puntos de asignación: TaskModal, TaskModalInline, TaskDrawer (reasignar), alta por lote de "Tareas iniciales"
- [x] Notificaciones in-app — evento 2/5: **cambio de rol** (Settings > Usuarios) y **te sumaron directo a un workspace** (cuando invitás a alguien que ya tenía cuenta)
- [x] Notificaciones in-app — evento 3/5: **cambio de estado de un proyecto** donde tenés alguna tarea asignada (edición inline y modal de edición completo). Notification con `negotiation_id` para poder navegar directo al proyecto
- [ ] Notificaciones in-app — eventos pendientes, requieren un chequeo periódico (cron), no solo código de cliente (decidido explícitamente: **no** notificar bajas/remociones de WS ni de proyecto, eso queda en silencio):
  - Tarea por vencer / vencida (ver si conviene sumarlo al pg_cron que ya corre para inactividad)
  - Proyecto marcado inactivo (90-120 días) — hoy es un banner global, sumar aviso puntual a los asignados de ese proyecto

---

## ETAPA 2 — Schema listo, lógica dormida en Etapa 1

- [ ] Perfil de usuario — resto del alcance (acotado a nombre + contraseña en Etapa 1):
  - Avatar/foto de perfil (requiere bucket de Storage + UI de carga)
  - Teléfono / cargo
  - Ver en qué workspaces está el usuario y con qué rol en cada uno
  - Sesiones activas / cerrar sesión en otros dispositivos
  - Preferencias de notificaciones (cuando exista el sistema de notificaciones)
  - Zona horaria / idioma
  - Eliminar/desactivar la propia cuenta
- [ ] Tabla `plans` con 4 tiers: Free, Starter, Pro, Business
- [ ] Lógica de planes activa:
  - Free: WS personal only, 15 entidades, 3 proyectos activos, historial 90 días
  - Starter: 1 WS equipo, 5 seats, 100 entidades, 25 proyectos, historial 1 año
  - Pro: 1 WS equipo, 15 seats, ilimitado
  - Business: hasta 5 WS equipo, 50 seats por WS, ilimitado
- [ ] Validación activa límite entidades y proyectos activos
- [ ] UI "límite alcanzado" con CTA a upgrade
- [ ] Self-registration con pantalla de registro en la app (email, contraseña, nombre)
- [ ] Sistema de permisos por proyecto (project_members):
  - Proyectos públicos dentro del WS (todo el equipo) vs privados (miembros asignados)
  - Colaboración cruzada entre WS personales en proyectos puntuales
  - Owner puede restringir visibilidad de proyectos a subset del equipo
- [ ] Landing page con pricing
- [ ] Integración Stripe (checkout, webhooks, upgrade/downgrade)
- [ ] Panel Super Admin (backoffice interno)

---

## FASE 2 — Producto comercial

- [ ] Constructor de formularios custom por workspace
- [ ] Multi-workspace completo con selector al login
- [ ] Subentidades / Líneas de negocio dentro de entidades
- [ ] Vista calendario para tareas y proyectos
- [ ] Notificaciones por email con Resend

---

## DECISIONES TOMADAS

- El plan lo paga el workspace, no el usuario
- Todo usuario registrado recibe WS personal automáticamente (Free siempre)
- Para crear WS de equipo se necesita plan pago
- Usuario invitado a WS ajeno consume seat de ese WS, no necesita plan propio
- Schema se diseña completo en Etapa 1, lógica de validación inactiva hasta Etapa 2
- Workspace Testing = `aaaaaaaa-0000-0000-0000-000000000001`, permanente, sin límites
- Schema nuevo desde cero en nuevo proyecto Supabase (`jeeqoyjfkwrmbaaiesbt`)
- Código React actual se mantiene, se adapta al nuevo schema
- Workspace switcher: posición fija en header a 236px del borde izquierdo
- Self-registration es Etapa 2 — en Etapa 1 los usuarios se crean desde el dashboard de Supabase
