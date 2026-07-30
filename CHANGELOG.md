# Nerva — Changelog

Registro detallado de cambios por sesión de trabajo.

---

## 2026-07-30

### Feature: Export de Entidades unificado (todos los tipos, un solo PDF)
- El export de Entidades a PDF armado el 2026-07-29 generaba un archivo distinto por cada tipo de entidad (uno para Proveedores, otro para Clientes...). Ajustado a pedido del usuario: el mismo botón, desde cualquier pestaña de Entidades, ahora arma **un único PDF con todos los tipos del workspace** — portada, resumen general (con desglose "X Proveedores · Y Clientes..."), y por cada tipo una página divisoria seguida del detalle de cada entidad de ese tipo
- `exportAllEntitiesPdf({ workspaceId, customStates, workspaceName })` hace sus propias queries por `workspace_id` (todos los `entity_types` y todas las `entities`) en vez de recibir la lista ya acotada a un tipo de la pestaña activa
- Páginas divisorias navy de ancho completo (mismo estilo que la portada) sin pie de página — el texto gris del footer no se leería sobre navy — la numeración final de páginas se arma con la lista explícita de páginas que sí llevan footer, no un rango continuo

### Feature: Scorecard de proveedor
- Nueva pestaña "Resumen" en el detalle de una entidad (primera de la lista, activa por defecto): consolida en un solo lugar métricas de la relación con esa entidad que antes estaban dispersas o no existían — tarjetas de stat (proyectos/completados/en curso/tareas pendientes), valor de pipeline vinculado a esa entidad (agrupado por moneda, no existía a nivel entidad hasta ahora), distribución por estado en gráfico de barras (CSS puro), última actividad + alerta de proyectos pausados/inactivos, antigüedad de la relación, y desglose de NDA
- Deliberadamente sin "tiempo de respuesta" (parte de la idea original) — no hay ningún timestamp de mensajes en el modelo de datos actual para calcularlo sin inventar un dato

### Nota: pendiente para la etapa fuerte de Settings
- El usuario dejó anotado (sin construir todavía) que el campo "Tipo de empresa" de Entidades — hoy texto libre en `custom_fields.company_type` — tiene que pasar a ser una lista de clases configurable por workspace desde Settings, mismo patrón que `custom_states`/`entity_types`, para poder habilitarlo como filtro más adelante. Aclarado explícitamente que es distinto del tipo de entidad (Proveedor/Cliente)

### Feature: @menciones en notas
- Escribir "@Nombre" en cualquier nota (`NotesPostIts`, reusado en proyectos, entidades y el notepad del workspace personal) abre un autocompletado con los miembros activos del workspace; al elegir uno se inserta "@Nombre Completo " como texto plano — nada de sintaxis oculta, la nota se sigue leyendo igual de bien después
- A quién notificar se decide comparando el texto de la nota contra los nombres reales de los miembros al guardar (no con una regex ingenua de "una palabra", los nombres tienen espacios). Al editar una nota ya guardada, solo se notifican las menciones **nuevas** — resaguarda de generar notificaciones duplicadas cada vez que alguien re-guarda una nota que ya tenía una mención
- `notifyMentioned()` en `src/lib/notifications.js`, mismo patrón que el resto del sistema de notificaciones (respeta `notification_preferences`, sin auto-notificarse). Nuevo tipo `mentioned` sumado a Settings → Notificaciones
- Deep-link al hacer click funciona en las 2 superficies con navegación posible: nota de proyecto (`negotiation_id`, ya existía) y nota de entidad (`entity_id`, columna nueva agregada a `notifications` — el usuario corrió el `alter table` manualmente en Supabase, esta sesión no tiene salida de red hacia la base real). `NotificationBell` resuelve el `entity_type_id` a partir del `entity_id` al hacer click, mismo patrón de lookup que ya usaba para `task_id → negotiation_id`

### Fix: exploración de chat interno descartada
- El usuario preguntó si convenía sumar un chat grupal/individual dentro del workspace. Evaluado y descartado: técnicamente viable (Supabase Realtime está pensado para esto, "contactos" ni siquiera sería un concepto nuevo — cualquier miembro activo del workspace ya es candidato), pero no aporta frente a Slack/WhatsApp/Teams que el equipo ya usa a diario, y las @menciones recién agregadas ya cubren el caso real que motivó la pregunta ("avisar cosas puntuales sobre la app", no conversar). No se construyó nada

### Feature: Selección múltiple + acciones en lote
- Proyectos (tabla y mosaico) y Entidades (nuevo, ambas vistas) permiten tildar varias filas y aplicarles una acción en conjunto — antes esto solo existía para calcular el pipeline de la selección
- Proyectos: cambiar estado en lote (mismo efecto secundario que un cambio individual — notifica a los asignados de cada proyecto y deja entrada en el timeline, no un atajo silencioso) y eliminar en lote. Entidades: eliminar en lote. Ambos borrados gateados a owner, reusan `DeleteConfirmModal` pidiendo escribir "ELIMINAR" en vez de un nombre específico (no aplica cuando son varios elementos distintos)

### Feature: Import de Proyectos y Entidades desde Excel/CSV
- Botón "⬆ Importar" en el toolbar de ambas páginas: subir archivo → preview con validación fila por fila (✓ ok, ⚠ advertencia pero se importa igual, ✗ error y se excluye) → confirmar. Con botón de plantilla vacía descargable para no dejar al usuario adivinando las columnas
- Entidades: `Nombre*` / `País` / `Sitio web` / `Tipo de empresa`, país resuelto por nombre o código (`getCountryCode`, reverso nuevo de `getCountryName`). Proyectos: `Producto*` / `Proveedor` / `Estado` / `NDA` / `Territorios` / `Fecha objetivo` — proveedor resuelto por nombre exacto contra las entidades del workspace, estado contra los `custom_states` reales (si no matchea, usa el primero de la lista y avisa)
- `src/lib/importXlsx.js` reusa `xlsx` (SheetJS) con `import()` dinámico, mismo patrón que los exports — sin peso extra en el bundle inicial
- Bug real encontrado y corregido en las pruebas: al parsear `.csv`, las fechas se convertían al número de serie de Excel en vez de una fecha real — faltaba `cellDates: true` en esa rama del parser, y aparte el helper que lee columnas convertía todo a string antes de que el parser de fechas pudiera ver el objeto `Date` ya bien parseado. Se sumó `getCellRaw()` para leer esa columna sin stringificar
- Deliberadamente sin remapeo de columnas por UI (headers fijos) y sin loguear una entrada de actividad por cada fila importada (ruido innecesario para un import de decenas de filas)

## 2026-07-29

### Feature: Agenda personal (workspace tipo `personal`)
- El WS personal pasa de ser una fila vacía en la base a un producto distinto del WS de equipo: un planner simple (calendario + kanban + notas), no un CRM de proyectos/entidades a escala individual. Se investigó el mercado (Todoist, TickTick, Sunsama, Motion, Akiflow) antes de diseñar
- `AuthContext` expone `activeWorkspace` — sidebar, Dashboard y Settings se ramifican por `activeWorkspace.type === 'personal'`: oculta Proyectos/tipos de entidad/Tareas/Usuarios/Estados, agrega "Agenda"
- Página `/agenda` (3 pestañas), todo sobre `tasks` sin negotiation_id/entity_id — cero tablas nuevas:
  - Tablero: kanban Pendiente/En curso/Completado mapeado a `tasks.status` (que ya tenía esos 3 valores), alta rápida sin modal, drag & drop nativo + botones de mover, panel "Hoy" al costado de solo lectura con estética tipo timeline (línea con puntos, badges de hora en pill, contador y fecha en el header)
  - Calendario: toggle Día/Semana/Mes, botón "+ Nuevo evento" (`QuickAddPanel`) presente en las 3 vistas. Mes: grilla mensual por `due_date`. Día/Semana: grilla horaria tipo Google Calendar (`tasks.due_time`/`due_time_end`, columnas nuevas) — eventos como bloques con alto según duración (default 30min), título en línea junto al horario para que no se corte en bloques bajos, click en franja de :00/:30 para agregar con hora de fin editable, botón "+ Nuevo evento" como entrada alternativa, solapamientos agrupados en clusters con ancho repartido parejo
  - Notas: `NotesPostIts` en modo standalone (se sacó el constraint que exigía negotiation_id o entity_id)
  - Los formularios inline de alta (`QuickAddPanel`, franja horaria de `TimeColumn`) se cierran con Escape o click afuera, y guardan con Enter en cualquier campo u OK/Agregar — hook compartido `useCloseOnOutsideOrEscape`, markup pasado a `<form>` para que el submit nativo cubra todos los campos
- Dashboard del WS personal muestra hoy/esta semana/vencidas en vez de métricas de proyectos/pipeline, cards centradas

### Feature: Kanban visual de Proyectos (WS de equipo)
- Tercera vista en `/negotiations` junto a tabla y cards (☰ / ⊞ / ▦), columnas = `custom_states` del workspace ya configurables en Settings (mismo orden por `sort_order`) — cero estados ni tablas nuevas
- `KanbanView`: cards con producto, proveedor + bandera, NDA, fecha objetivo e ícono de pausado/inactivo. Drag & drop nativo (mismo patrón que el Kanban de la Agenda personal) + botones ‹/› de fallback
- Mover una card dispara el mismo efecto que cambiar el estado desde el detalle del proyecto: notifica a los asignados de las tareas del proyecto y deja entrada en el timeline de actividad (`handleKanbanMove`, mismo camino que `saveInlineField`)

### Feature: Búsqueda global
- Buscador en el header (`GlobalSearch.jsx`/`.css`), input fijo siempre visible (no overlay + atajo) que en mobile colapsa a un ícono y expande a barra full-width al tocarlo
- Cruza `ilike` en paralelo (sin Edge Function ni full-text search): en WS de equipo busca Proyectos, Entidades y Tareas; en WS personal, Tareas y Notas sueltas. Resultados agrupados por tipo, máximo 5 por grupo
- Click en un resultado navega directo al detalle, reusando el patrón de deep-link `?openNeg=`/`?openTask=` que ya usaban las notificaciones — se sumó `?openEntity=` a `Entities.jsx`, que no lo tenía. Los resultados de notas llevan al proyecto o entidad que las contiene, no a la nota en sí (decisión explícita del usuario)
- `useCloseOnOutsideOrEscape` se extrajo de Agenda.jsx a `src/lib/useCloseOnOutsideOrEscape.js` para reusarlo acá
- Fix (reportado probando en real): dos proyectos con el mismo nombre de producto pero distinto proveedor no se distinguían en los resultados — se agregó el proveedor principal como subtítulo (con fallback al primer proveedor vinculado, ya que muchos proyectos no tienen `primary_entity_id` seteado), extendido también a Tareas y Notas encadenando proyecto + proveedor de ese proyecto

### Feature: Export de Proyectos a Excel y PDF
- El botón de export pasa a ser un menú ("⬇ Exportar" → Excel / PDF) en el toolbar de `/negotiations`, junto a "⚙ Columnas" — ambos exportan la lista ya filtrada (columnas visibles del usuario para Excel; si hay filas seleccionadas, exporta solo esas)
- Excel arrancó como CSV, pero probando en real salieron dos bugs seguidos propios de Excel: separador de columna (`,` vs `;` según configuración regional es-AR/es-ES) y mojibake en los acentos pese al BOM UTF-8. Se cambió a generar un `.xlsx` real con `xlsx` (SheetJS) — sin delimitador ni codificación de texto de por medio, ambos problemas se resuelven de raíz
- PDF (`src/lib/exportPdf.js`, `jspdf` + `jspdf-autotable`): el usuario compartió un PDF de referencia de una versión anterior de la app y pidió una "presentación completa" en hojas horizontales — portada navy de marca, página de resumen (stat cards, pipeline por estado con los colores reales de `custom_states`, valor de pipeline, desglose de NDA), y una página por proyecto (pills de estado/NDA/fecha, tabla clave-valor con proveedor/territorios/participantes/empresas/notas/observaciones/tareas). Proyectos agrupados por proveedor y luego por producto. Las tareas no estaban precargadas en la lista de Proyectos, se agregó una query puntual solo para el export
- `xlsx` y `jspdf` se cargan con `import()` dinámico en vez de estático — jsPDF arrastra `html2canvas`/`dompurify`, y al ser acciones ocasionales no tiene sentido sumarlas al bundle inicial de la página. El chunk principal quedó igual de liviano que antes de este export
- Nota de seguridad: `xlsx` tiene CVEs sin parchear del lado de lectura de archivos, no aplican acá porque solo se usa para escribir — hay que revisarlo de nuevo si algún día se lee un `.xlsx` (ej. un import)
- Refactor: piezas visuales compartidas del PDF (colores, `drawCover`/`drawFooter`/`drawStatCards`/`drawStateBarChart`/`drawPill`/`stateColorRgb`/`formatDatePdf`) extraídas a `src/lib/pdfTheme.js`, reusadas también por el export de Proveedores

### Feature: Export de Entidades a PDF (todos los tipos, un solo archivo)
- Botón "⬇ Exportar PDF" en el toolbar de `/entities/:id`. El usuario compartió una presentación de referencia (`.pptx`) con el contenido que quería incluir — se leyó con `markitdown` (el conversor a imagen de LibreOffice no funcionó en este entorno) ya que el lenguaje visual venía definido por el PDF de Proyectos
- Primera versión exportaba solo el tipo de entidad de la pestaña activa (un archivo distinto por tipo). Ajustado a pedido del usuario: el botón ahora genera **un único PDF con todos los tipos de entidad del workspace**, sin importar desde qué pestaña se dispare — portada, resumen general, y por cada tipo (Proveedores, Clientes, etc.) una página divisoria con el nombre del tipo seguida del detalle de cada entidad de ese tipo
- `exportAllEntitiesPdf({ workspaceId, customStates, workspaceName })` en `src/lib/exportEntitiesPdf.js` hace sus propias queries por `workspace_id` (todos los `entity_types` y todas las `entities`) en vez de recibir la lista ya acotada a un tipo que traía la pestaña activa
- Resumen general suma una línea "ENTIDADES POR TIPO" (ej. "5 Proveedores · 3 Clientes"). Las páginas divisorias son navy de ancho completo (mismo estilo que la portada) y no llevan pie de página — se arma explícitamente la lista de páginas con footer en vez de aplicarlo a un rango continuo, para que ni el texto gris quede ilegible sobre navy ni la numeración final cuente las divisorias
- Una página por entidad (orden alfabético dentro de su tipo, numeración `#N` reiniciada por tipo) con sus contactos, mini-pills de cantidad de proyectos por estado, y tabla de sus proyectos vinculados (Producto/Estado/NDA/Territorios/Tareas pendientes)
- Adaptado al modelo de datos real de Nerva en vez de copiar la referencia literal — sin campo "Tipo" (no existe en `entities`), sin columna "#" en la tabla de proyectos (no hay numeración global), genérico respecto a los tipos de entidad configurados por workspace (usa `entity_types.name`/`.plural` reales, no hardcodea "Proveedores")
- Territorios, tareas pendientes e hitos de pago por proyecto no venían precargados en ningún lado — `fetchExtraData` hace 2 queries puntuales (`tasks`/`deal_milestones`) solo al generar el PDF; territorios y moneda se traen en la misma query de `negotiations`

### Fix: consistencia de altura de botones + editor de campos visible en las 3 vistas de Proyectos
- Los botones del toolbar de Proyectos y de Entidades no compartían la misma altura (padding vertical dependía del tamaño de fuente de cada botón) — reportado por el usuario con captura. Se fijó `height: 36px` + `box-sizing: border-box` en todos los botones/toggles de ambos toolbars
- El editor de campos visibles (renombrado "⚙ Columnas" → "⚙ Vista") se ocultaba en la vista kanban de Proyectos, lo que además hacía "saltar" el resto del toolbar al cambiar de vista — ahora está presente en las 3 vistas, y las cards de kanban reusan `renderCardField` (la misma función que ya usaba la vista mosaico) para respetar de verdad esa configuración en vez de mostrar un set fijo de campos

### Exploración: rediseño visual (sin implementar)
- Sesión de mockups en Artifacts para explorar una identidad visual más moderna que la actual (todo en cards blancas iguales) — se investigaron 4 direcciones (suave/moderno, minimalista, bold/vívido, depth-glass), después se refinaron 3 layouts distintos (suave con acento, bento moderno, clásico profesional) con el widget "Hoy" movido a barra horizontal arriba. Se acordó una dirección final (base suave + acento bold contenido a franjas de 3px solo en las tarjetas de arriba) y quedarse con 2 temas seleccionables desde Settings (Bento moderno por defecto, Clásico como alternativa) + toggle claro/oscuro — explícitamente pausado para una próxima sesión, nada de esto se tocó en código todavía

---

## 2026-07-28

### Feature: Primer paso del pivot entidad-céntrico (notas/tareas/timeline)
- Notas y tareas pueden colgar directo de una entidad (`entity_id`), sin necesitar un proyecto — `negotiation_notes.negotiation_id` ahora nullable + `entity_id` nuevo (constraint: al menos uno de los dos), `tasks.entity_id` nuevo. Componente `NotesPostIts` extraído y reusado en proyecto/entidad
- Tabla `activity_log` genérica (workspace_id, negotiation_id, entity_id, type, title, actor_id) + componente `ActivityTimeline`, usado en el detalle de proyectos y de entidades. El de la entidad agrega también la actividad de todos los proyectos vinculados a ella
- Vista de detalle de entidad rediseñada: la columna izquierda queda fija con Información + Contactos; la derecha pasa a pestañas (Actividad / Proyectos / Notas / Tareas) en vez de mostrar los proyectos por default
- Todos los modales grandes de detalle/edición (`.entity-detail-card--wide`, `.neg-detail-card`, `.neg-modal-card`) pasan a tener tamaño fijo (`90vw / max 1100px / 85vh`) en vez de `max-height` variable — antes se achicaban o agrandaban según el contenido de la pestaña activa

### Feature: Valor de deal por proyecto + pipeline
- `negotiations.currency` (selector) + tabla `deal_milestones` (nombre, monto, fecha estimada, `timing_note` de texto libre, sort_order) — desglose libre en vez de una estructura rígida de pago, para cubrir upfront/milestones/royalties/lo que sea con las mismas filas
- Componente `DealMilestones`, sección "VALOR DEL DEAL" en el detalle del proyecto y alta de hitos iniciales en el modal de creación
- Monto admite negativos (pagos que salen, no solo cobros) — se muestran en rojo y el total refleja el valor neto
- `timing_note`: campo de texto libre para cuando no hay fecha exacta ("al momento del lanzamiento"), se muestra junto a o en lugar de la fecha
- Los hitos ya cargados se pueden editar inline (nombre/monto/fecha/momento), no solo borrar
- Card "Valor de pipeline" en el Dashboard — suma los hitos de los proyectos en curso agrupados por moneda (sin conversión automática entre monedas)
- Misma card en la página de Proyectos, con selección múltiple de filas: muestra el total de los proyectos filtrados y un subtotal aparte de los seleccionados manualmente

### Feature: Descripción larga y documentos adjuntos por proyecto/entidad
- `negotiations.description` — reemplaza un campo `notes` legado que nunca tuvo control de UI (se guardaba vacío siempre). Sección "DESCRIPCIÓN" inline-editable en el detalle y campo en el modal de creación/edición, separado de "Observaciones internas" y de las notas post-it
- Tabla `documents` (polimórfica negotiation_id/entity_id, mismo patrón que notas/tareas/actividad) + bucket privado `documents` en Supabase Storage
- Componente `Documents` — subir (límite 20MB), listar con ícono/tamaño/quién subió/fecha, descargar vía signed URL, borrar. Sección en el detalle de proyecto y pestaña nueva ("Documentos") en el detalle de entidad
- Cierra los puntos 4 y 5 de la visión de producto entidad-céntrica (documentos era el hueco más obvio del diagnóstico original)

---

## 2026-07-06

### Feature: Sistema de invitación de usuarios y gestión de miembros
- Edge Function `invite-user` (Deno, `jsr:@supabase/supabase-js`): invita por email o suma directo al workspace si el email ya tiene una cuenta confirmada (usa `generateLink` en vez de `inviteUserByEmail` para no depender del rate limit del mailer default de Supabase — el link se muestra en la UI para copiar y mandar a mano hasta que haya SMTP propio)
- Solo el owner puede invitar/gestionar usuarios (antes era owner+admin), reforzado tanto en la Edge Function como en la UI
- Settings usa `effectiveRole` en vez de `role` — era la única página que no respetaba el preview de "ver como rol" del staff
- Panel de miembros: activar/desactivar, cambiar rol, eliminar, cancelar invitación pendiente — requirió sumar policies de RLS de UPDATE/DELETE en `workspace_members` que no existían (solo había SELECT)
- Trigger `handle_invited_user` no alcanzaba a limpiar la invitación pendiente al aceptar (corría antes de que se insertara la fila) — se resuelve borrándola desde `/set-password` con una policy de self-delete en `invitations`
- `/set-password` ahora también pide nombre completo, no solo contraseña

### Feature: Página de perfil de usuario (`/profile`)
- Editar nombre completo propio y cambiar contraseña, accesible para cualquier rol (a diferencia del resto de Settings)
- Acceso desde el nombre en el header (antes mostraba el email) y desde un ítem nuevo en el sidebar, visible también en mobile
- `AuthContext` expone `profile` (full_name, avatar_url, is_staff) y `refreshProfile()`

### Feature: Cascade tasks (tareas encadenadas)
- `tasks.predecessor_task_id`, seteable al crear o editar una tarea, con detección de ciclos (`src/lib/tasks.js`)
- Una tarea con predecesora sin completar aparece bloqueada (🔒) y no se puede marcar como hecha
- Owner/admin ven de qué tarea depende y quién la tiene; editor/viewer ven un texto genérico sin esa info — mismo patrón ya usado para ocultar tareas de terceros
- Fix de paso: `TaskModalInline` (crear tarea desde el detalle de un proyecto) tenía el `workspace_id` hardcodeado al workspace de Testing en vez de usar el activo

### Feature: Sistema de notificaciones in-app (desde cero)
- Tabla `notifications` (workspace_id, user_id, type, title, body, task_id, negotiation_id, read) + campanita con contador en el header
- Se borran al leerse — al hacer click, con "Borrar todas", o automáticamente si la tarea/situación se resuelve por otro camino. No se acumulan marcadas como leídas
- Click navega directo al proyecto o tarea correspondiente (`?openNeg=`/`?openTask=`, se limpian de la URL después de abrir)
- 5 eventos cubiertos: asignación de tarea, desbloqueo de cascada, cambio de rol / alta directa a un workspace, cambio de estado de un proyecto, y tarea por vencer/vencida + proyecto marcado inactivo (estos dos últimos vía cron propio `notify_pending_events()`, con marcadores `*_notified_at` para no reavisar lo mismo todos los días)
- Decisión explícita: bajas/remociones de workspace o de proyecto quedan siempre en silencio, no generan notificación

### Feature: Settings personal para cualquier rol
- Pestaña "Notificaciones" en `/settings` visible para todos los roles (las demás pestañas — Usuarios, Estados, Tipos de entidad, Workspace — siguen siendo owner/admin)
- Tabla `notification_preferences` (user_id + workspace_id + type): toggle on/off por tipo de evento, cada función que genera una notificación la chequea antes de insertar

### Correcciones técnicas
- `supabase.functions.invoke()` devuelve `data: null` en respuestas no-2xx — el mensaje de error real de la Edge Function quedaba oculto detrás de un fallback genérico; se agrega `extractFunctionError()` para leerlo desde `error.context`
- `listUsers()` sin `perPage` podía no encontrar usuarios existentes en proyectos con más de 50 cuentas (paginación default de la Admin API)

---

## 2026-06-25 / 2026-06-26

### Feature: Inactividad automática y manual
- Nueva columna `activity_status` (active / paused / inactive) y `last_activity_at` en `negotiations`
- Trigger `update_last_activity` — actualiza `last_activity_at` en INSERT/UPDATE y resetea a `active` si el proyecto estaba inactivo (auto-wake)
- Función SQL `mark_inactive_negotiations()` — marca como `inactive` proyectos con más de 120 días sin actividad
- pg_cron activado y configurado para correr esa función diariamente
- Botón Pausar / Reanudar en la vista detalle del proyecto
- Íconos: ⏸ para pausados (gris + grayscale), 💤 para inactivos (fondo celeste, sin grayscale)
- Filtro de actividad en la página de proyectos: En curso / Pausados / Inactivos / Baja actividad / Todos
- Banner global de alerta flotante (fixed, debajo del header) cuando hay proyectos con 90-120 días sin actividad — se puede cerrar y reaparece al recargar

### Feature: Columnas configurables por usuario
- Constante `ALL_COLUMNS` con 12 columnas posibles; `DEFAULT_VISIBLE` con las 7 principales
- Hook `useColumnPrefs(userId)` — persiste selección y orden en `localStorage` con clave `nerva_col_prefs_<userId>`
- `ColumnEditor` — componente con drag & drop (HTML5 nativo, sin librerías externas) para reordenar y checkbox para mostrar/ocultar
- La configuración aplica tanto a la vista tabla como a la vista mosaico
- En mosaico: Estado siempre fijo arriba a la derecha; el resto según configuración del usuario

### Feature: Notas tipo post-it
- Nueva tabla `negotiation_notes` (id, negotiation_id, workspace_id, content, note_date)
- RLS con `workspace_id = any((select public.my_workspace_ids()))` — el doble paréntesis es necesario para evitar error de set-returning function
- Las notas se gestionan exclusivamente desde la vista detalle del proyecto (no en el modal de edición)
- Colores pseudo-random entre 4 opciones (amarillo, celeste, verde, rosa) determinados por el id de la nota — la misma nota siempre tiene el mismo color
- Rotación leve (-3° a +3°) determinista combinando id + posición
- Al hacer hover: el post-it se endereza y agranda, aparece el botón ✕
- **Doble-click** para editar el texto inline — textarea transparente sobre el post-it, Enter guarda, Escape cancela
- En vista tabla/mosaico: las notas se muestran resumidas como `DD/MM: texto · DD/MM: texto`

### Feature: Edición inline en vista detalle
- **Estado del proyecto**: select con los colores del estado del workspace, guarda al instante
- **NDA**: select inline (Sí / No / En proceso / —), guarda al instante
- **Observaciones**: textarea siempre visible con `onBlur` para guardar, placeholder "Sin observaciones todavía."
- Cualquier cambio en un proyecto inactivo lo reactiva automáticamente (`activity_status → active`)

### Feature: Settings — paleta de colores para estados
- 9 colores preset con color de texto + fondo automático sugerido
- Toggle "Avanzado" que muestra pickers RGB separados para texto y fondo
- `bgManual` flag — si el usuario cambia el fondo manualmente, se desvincula del auto-sugerido
- Estado "Completado" protegido con ícono 🔒 — no se puede eliminar
- Confirmación en dos pasos antes de eliminar cualquier otro estado

### Mejoras UX: Modal de proyectos
- Ambos modales (detalle y edición) ahora son `90vw / max 1100px`
- Header azul sticky en ambos modales — siempre visible al hacer scroll
- Modal de edición: botones Guardar y Cancelar en el header junto a la X
  - **Cancelar**: cierra edición y vuelve al detalle (sin fetch, instantáneo)
  - **Guardar**: busca los datos actualizados y vuelve al detalle (sin parpadeo)
  - **X**: cierra todo
- Scrollbar movida del card (que tiene border-radius) al body interior — los bordes redondeados ya no se cortan

### Mejoras UX: Dashboard
- Stats dinámicos basados en los estados custom del workspace (excluye "Completado")
- Cards: "Proyectos en curso", "Completados", "Pausados", "Inactivos"
- Fix: `useEffect` dependía de `[]` — ahora depende de `[workspaceId]` para cargar al iniciar sesión

### Correcciones técnicas
- RLS error `set-returning functions are not allowed in policy expressions` — corregido con `any((select public.my_workspace_ids()))` en todas las policies afectadas
- Trigger DELETE con cláusula WHEN no puede referenciar NEW — separado en dos triggers (uno para INSERT/UPDATE, otro para DELETE)
- UUIDs de datos de prueba corregidos a formato hex válido

---

## Antes de 2026-06-25

### Base del proyecto
- Schema V2 completo en Supabase: workspaces, profiles, workspace_members, entity_types, entities, negotiations, negotiation_entities, tasks
- RLS con función helper `my_workspace_ids()` — devuelve los IDs de workspaces del usuario autenticado
- Trigger `handle_new_user` — crea perfil + workspace personal automáticamente al registrarse
- Auth con Supabase — login, sesión persistente, sign out
- Workspace switcher en header con dropdown
- Layout con sidebar colapsable y navegación por entity types dinámicos
- CountrySelector rediseñado como combobox con búsqueda inline, navegación con teclado, sin autocompletado del browser
- Settings: tipos de entidad con ícono Lucide, plural personalizable, edición inline, nombre del workspace editable
- Múltiples entidades por proyecto con rol opcional
