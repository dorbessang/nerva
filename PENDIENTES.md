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
- [ ] Panel Owner: invitar usuarios, activar/desactivar, eliminar participantes del WS, ver seats usados vs disponibles
- [ ] Flujo de invitación por email vía Supabase Auth
- [ ] Validación de seats al crear usuario (preparar función, activar en Etapa 2)
- [ ] Click en proyecto desde entidad navega a /negotiations con ese proyecto abierto
- [ ] Botón "Nuevo proyecto" desde el detalle de una entidad/proveedor (visible para owner, admin y editor) — el modal se abre con esa entidad ya preseleccionada en "Entidades vinculadas"
- [ ] Spinner de carga personalizado con animación del logo
- [x] Staff role (`is_staff` en `profiles`) + selector "ver como rol" visible solo para equipo Nerva — base para Super Admin backoffice de Etapa 2
- [ ] Cascade tasks (tareas encadenadas):
  - Una tarea puede tener una "predecesora" (campo `predecessor_task_id` en tabla `tasks`)
  - La tarea sucesora aparece como "bloqueada" hasta que la predecesora esté completada
  - Owner/Admin: ven la cadena completa con todos los asignados y el estado de cada eslabón
  - Editor: ve su tarea como bloqueada con texto genérico "Pendiente de aprobación previa" sin saber quién la tiene
  - Viewer: igual que editor, solo ve sus tareas y si están bloqueadas
  - Al completar una tarea, el sistema verifica si desbloquea alguna sucesora y notifica al asignado (notificaciones in-app, Resend para email en Fase 2)

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
