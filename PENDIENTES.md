# Nerva — Pendientes y Roadmap

---

## VISIÓN DE PRODUCTO Y ARQUITECTURA (largo plazo)

Sesión de repensada estratégica (2026-07-06). Contexto para retomar sin perder el razonamiento.

### Diagnóstico: "híbrido raro" entre planner y CRM
Nerva nació para seguir negociaciones ya existentes (un planner con vocabulario de CRM encima), no para generarlas. Estructuralmente hoy el centro de todo es el **Proyecto** (`negotiations`): tareas, notas y entidades vinculadas cuelgan de él. Un CRM hecho y derecho invierte esa jerarquía: el centro es la **cuenta/entidad**, y los deals son solo un hilo dentro de una relación que dura años.

Comparado contra CRM de pipeline / vendor management / deal-trackers de licensing (Cortellis, DealForma, Biotechgate — más cercanos a lo que este producto es en realidad que un CRM genérico tipo HubSpot), los huecos más importantes identificados:
- [x] **Manejo de documentos** — tabla `documents` (polimórfica negotiation_id/entity_id, igual patrón que notas/tareas) + bucket privado `documents` en Storage. Componente `Documents` (subir/listar/descargar vía signed URL/borrar), wireado en detalle de proyecto y como pestaña nueva en detalle de entidad. Límite 20MB por archivo, logActivity al subir
- [x] **Valor monetario del deal** — ver punto 3 más abajo (`currency` + `deal_milestones`)
- Sin kanban visual, sin búsqueda global, sin export/reportes, sin scorecard de proveedor, sin alertas de vencimiento de NDA/contrato (solo de tareas), sin @menciones, sin timeline de auditoría, sin bulk actions/import CSV, sin API/webhooks

### Decisión: entidad-céntrico, no proyecto-céntrico
Las entidades son lo permanente. Los proyectos pasan a ser **un tipo de vínculo posible entre entidades**, no el centro. La idea del usuario: distintos sectores de una misma empresa (BD, Finanzas, RRHH) se relacionan distinto con la misma entidad — eso solo es posible si la entidad no le "pertenece" a ningún módulo.

Cambios concretos acordados para acercarse a esto **sin reescribir nada todavía**:
1. [x] Notas y tareas cuelgan directo de una entidad (`entity_id`), no solo de un proyecto — ya no hace falta un proyecto para dejar rastro de una relación en curso. `negotiation_notes.negotiation_id` ahora nullable + `entity_id` nuevo (constraint: al menos uno de los dos); `tasks.entity_id` nuevo. Componente `NotesPostIts` extraído y reusado en proyecto/entidad
2. [x] Timeline de actividad — no solo en la entidad, también en el proyecto (ampliación pedida en la práctica). Tabla `activity_log` nueva (workspace_id, negotiation_id, entity_id, type, title, actor_id) + componente `ActivityTimeline`. El de la entidad agrega también la actividad de todos los proyectos vinculados a ella (verdadero hub). Eventos logueados: proyecto creado, entidad creada, nota agregada, tarea creada/completada, cambio de estado. Bug encontrado y corregido en el camino: el timeline no se refrescaba solo al agregar algo, necesitó un `refreshKey`
3. [x] Campos de valor de deal en `negotiations` — `currency` (selector) + tabla `deal_milestones` (desglose libre de hitos: upfront, milestones, royalties, lo que sea, cada uno con nombre/monto/fecha estimada o `timing_note` de texto libre si no hay fecha exacta, editable inline). Monto admite negativos (pagos salientes). Componente `DealMilestones`, sección "VALOR DEL DEAL" en detalle y alta inicial en el modal de creación. Card "Valor de pipeline" en el Dashboard y en Proyectos (con subtotal de selección múltiple), suma los hitos agrupados por moneda (sin conversión automática)
4. [x] Campo `description` (texto largo) en `negotiations` — reemplaza un campo `notes` legado que nunca tuvo control de UI (siempre se guardaba vacío). Sección "DESCRIPCIÓN" prominente en el detalle (inline-editable) y en el modal de creación/edición, separado de "Observaciones internas" (comentario interno corto) y de las notas post-it (bitácora fechada)
5. [x] Documentos adjuntos — ver el punto correspondiente más arriba en el diagnóstico de huecos

### Principio de diseño para decidir qué construir de acá en adelante
**¿Esto mejora el producto de hoy (BD/licensing), además de servir a la visión larga?** Si una feature solo se justifica por el ERP imaginario del futuro y no le suma nada al uso actual, no se construye todavía — construir sobre necesidades estimadas en vez de reales es el error a evitar (dicho explícitamente por el usuario).

### Decisión: mutación vs. rebuild-desde-cero-como-ERP
Se evaluó explícitamente si convenía repensar Nerva de raíz o levantar un ERP aparte (con eventual migración de datos). **Decisión: ni mutar todo de golpe ni reconstruir aparte — un solo Nerva, un solo backbone.**

Razón: todo lo ya construido (auth, multi-workspace, RLS, roles/permisos, invitaciones, notificaciones, entidades+contactos) no es plomería específica de CRM — es plomería genérica de cualquier SaaS multi-tenant que un ERP necesitaría exactamente igual. Reconstruir eso desde cero en una app nueva es trabajo puro sin valor agregado, y ya se identificó el costo real de separar: migración de datos, doble auth, doble UX, usuarios confundidos durante la transición.

Excepción reconocida: módulos con un dominio genuinamente distinto (contabilidad real — partida doble, inmutabilidad de asientos, conciliación) sí merecen diseño propio desde cero cuando lleguen, pero como **subsistema dentro de Nerva** (mismas entidades, mismo workspace, mismo login, misma marca), nunca como app separada.

### Sobre el "framework de módulos" genérico
Decisión explícita de **no construirlo todavía**. Se define el patrón target para que futuros módulos lo sigan, pero se posterga la formalización hasta construir el segundo módulo real (Finanzas o RRHH, a decidir) — recién con dos casos concretos se sabe qué es genérico de verdad y qué no. Patrón target:
- Cada módulo (BD/Negociaciones hoy, Finanzas/RRHH después) es su propio set de tablas, su propia sección de sidebar, sus propios permisos
- Todos los módulos se conectan a `entities` vía tabla de vínculo (como `negotiation_entities` hoy) — ningún módulo "posee" la entidad
- Los campos custom por workspace (ya en Fase 2) viven *dentro* de cada módulo, no como reemplazo del módulo
- La elección de "tipo de CRM" al crear un workspace pasa a ser, en este esquema, qué **módulos** están activos — no solo qué `entity_types` vienen precargados

### Próximo paso acordado
Puntos 1 a 5 completos, funcionalidad probada. De los huecos originales del diagnóstico quedan: ~~kanban visual~~, ~~búsqueda global~~ y ~~export CSV~~ (hechos, ver abajo), scorecard de proveedor, alertas de vencimiento de NDA/contrato, @menciones, bulk actions/import CSV, API/webhooks.

- Alertas de vencimiento de NDA/contrato — descartado por ahora. Hoy `nda` es un campo hardcodeado en `negotiations`, pero según lo pensado para Etapa 2 (campos custom por workspace) no va a seguir siendo un campo fijo — no tiene sentido construir alertas sobre un dato que va a cambiar de modelo pronto
- Sin scorecard de proveedor, @menciones, bulk actions/import CSV, API/webhooks — sin definir orden todavía

### Export de Proyectos
- [x] Botón "⬇ Exportar CSV" en el toolbar de `/negotiations`, junto a "⚙ Columnas". Exporta la lista `filtered` (respeta los filtros de búsqueda/proveedor/estado/actividad activos) usando exactamente las columnas visibles del usuario (`cols`) — si hay filas seleccionadas, exporta solo esas en vez de todo lo filtrado
- [x] Generación 100% cliente (`exportNegotiationsCsv`, sin Edge Function): BOM UTF-8 para que Excel abra bien los acentos, escapado de comillas/`;`/saltos de línea, valores de fecha en ISO (no el formato relativo "hace Nd" que usa la tabla, más útil para analizar en planilla)
- [x] Fix (reportado probando en real): el CSV se abría "todo junto" en Excel — Excel en configuración regional es-AR/es-ES usa la coma como separador decimal, así que espera `;` como separador de columna en un CSV, no `,`. Se cambió el delimitador a `;` + una línea `sep=;` al principio del archivo (directiva que Excel reconoce para fijar el separador sin depender de la configuración regional de la máquina)
- [x] Probado con Playwright capturando la descarga real: nombre de archivo, contenido completo, y que "solo seleccionados" efectivamente filtra a 1 fila
- PDF queda pendiente como segunda entrega (decisión explícita: CSV primero, probarlo en uso real antes de invertir en el layout de un PDF)

### Kanban visual de Proyectos
- [x] Tercera vista en `/negotiations` (☰ tabla / ⊞ cards / ▦ kanban), toggle junto a los otros dos. Columnas = `custom_states` del workspace (mismas que ya se configuran en Settings, orden por `sort_order`) — no hace falta ningún estado nuevo, ni tabla nueva
- [x] `KanbanView` — cards con producto/título, proveedor principal (+ bandera), NDA, fecha objetivo e ícono de pausado/inactivo, mismo criterio visual que `CardsView`. Drag & drop nativo (mismo patrón que el Kanban de la Agenda personal) + botones ‹/› como fallback accesible/testeable, moviendo a la columna anterior/siguiente según el orden de `custom_states`
- [x] Mover una card dispara exactamente el mismo efecto secundario que cambiar el estado desde el detalle: `notifyNegotiationStatusChanged` (notifica a los asignados de las tareas del proyecto) + `logActivity` (entrada en el timeline de actividad) — se extrajo a `handleKanbanMove` en vez de duplicar lógica
- [x] El editor de columnas (⚙ Columnas) se oculta en la vista kanban, no aplica ahí
- [x] Probado con Playwright: columnas correctas, cards correctas, click abre detalle, drag&drop nativo y botones ‹/› ambos mueven y actualizan el status en el servidor, notificación y activity log generados

### Búsqueda global
- [x] **Búsqueda global** — buscador en el header (`GlobalSearch.jsx`), input fijo (no overlay/atajo) + versión colapsada a ícono en mobile que expande a barra full-width. Busca con `ilike` en paralelo (sin Edge Function ni full-text search, no se justifica con el volumen actual): en WS de equipo, Proyectos (`product`/`title`), Entidades (`name`) y Tareas (`title`); en WS personal, Tareas y Notas sueltas. Los resultados de notas navegan al proyecto/entidad que las contiene, no a la nota en sí (pedido explícito). Deep-links reusando el patrón `?openNeg=`/`?openTask=` que ya usaban las notificaciones; se sumó `?openEntity=` a `Entities.jsx` (no existía). El hook `useCloseOnOutsideOrEscape` (antes solo en Agenda.jsx) se extrajo a `src/lib/useCloseOnOutsideOrEscape.js` para reusarlo acá también
- [x] Ajuste post-uso (reportado por el usuario probando en real): dos proyectos con el mismo `product` (ej. mismo producto negociado con 2 proveedores distintos) no se podían diferenciar en los resultados. Se agregó el proveedor principal como subtítulo del resultado — usa `primary_entity_id` con fallback al primer proveedor de `negotiation_entities` (mismo patrón que ya usa `Negotiations.jsx`), porque en la práctica muchos proyectos no tienen `primary_entity_id` seteado
- [x] Mismo ajuste extendido a Tareas y Notas: si cuelgan de un proyecto, el subtítulo ahora encadena proyecto + proveedor de ese proyecto ("en Ibuprofeno 400mg · Proveedor Uno SA"), no solo el nombre del proyecto — así se desambigua igual un paso más abajo en la jerarquía (tarea/nota → proyecto → proveedor). Si cuelgan directo de una entidad, muestra el nombre de la entidad (`contextLabel()`, helper compartido)

### Pendientes estéticos (UI polish, no bloqueantes)
- Card de "Valor de pipeline"/"Seleccionados" en Proyectos — funciona bien, pero el diseño se puede pulir más (usuario: "podría mejorar, pero dejalo como pendiente")
- **Rediseño visual completo** (sesión 2026-07-29, explorado con mockups pero sin construir nada todavía): base "suave y moderno" (sombras suaves, degradés sutiles) + un toque bold — títulos en negrita, franjas de color de 3px SOLO en las tarjetas de datos de arriba (Hoy/Semana/Vencidas), nada de franjas ni cards coloreadas en el resto. El widget "Hoy" pasa a ser una barra horizontal arriba de todo (no lateral). Se acordó quedarse con **2 temas visuales** seleccionables desde Settings — "Bento moderno" (por defecto: rompe la grilla uniforme de cards, números grandes con cifra fantasma de fondo, tablero como carriles sin caja) y "Clásico profesional" (esquinas casi rectas, sin sombras, todo separado por líneas finas tipo reporte, serif en títulos de sección), descartando "Robusto" — más el toggle claro/oscuro (ícono en el header + reflejado en Settings), ambos en una sección "Apariencia" de Settings, mismo mecanismo de variables CSS. Requiere armar primero una capa de tokens de diseño ya que hoy cada CSS hardcodea sus propios colores. Explícitamente pausado — "no nos enrosquemos en eso ahora", retomar en una sesión dedicada a estética
- Seguramente vayan sumándose más a medida que se usa la app en el día a día — no priorizar hasta después de la próxima tanda de funcionalidad

---

## AGENDA PERSONAL (workspace tipo `personal`)

El WS personal existía desde Etapa 1 solo como fila en la base (trigger `handle_new_user`), sin ningún tratamiento distinto al de un workspace de equipo en ningún lugar del código. Decisión explícita del usuario: en vez de replicar el modelo de proyectos/entidades para uso individual, el WS personal es **un producto totalmente distinto** — un planner simple tipo agenda (calendario + kanban + notas), sin nada de BD/licensing. Es un plus para hacer más adaptable el uso de Nerva, no compite con el WS de equipo (ese sigue siendo el producto fuerte). Se investigó el mercado (Todoist, TickTick, Sunsama, Motion, Akiflow, personal kanban) antes de diseñar — conclusión: nada de auto-scheduling con IA, alta rápida sin modal (estilo Todoist) + kanban de 3 columnas + calendario.

- [x] `AuthContext` expone `activeWorkspace` (antes cada página lo derivaba a mano)
- [x] Sidebar y Dashboard se ramifican por `activeWorkspace.type === 'personal'` — oculta Proyectos/tipos de entidad/Tareas, muestra "Agenda". Settings oculta Usuarios/Estados/Tipos de entidad (no aplican a un WS de un solo usuario sin proyectos)
- [x] `negotiation_notes` — se sacó el constraint que exigía negotiation_id o entity_id; ahora también admite notas sueltas (solo `workspace_id`), usadas por el notepad de la Agenda
- [x] Página `/agenda` con 3 pestañas, todo sobre `tasks` sin negotiation_id/entity_id (cero tablas nuevas):
  - **Tablero**: kanban de 3 columnas (Pendiente/En curso/Completado) mapeado directo a `tasks.status`, que ya tenía esos 3 valores. Alta rápida con un input inline (sin modal), drag & drop nativo entre columnas (mismo patrón que el reordenamiento de columnas de Proyectos) + botones ‹/› para mover. Panel "Hoy" al costado (solo lectura, tareas de hoy en orden cronológico), rediseñado con estética tipo timeline (línea vertical con puntos, badges de hora en pill, contador, header con fecha) para que no se vea tan "plano" como el resto de las cards — decidido explícitamente en vez de una 4ª columna kanban, para no mezclar el modelo por-estado con el modelo por-fecha
  - **Calendario**: toggle Día/Semana/Mes, botón "+ Nuevo evento" (`QuickAddPanel`) presente en las 3 vistas por consistencia.
    - Mes: grilla mensual, tareas ubicadas por `due_date`, alta rápida por día con click, checkbox para completar, click en el número del día salta a la vista Día de esa fecha
    - Día/Semana: motor de grilla horaria compartido (`TimeColumn`), tipo Google Calendar — `tasks.due_time` + `tasks.due_time_end` (columnas nuevas, nullable, aditivas), eventos dibujados como bloques con alto proporcional a la duración (default 30min si no se especifica fin), título en línea junto al horario (no apilado, para que no se corte el texto en bloques bajos). Click en una franja de :00/:30 para agregar con hora de fin editable ahí mismo, más un botón "+ Nuevo evento" para cuando la franja deseada ya está tapada por otro bloque. Solapamientos: se agrupan en clusters (todo lo que se toca en el tiempo) y se reparte el ancho parejo entre ellos — no se replicó el algoritmo completo de Google Calendar para casos de solapamiento parcial encadenado, decisión explícita por ser un planner simple
    - Los formularios inline de alta (`QuickAddPanel` y el form de franja horaria de `TimeColumn`) se cierran con Escape o clickeando afuera (hook compartido `useCloseOnOutsideOrEscape`), y guardan con Enter en cualquier campo o clickeando OK/Agregar (son `<form>`, no `<div>`, para que el submit nativo cubra todos los campos sin wiring manual por input)
  - **Notas**: `NotesPostIts` en modo standalone
- [x] Dashboard del WS personal reemplaza las métricas de proyectos/pipeline por hoy/esta semana/vencidas, reusando el mismo layout de cards que ya existía (centradas con `.db-metrics--personal`, son solo 3 en vez de 4)

### Pendiente / a futuro (no ahora)
- Integración con Google Calendar y/o Microsoft 365 — pedido explícito del usuario para el futuro, pero es un desarrollo propio serio (OAuth por proveedor, sync de dos vías, resolución de conflictos), no una tarea de una sesión. El modelo de datos actual (`due_date`/`due_time`/`due_time_end`) no lo bloquea, pero no se construyó nada todavía
- No se le puso gate al lado del servidor a la Edge Function `invite-user` para bloquear invitaciones a un WS personal — hoy es solo un gate de UI (se oculta el tab "Usuarios"). No es un problema de seguridad entre tenants (solo afecta al propio WS del usuario), pero si se quiere blindar del todo falta ese paso
- Sin drag-to-resize de eventos (cambiar la duración arrastrando el borde del bloque, como Google Calendar) — hoy la duración solo se define al crear, editando la hora de fin en el form
- Separar el concepto de tarea vs evento en el widget "Hoy": una tarea en Pendiente/En curso sin fecha debería aparecer siempre en "Hoy" (sea el día que sea) hasta completarse, en vez de no aparecer nunca por no tener `due_date`. Solo desaparece al completarse, o si tiene fecha propia (eso sí es "de ese día"). Pedido explícito del usuario, para más adelante

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
- [x] Notificaciones in-app — eventos 4/5 y 5/5: **tarea por vencer/vencida** y **proyecto marcado inactivo**. Cron propio `notify_pending_events()` (corre diario, job `notify-pending-events-daily`, separado del cron de inactividad existente), con marcadores (`due_soon_notified_at`, `overdue_notified_at`, `inactive_notified_at`) para no reavisar lo mismo todos los días. Con esto, los 5 eventos planeados están completos (decidido explícitamente: **no** notificar bajas/remociones de WS ni de proyecto, eso queda en silencio)
- [x] Settings personal para cualquier rol — pestaña "Notificaciones" (`/settings`) visible para todos (a diferencia de Usuarios/Estados/Tipos de entidad/Workspace, que siguen siendo owner/admin). Toggle on/off por tipo de evento, tabla `notification_preferences` (user_id + workspace_id + type), cada `notify*` la respeta antes de insertar
- [ ] Settings personal — resto de lo pensado más allá de notificaciones (Etapa 2/Fase 2): preferencias de vista (tema, filtro por defecto, densidad de tabla), zona horaria/formato de fecha, workspace por defecto (hoy vive en localStorage)

---

## ETAPA 2 — Schema listo, lógica dormida en Etapa 1

- [ ] Perfil de usuario — resto del alcance (acotado a nombre + contraseña en Etapa 1):
  - Avatar/foto de perfil (requiere bucket de Storage + UI de carga)
  - Teléfono / cargo
  - Ver en qué workspaces está el usuario y con qué rol en cada uno
  - Sesiones activas / cerrar sesión en otros dispositivos
  - Zona horaria / idioma
  - Eliminar/desactivar la propia cuenta
- [ ] Tabla `plans` con 4 tiers: Free, Starter, Pro, Business
- [ ] Lógica de planes activa:
  - Free: WS personal only, 15 entidades, 3 proyectos activos, historial 90 días
  - Starter: 1 WS equipo, 5 seats, 100 entidades, 25 proyectos, historial 1 año
  - Pro: 1 WS equipo, 15 seats, ilimitado
  - Business: hasta 5 WS equipo, 50 seats por WS, ilimitado
- [ ] Validación activa límite entidades y proyectos activos
- [ ] Límite de storage de documentos por plan — Supabase Free da 1GB total (compartido por *todo* el proyecto, no por workspace) y 50MB máx por archivo; hoy la app ya cotiza 20MB por archivo desde el cliente. Evaluar si el tope de storage entra como otro eje de los planes (como entidades/proyectos) antes de que haya varios workspaces de clientes reales compartiendo la cuota
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
