# Nerva — Pendientes y Roadmap

---

## ⚠️ REGLA FIJA — leer antes de tocar cualquier SQL de este archivo

**Antes de correr CUALQUIER cosa marcada como pendiente acá (`[ ]`), confirmar primero con el usuario que ese paso no esté ya hecho.** El avance real de la app no siempre queda reflejado en este archivo al mismo ritmo — algo puede haberse resuelto de otra forma, en otro momento, o directamente ya no ser necesario. Nunca asumir que un `[ ]` sigue representando el estado real solo porque nadie lo tildó. Si hace falta optimizar o reordenar algo más adelante, se ve en su momento — pero **nunca re-ejecutar/reescribir "porque sí"** sin chequear antes. (Instrucción explícita del usuario, 2026-08-11.)

---

## 🗺️ ROADMAP MAESTRO — Fases A–F (2026-08-17)

**Este es el punto de entrada para decidir qué sigue.** Nace de cruzar el análisis competitivo (CRMs, herramientas de deals complejos, gestores de tareas) con la devolución del usuario sobre esas ideas — [documento completo](https://claude.ai/code/artifact/26ff3ddf-ea1e-4861-a5b5-f57bffbbe816). El resto del archivo, más abajo, sigue siendo el detalle histórico/técnico de cada implementación — no hace falta leerlo entero para saber qué sigue, alcanza con esta sección. A medida que se cierra un ítem, se tilda acá **y** se deja la nota de implementación en la sección de detalle correspondiente (o una nueva, si es tema nuevo).

**Principio que ordena las fases** (ya venía de la sesión de repensada estratégica del 2026-07-06, sigue vigente): ¿esto mejora el producto de hoy además de servir a la visión larga (CRM robusto para PyMEs, después ERP)? Si una feature solo se justifica por el ERP imaginario del futuro, no se construye todavía. Una sola app, un solo backbone — nunca reconstruir aparte.

### Fase A — Cerrar lo abierto + cimientos baratos
- [x] **Dashboard real (2026-08-17)**: pipeline por etapa (valor de hitos de pago por estado no-terminal, por moneda), tiempo en etapa actual (promedio de días desde el último cambio de estado, vía `activity_log`), y tasa de cierre (% total que llegó a estado final + desglose por tipo de entidad vinculada). Deliberadamente sin "forecast" en $ — mezclaría Ganado/Perdido porque `custom_states` no tiene ese dato estructurado (`is_terminal`, no `is_won`); se puede sumar cuando exista esa distinción
- [x] **Capa de Organización a nivel de dato (2026-08-17)**: tabla `organizations` + `workspaces.organization_id` (nullable, aditivo) + RLS de solo-lectura (mismo criterio `my_workspace_ids()` que el resto de la app) — aplicado en producción, sin UI todavía (ningún workspace tiene `organization_id` seteado). El flujo para armar/asignar una organización se construye en la Fase D, junto con el dashboard unificado que lo va a usar
- [x] Módulo de Productos — confirmado 2026-08-17 contra la base real: tablas, seeds y `primary_product_id` ya estaban aplicados en ambos workspaces de equipo (Testing y Conderco). La nota de "SQL pendiente" estaba desactualizada
- [x] Pestañas huérfanas de Estados en Entidades/Tareas — confirmado 2026-08-17 que ya se habían resuelto (ver nota en la sección correspondiente más abajo), no había nada pendiente de decidir
- [ ] Panel de Settings puntual para el módulo Financiero (mencionado al cerrar Comisión, deferred a propósito)

### Fase B — Actividad automática + el diferencial de gobernanza
- [ ] **MVP de captura de actividad por mail (2026-08-17, construido — faltan 2 pasos manuales del usuario para activarlo)**: CCeás `log@gonerva.com` en un mail a un contacto ya cargado en Nerva, y queda logueado en la bitácora de esa entidad. Deliberadamente vía CC, no forward (headers estructurados, matcheo confiable) — no es el sync OAuth completo de Gmail/Outlook (ver "Qué dejamos afuera a propósito").
  - Plan original era un subdominio propio (`log.gonerva.com`) — el plan de Resend solo permite 1 dominio, ya usado por `gonerva.com` para las invitaciones. Decidido con el usuario: se habilitó "receiving" sobre el mismo `gonerva.com` en vez de actualizar el plan — confirmado que no toca los registros DNS de envío ya verificados (son nombres distintos: `send.gonerva.com` vs el registro nuevo en la raíz)
  - Edge Function `inbound-email-log` (deployada, `verify_jwt: false` — la autenticación es la firma Svix de Resend, no un JWT de Supabase): recibe el webhook `email.received`, verifica la firma HMAC-SHA256, matchea el remitente contra `profiles.email`, busca en `to`/`cc` alguna dirección que matchee `contacts.email` dentro de los workspaces de equipo de ese usuario, y loguea `activity_log` (`type: 'email_logged'`) contra la entidad — no contra un proyecto puntual (mismo criterio "entidad como hub"). Sin matcheo, se descarta en silencio
  - Webhook de Resend creado (evento `email.received` → esta función)
  - **Pendiente, acción manual del usuario (no lo puedo hacer yo)**:
    1. Agregar el registro DNS nuevo en el proveedor de gonerva.com (Vercel → dominio → DNS Records): `MX` en la raíz (@) → `inbound-smtp.sa-east-1.amazonaws.com`, prioridad 10
    2. Configurar el secret `RESEND_INBOUND_WEBHOOK_SECRET` en Supabase (Edge Functions → Secrets) con el valor `whsec_pDflOYm7yoY9OzebFVUOu6xOrl6q8WtlI` — Resend solo lo muestra una vez, ya está guardado acá por eso
  - No cubre el caso de que un contacto le "responda a todos" a un hilo viejo (el remitente en ese caso no es un usuario de Nerva) — anotado como limitación conocida de v1, no bloqueante
- [x] **Motor de aprobaciones — catálogo de reglas, no solo comisión (2026-08-17)**: el usuario pidió explícitamente revisar dónde más servía y poder elegir cuáles usar. Se generalizó a una tabla `approval_rules` (`workspace_id, rule_type, enabled, approver_id, threshold_numeric`), cada regla con su propio on/off en Settings → Workspace → "Reglas de autorización" — nada se activa por defecto, sin aprobador designado la regla no se puede prender. Aprobador siempre una persona específica (no owner/admin genérico). Helper compartido `src/lib/approvals.js` (`getApprovalRule`/`isApprovalRuleEnabled`/`isApprover`/`shouldRequireTaskApproval`/`requestNegotiationCloseApproval`).
  - **Comisión** (la original, migrada a este modelo — `workspaces.commission_approval_*` se borraron, nadie las había usado): umbral en %. `negotiation_price_history.commission_approval_status`, tarea real asignada al aprobador (`tasks.price_history_id`), botones Aprobar/Rechazar en `PriceHistory.jsx`
  - **Tareas** (nueva, pedido explícito del usuario — su ejemplo del gasto que supera un monto): pide autorización si se tilda a mano, o si el monto cargado supera el umbral configurado (cualquiera de las dos alcanza). `tasks.requires_approval/amount/approval_status/approved_by/approved_at`. Reusa `isTaskBlocked()` (ya consumida por Tasks/Negotiations/Entities para el bloqueo por dependencia) para bloquear también "completar" mientras está pendiente — un solo cambio cubrió las 3 páginas. UI de autorizar/rechazar en `TaskDrawer.jsx`; checkbox + monto en `TaskModal.jsx`/`TaskDrawer.jsx` (no en las altas rápidas — inline de proyecto/entidad, "Tareas iniciales" — se puede marcar después desde el detalle)
  - **Cierre de proyecto** (nueva): NO bloquea el cambio de estado — se aplica normal y queda marcado `negotiations.close_confirmation_status = 'pending'` (con `close_requested_from_status` para poder revertir) hasta que el aprobador lo confirme o lo revierta. Enganchado en los 4 lugares que cambian `negotiations.status` (inline, modal completo, Kanban, cambio en lote) vía un único helper compartido. Banner en el detalle del proyecto con Confirmar/Revertir, visible al aprobador
  - Deliberadamente ninguna regla bloquea nada mientras está pendiente (mismo criterio "poco intrusivo" en las 3) — se marca y se notifica, se puede seguir trabajando

### Fase C — IA aplicada — **salteada por ahora (2026-08-20), retomar cuando el usuario lo pida**
El usuario no quiere entrar en gastos de IA todavía por la extracción de documentos ("que lo hagan a mano, la configuración de campos no es algo de todos los días") — esa idea queda descartada, no solo pausada, salvo que la retome explícitamente. En cambio, cuando se retome esta fase, **el punto de entrada no es la extracción de documentos — es un chatbot interno** (ver diseño abajo), pedido explícito del usuario.
- [ ] **Chatbot interno sobre los datos del workspace** (idea nueva del usuario, 2026-08-20, no implementado — bloqueado en conseguir API key de Anthropic): responde preguntas en lenguaje natural sobre los datos de negocio del WS activo ("cuántos proyectos tengo con tal proveedor") y **nada de fuera de ese workspace**. Diseño acordado: nunca SQL libre ni acceso directo a la base — un set chico de herramientas concretas (contar/buscar/sumar con filtros) que la IA elige y arma, pero cada una corre como una consulta normal de Supabase **autenticada como el usuario que pregunta**, así que el aislamiento por workspace lo garantiza el mismo RLS de siempre, no el prompt. Falta decidir: ubicación en la UI (panel flotante vs. pestaña nueva) y si conviene un límite diario/mensual de uso por workspace como salvavidas de costo.
- [ ] Extracción de documentos → alta semi-automática (descartado por costo, ver arriba — no retomar sin que el usuario lo pida de nuevo)
- [ ] Notas de una reunión → tareas sugeridas (con dependencias si corresponde)
- [ ] Resumir un hilo de mail largo en una nota de bitácora (depende de que exista la Fase B)
- [ ] Búsqueda en lenguaje natural sobre reportes ("qué proyectos con X están parados hace 20 días") — probablemente se resuelve con el mismo chatbot de arriba en vez de ser un escalón aparte

### Fase D — Mirar hacia afuera + Organización completa
- [ ] Portal de solo lectura para la contraparte (deal room): estado del deal, documentos, cronograma — reusa datos existentes, sin modelo nuevo
- [ ] Recomendador de oportunidades sobre datos propios: entidades parecidas a una activa sin negociación en curso, productos nunca ofrecidos a una entidad dada — arranca como reglas simples, se puede llevar a IA después
- [ ] Vista unificada de Organización (dato ya modelado desde la Fase A): dashboard agregado entre todos los workspaces de una misma empresa
- [ ] Generalizar el motor de aprobaciones más allá de precio (gastos, tareas gateadas por rol) — solo si para entonces hay uso real multi-departamento que lo pida

### Fase E — Infraestructura para vender como SaaS
Ya diseñado en detalle más abajo (ver "ETAPA 2" y "FASE 2" — planes, Stripe, self-registration, landing, panel Super Admin). No hace falta repensarlo, solo ejecutarlo cuando el CRM esté probado con más de un cliente pago.
- [ ] API pública / webhooks
- [ ] Self-registration + planes (Free/Starter/Pro/Business) + Stripe
- [ ] Landing GoNerva con pricing + panel Super Admin

### Fase F — Impronta propia (jueguitos, con personalidad)
**Explícitamente al final** — a pedido del usuario, recién cuando las fases A–E ya estén andando, no antes. Ideas ancladas a datos que Nerva ya tiene, no gamificación genérica:
- [ ] Animación de cierre (confeti sutil, descartable) al mover una negociación a estado terminal-ganado, con el valor acumulado del trimestre "tickeando" en vivo
- [ ] Racha de actividad por usuario (ícono tipo llama, días consecutivos con actividad real) — convierte la alerta de inactividad de negativa a motivadora
- [ ] Mapa de calor de actividad por negociación, estilo contribution graph, en la vista de cada deal — reutiliza datos que ya existen en `activity_log`
- [ ] "Salud del deal" como metáfora visual (crece con progreso, se marchita con inactividad) en vez de un semáforo numérico
- [ ] Badges de hito a nivel workspace ("10 deals cerrados", "primera joint venture firmada") en un scoreboard de equipo — sin XP individual
- [ ] Recap trimestral automático por workspace, estilo Spotify Wrapped: deals cerrados, valor total, ciclo promedio
- [ ] Empty states con personalidad en workspaces nuevos sin datos, con un guiño al rubro del cliente

### Qué dejamos afuera a propósito
- **Inteligencia de mercado externa** (tipo ZoomInfo/Dealfront) — infraestructura de datos de terceros cara, categoría de producto distinta. El punto de "mirar afuera" se resuelve con datos propios (Fase D), no ajenos
- **Sync completo OAuth de email/calendario** de entrada — se arranca con el MVP de "reenviar para loguear" (Fase B), se sube a sync completo solo si un cliente grande lo justifica
- **UI del dashboard de Organización antes de tiempo** — el dato se modela en la Fase A, la pantalla se construye recién en la Fase D
- **Generalizar aprobaciones a todo tipo de gasto/tarea desde el día uno** — arranca acotado a precio/comisión (ya tiene el dato), se generaliza solo con demanda real multi-equipo

---

## 🛡️ ACCESO DE SOPORTE PARA STAFF (2026-08-18 a 22) — núcleo + solicitud de acción por rol construidos, falta la ventana de ayuda y la vista redactada

Reemplaza el hack manual de SQL que se venía usando para que el staff (Gervasio, `is_staff=true`) entre a un workspace de un cliente a ayudar. No encaja en ninguna Fase A–F del roadmap (es herramienta interna, no producto de cliente) — queda como iniciativa propia. Diseñado en varias vueltas de conversación con el usuario; acá el diseño final acordado, para no perderlo.

### El problema con la versión anterior
Acceso manual vía SQL directo en Supabase — sin registro, sin vencimiento, sin que el cliente supiera ni consintiera activamente.

### Flujo de acceso — [x] construido (2026-08-18/19)
Siempre es lo mismo, sin importar cómo llegó el código: **un código que identifica al workspace + una aceptación activa, en el momento, de alguien presente del lado del cliente.** Nunca se entra sin que alguien confirme ahí mismo, aunque el código ya se haya generado antes. Dos formas de que el código llegue al staff (no dos flujos de acceso distintos — el resto es idéntico):
- **Vía ticket**: desde una "ventana de ayuda" (todavía sin construir, ver más abajo) el owner/admin cuenta el problema; el ticket cae en la cola compartida del staff (`Profile → Staff`) y cualquiera lo puede tomar.
- **Vía código directo**: el owner/admin genera el código desde `Configuración → Workspace → Acceso de soporte` y se lo pasa a mano a un miembro puntual del staff, por fuera de la app (mensaje, llamada, lo que sea).

1. El código se genera (ticket o directo) — tabla `access_grants`, estado `open`.
2. Un miembro del staff **toma el código** (tipeándolo en `Profile → Staff`, o tomando un ticket de la cola). Esto NO da acceso todavía — pasa a `pending_confirmation` y le llega una notificación al creador del grant.
3. **Alguien del workspace (owner/admin) tiene que confirmar activamente, en ese momento**, desde `Configuración → Workspace → Acceso de soporte` — recién ahí se crea la membership real (`workspace_members`).
4. Vencimiento automático — duración elegible (24h/48h/72h/ilimitado), pero **el sistema le pone un techo duro de 30 días siempre**, incluso si se eligió "ilimitado". Barrido por cron cada hora (`expire_access_grants`) que saca solo de `workspace_members` lo vencido.
5. El owner puede revocar en cualquier momento (mismo botón, saca de `workspace_members` al toque).
6. Rol asignable: cualquiera de los 4 existentes, **incluido owner temporal**.

Modelo de datos: `access_grants` (una sola tabla) con estados `open → pending_confirmation → active → expired/revoked/declined/cancelled`, todas las transiciones vía funciones `SECURITY DEFINER` (`create_access_grant`, `claim_access_grant`, `confirm_access_grant`, `decline_access_grant`, `revoke_access_grant`, `cancel_access_grant`, `expire_access_grants`) — sin policies de insert/update directas, ver `supabase/migrations/20260818140000_staff_access_grants.sql`.

UI: bloque "Acceso de soporte" en `Configuración → Workspace` (owner-only: generar código, ver estado de los grants del workspace, confirmar/rechazar/revocar) y bloque "Acceso de soporte" en `Perfil → Staff` (ingresar código a mano, ver cola de tickets abiertos de cualquier workspace y tomarlos, ver mis accesos en curso).

**Sumado 2026-08-21/22, a pedido del usuario:**
- [x] `access_grants.ticket_number` (identity, global, no por workspace) — trazabilidad simple ("Ticket #N") en vez de manejarse solo por uuid/código. Se muestra en la cola, en "mis accesos" y del lado del owner
- [x] Burbuja roja con la cantidad de tickets abiertos en el ícono de "Mi perfil" del sidebar (visible para cualquier staff, se refresca cada 60s) + el mismo contador como badge en la solapa "Staff" dentro de Perfil — así se enteran de que hay algo pendiente sin depender de la campana de notificaciones
- [x] El propio staff que tomó el acceso lo puede cerrar él mismo (antes exclusivo de owner/admin — `revoke_access_grant` ahora acepta también a `claimed_by`), con un mensaje opcional para contarle al workspace qué pasó (`resolution_message`, notificado a quien generó el código). Mismo mensaje disponible del lado del owner al revocar

### Bitácora
- **No hay "deshacer" de nada** — decisión explícita del usuario, esto no es un sistema de undo.
- [x] **construido (2026-08-18)**: `workspace_membership_log`, quién entra y sale de cada workspace (staff o no), con fecha/hora/quién lo autorizó — trigger sobre `workspace_members` (`log_membership_change`), no hace falta que ningún camino del código se acuerde de loguear a mano. UI: bloque "Historial de accesos" en `Configuración → Usuarios`.
- [ ] Sigue pendiente: identificar en la bitácora de actividad que YA EXISTE (Proyectos/Entidades) qué acciones hizo el staff, en el mismo lugar donde ya se mira (no un panel aparte) — usando el flag `profiles.is_staff` que ya existe, mostrando algo tipo "🛡️ Staff" al lado del actor en `ActivityTimeline`. Casi gratis, no hace falta columna nueva.
- **Gap encontrado, a confirmar antes de dar por completo**: Productos no tiene timeline de actividad todavía (su pestaña "Bitácora" hoy es solo las notas post-it) — si se quiere la misma visibilidad ahí, hay que sumarle `ActivityTimeline` primero, calco de Proyectos/Entidades.
- Tampoco confirmado que el 100% de las acciones posibles generen hoy una entrada en `activity_log` (ej. editar un campo custom no está claro que loguee) — revisar antes de prometer cobertura completa para las acciones del staff.

### Qué puede ver el staff
- Toggle independiente por categoría: Proyectos / Entidades / Productos (no solo Financiero, que es más fino — ocultar Financiero es una restricción DENTRO de Proyectos, no reemplaza al toggle de categoría).
- **Siempre oculto, sin importar la configuración**: datos de contacto (personas/teléfono/mail de encargados, ni en proyectos ni en entidades) y documentos cargados. Sin excepción.
- [ ] **No construido todavía** — hoy `access_grants` guarda el rol pero no hay enforcement de visibilidad por categoría ni el toggle en la UI. Falta antes de dar el sistema por completo.
- [ ] **Fase B de esto (deferida, "la pensamos bien más adelante")**: cuando una categoría está oculta, en vez de desaparecer del todo, mostrar el registro "redactado" — número visible, nombre/detalle tapado (tipo contraseña con asteriscos), pero con algo de contexto técnico/estructural (estado, fechas, si tiene tareas pendientes) para que el staff pueda diagnosticar sin ver el contenido real del cliente. Circular por definir campo por campo qué queda "identidad" (se tapa) vs. "estructural" (se ve).
- [ ] **Ventana de ayuda — no construida todavía**: página nueva, visible a todos los roles, con FAQ/asistente y la sección "Solicitar asistencia" (solo admin/owner) desde donde armar el ticket contando el problema. Hoy generar un código (directo o como ticket, con el checkbox "Mandar como ticket") solo se puede desde `Configuración → Workspace → Acceso de soporte` — funciona, pero no es la experiencia pensada para un cliente que busca ayuda; falta esta página dedicada con FAQ/asistente antes de dar el flujo de ticket por completo.

### Numeración — [x] construido (2026-08-18)
Pedido explícito del usuario para arrancar por acá, "que es más sencilla" — y además es útil por sí sola, no solo para el tema staff: cada Proyecto/Entidad/Producto tiene un número secuencial, estable, por workspace (tipo fila de Excel), visible en **todas las vistas** (tabla, mosaico, kanban, detalle) para **todos los roles**, no solo para cuando hay un acceso de staff restringido.
- `workspace_counters` (workspace_id, counter_name, current_value) + `next_workspace_counter()` — atómico vía UPDATE con lock de fila, seguro con inserts concurrentes (a diferencia de un simple `max()+1`)
- Un solo trigger (`set_display_number`, usa `TG_TABLE_NAME` como nombre del contador) reusado en `negotiations`/`entities`/`products` — asigna el número en el insert, nunca se reasigna ni se recicla
- Backfill de lo ya existente en orden de `created_at`, contador de cada workspace dejado en el máximo asignado
- Frontend: columna "#" fija (no ocultable) en `TableGrid` (compartida por las 3 páginas), badge `#N` en `CardTile`/Kanban, y en el header de cada detalle (Proyecto/Entidad/Producto)
- **Pendiente, deferida a propósito**: la vista "redactada" (parte B del acceso de staff) que usa esta numeración para referenciar un registro sin mostrar su contenido — se decide más adelante

### Solicitud de acción de staff por encima de su rol real — [x] construido (2026-08-22)
El usuario probó el sistema y encontró que, siendo staff, veía TODO sin límite sin importar el rol que le hayan dado en el acceso de soporte — el selector "ver como" (`RoleImpersonator`) no tenía techo, cualquier `is_staff` podía elegirse "Owner" ahí. Primero se probó ponerle un techo (solo dejar bajar de privilegio, nunca subir), pero el usuario lo pensó mejor y prefirió **dejar la vista sin límite** (útil para diagnosticar) y en cambio **gatear la acción, no la vista**: el staff puede seguir viendo cualquier rol, pero si actúa con un privilegio por encima de su rol real en ese workspace (ej. le dieron 'admin' pero intenta borrar a alguien, algo de owner), la acción no se ejecuta directo — queda pendiente hasta que un owner del workspace la aprueba. No aplica a usuarios normales (un cliente sin el rol ni ve el botón, gateado por `effectiveRole`), es exclusivo del caso de staff con un acceso de soporte de rol más bajo que el que necesita para una acción puntual.

**Alcance** (acciones que hoy son owner-only en la app — no es un proxy genérico de "cualquier acción posible", eso sería un proyecto aparte):
- Miembros (`Configuración → Usuarios`): invitar, cambiar rol, desactivar/reactivar, eliminar
- Borrado masivo de Proyectos/Entidades/Productos
- Alertas de inactividad y Reglas de autorización (`Configuración → Workspace`)

**Hallazgo de paso, corregido antes de construir esto**: el borrado masivo de Proyectos/Entidades/Productos no estaba restringido a owner en la base — la UI lo escondía si no eras owner, pero el RLS de esas 3 tablas era "cualquier miembro activo" para todo (insert/update/**delete**), sin distinguir por rol. Un viewer podía borrar por API directa aunque el botón esté escondido. Se separó la política única "ALL" en policies por comando, dejando el DELETE exclusivo a owner (`is_workspace_owner()`, mismo helper que ya usaban `workspace_members`/`approval_rules`) — sin este ajuste, la solicitud de aprobación para borrado masivo no hubiera servido de nada.

**Modelo de datos**: `staff_action_requests` (workspace_id, requested_by, action_type, payload jsonb, status `pending→approved/rejected/cancelled`, reviewed_by/at, resolution_message) — mismo patrón `SECURITY DEFINER` sin policies de insert/update directas que `access_grants`. Funciones: `request_staff_action`, `approve_staff_action` (un `case` por `action_type`, ejecuta la mutación real), `reject_staff_action`, `cancel_staff_action_request`. La única excepción es **invitar**: como necesita la Admin API de Supabase Auth (no se puede desde una función SQL), el pedido y la aprobación viven en la Edge Function `invite-user` (acción `invite` deriva a pendiente si el caller es staff no-owner; acción nueva `approve_staff_invite` para que el owner la apruebe).

**Frontend**: helper compartido `src/lib/staffActions.js` (`withOwnerApproval()` — ejecuta directo o pide aprobación según si `isStaff && role !== 'owner'`), interceptado en los handlers de Usuarios/Workspace/borrado masivo de las 3 páginas. Panel "Solicitudes de staff pendientes" (owner-only) en `Configuración → Workspace`, y "Mis solicitudes" (con su estado) en `Perfil → Staff`.

Probado de punta a punta (pedido → aprobación, y que el RLS nuevo bloquea el borrado directo de un viewer) en un workspace descartable antes de aplicar — ver metodología de testing en la sección de arriba de `access_grants`.

---

## 📍 Para la próxima sesión — empezar por acá (cierre de la sesión larga del 2026-08-11)

Sesión larga de rediseño de Proyectos/Productos/Entidades. Todo el código quedó commiteado y pusheado a `claude/session-status-check-4r6t8e` (no mergeado a `main` — el último merge+deploy a producción fue a mitad de esta sesión, commit `f4176cb`; hay commits nuevos arriba de eso sin mergear todavía, esperar a que el usuario pida el próximo merge). Ver `CHANGELOG.md` para el detalle completo, entradas del `(9)` al `(25)` del `2026-08-11`.

**Lo primero que hay que resolver — SQL sin confirmar que haya corrido** (3 tandas, todas con el mismo criterio: preguntarle al usuario si ya las corrió antes de asumir nada):
1. `negotiation_price_history.product_id` (uuid, FK a `products`) + `.presentation` (text) — necesarias para que el Panorama comercial del Producto y el picker de presentaciones en Financiero funcionen de verdad
2. `negotiation_notes.product_id` (uuid, FK a `products`) — necesaria para la Bitácora del Producto
3. `entities.needs_review` (boolean) + `products.needs_review` (boolean) — necesarias para el flujo de "crear al vuelo" desde un proyecto y el filtro "Para completar"

El SQL exacto de cada una está en la sección "Modal de Producto — Panorama comercial + Bitácora" y "Crear entidades/productos al vuelo..." más abajo en este archivo.

**Conexión a Supabase**: en esta sesión apareció una integración de Supabase (herramientas `mcp__Supabase__*`) pero se desconectó repetidas veces y nunca quedó estable — todo el SQL de esta sesión se le pasó al usuario para correr a mano en el editor de Supabase, no se corrió nada directo. Si en la sesión nueva la conexión está disponible y estable, usarla; si no, seguir con el flujo de siempre (pasar el SQL en el chat).

- **[x] Comisión (2026-08-14)**: implementado como se había acordado — campo `commission_pct` (numeric, nullable) en `negotiation_price_history`, un % opcional por entrada del historial de precio (no distingue proveedor/comprador). UI en `PriceHistory.jsx`: input en el alta (por línea/presentación), en la edición inline, y se muestra junto al precio cuando está cargado. **Pendiente, a pedido explícito del usuario**: pensar un panel de Settings puntual para el módulo Financiero (más personalizable) — se revisa una vez que esté todo lo demás deseado del módulo, no ahora.

## Auditoría de arquitectura (2026-08-11) — estado confirmado

Se hizo una auditoría completa de cruft/inconsistencias en el código (agente en background) más una ronda de confirmaciones directas del usuario sobre SQL que este archivo tenía como pendiente/sin verificar:

- **[x] Confirmado por el usuario — políticas RLS de `negotiation_price_history`**: corridas, funcionando bien. (Antes en CHANGELOG como "no corrido desde acá, sin credenciales de Supabase" — dato desactualizado, dejar de considerarlo pendiente.)
- **[x] Confirmado por el usuario — backfill de `entities.secondary_entity_type_id` + `negotiation_entities.role`**: corrido, roles funcionando bien en Proyectos.
- **[x] Corregido en código (sin SQL)**: `NegotiationModal.handleSave` ignoraba errores de guardado de Supabase (a diferencia de `EntityModal`/`ProductModal`, que sí los chequean) — si fallaba el `update`/`insert`, el modal se cerraba igual mostrando éxito falso. Ahora chequea `error` en ambos casos y muestra el mensaje al usuario sin cerrar el modal.
- **[x] Corregido en código (sin SQL)**: un usuario desactivado (`workspace_members.status`) seguía apareciendo como asignable en varios selectores que no filtraban por `status = 'active'` (crear tarea, reasignar tarea, elegir participante en Proyecto, etc. — en `Tasks.jsx`, `TaskModal.jsx`, `TaskDrawer.jsx`, `Negotiations.jsx`, `Products.jsx`, `Entities.jsx`). Unificado: todos los fetches de `workspace_members` para poblar un selector ahora filtran `status = 'active'` (la única excepción intencional es la tabla de administración de usuarios en Configuración, que sí necesita ver a los inactivos).
- **[x] Corregido en código (sin SQL)**: CSS muerto de layouts viejos (pre-unificación de tablas, banner de inactividad duplicado, selector de workspace "opción B" nunca usada, etc.) — borrado en `Entities.css`, `Dashboard.css`, `Settings.css`, `Layout.css`, `CountrySelector.css`. Cero cambio visual, confirmado con build.
- **[ ] Sigue sin confirmar / necesita la base de datos real para reconciliar**: el bloque grande de SQL pendiente de "todo campo pasa a ser campo custom real" (`storage_column`/`is_structural` en `custom_field_definitions`, drop de `negotiations.territories`/`negotiations.nda`, seed de 14 presets — ver sección más abajo) sigue marcado `[ ]` sin que el usuario lo haya confirmado explícitamente. Dado que la app funciona con normalidad usando ese modelo, probablemente ya corrió — **pero no asumirlo, confirmar con el usuario antes de tocar nada ahí**.
- **[ ] Producto, no bug**: las notas "fijadas" a una página (Financiero/Tareas/Documentos) del proyecto aparecen mezcladas con las notas de Bitácora dentro de la columna genérica "Notas" de la tabla/tarjetas y en el PDF export (`exportPdf.js`) — no se tocó, a confirmar si es el comportamiento deseado o si hay que separarlas ahí también.
- **`custom_field_definitions.filterable`**: confirmado que ya no se usa para nada (el filtrado es 100% por `field_type` ahora vía `isFieldFilterable()`), pero se sigue grabando en cada workspace nuevo (`seedWorkspaceDefaults.js`). Queda anotado, no se tocó todavía.

## Modal de Producto — Panorama comercial + Bitácora (2026-08-11)

Rediseño del modal de Producto: pestaña "Panorama comercial" (agrupa el historial de precio de todos los proyectos vinculados por presentación/moneda — mín/máx/último), pestaña "Bitácora" (mismo registro cronológico que Proyectos/Entidades, sin post-its por ahora), Resumen nuevo en la sidebar. Motivado por un caso real de farma: un mismo producto puede tener presentaciones distintas (ej. Ibupirac x20 comp vs x10 comp) con precios concurrentes dentro de la misma negociación — no son cotizaciones separadas en el tiempo, son SKUs distintos del mismo cierre. Se evaluó modelarlo como catálogo de SKU + jerarquías de familia (lo "correcto" a largo plazo, según el usuario) pero se decidió ir primero por la versión liviana (campo `presentation` de texto libre) porque migra limpio a SKUs reales el día que haga falta: por cada combinación (producto, presentación) ya cargada se puede crear el SKU nuevo, colgarlo de una familia, y re-vincular las filas existentes sin perder histórico.

**Comisión**: implementado 2026-08-14, ver nota arriba — `commission_pct` en `negotiation_price_history`, sin distinguir el lado que la absorbe.

##### SQL — ya aplicado (confirmado 2026-08-14, el archivo estaba desactualizado)
- [x] `negotiation_price_history.product_id`, `.presentation`, `.commission_pct`
- [x] `negotiation_notes.product_id`

## Crear entidades/productos al vuelo desde el proyecto + detección de similares (2026-08-11)

Buscador de Entidades (por tipo) y de Productos, dentro del modal de proyecto, suma "+ Crear" cuando no hay match — antes de crear corre el mismo matcher de los imports (`src/lib/entityMatching.js`, reusado sin cambios) y si encuentra algo parecido ofrece usar lo existente en vez de duplicar. Para entidades, si el match tiene otro tipo, se puede usar la existente sumándole el tipo nuevo como secundario. Motivado por el caso real: crear un proyecto completo (cliente + producto pedido) aunque todavía no exista el producto en catálogo ni tenga proveedor asignado.

- Componente nuevo `EntityTypeCombobox` en `Negotiations.jsx` (reemplaza el `<select>` plano que tenía cada tipo de entidad en el alta de proyecto)
- Producto creado al vuelo se cuelga de un tipo `"Sin categorizar"` (se crea una sola vez por workspace, vía `ensureUncategorizedProductType()`, se reusa después)
- Marcador `needs_review` en ambas tablas — cualquier entidad/producto creado por este atajo (o vía "crear de todos modos" del resolver de similares) queda tageado; Productos y Entidades suman un chip clickeable "Para completar (n)" que filtra por eso

##### SQL — ya aplicado (confirmado 2026-08-14)
- [x] `entities.needs_review`, `products.needs_review`

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
Puntos 1 a 5 completos, funcionalidad probada. De los huecos originales del diagnóstico quedan: ~~kanban visual~~, ~~búsqueda global~~, ~~export a Excel/PDF~~, ~~scorecard de proveedor~~, ~~@menciones~~, ~~bulk actions/import~~ y ~~alertas de vencimiento de NDA/contrato~~ (resuelto vía campos custom, ver abajo) — queda API/webhooks.

- Alertas de vencimiento de NDA/contrato — durante un buen tiempo estuvo descartado porque `nda` era un campo hardcodeado en `negotiations` ("no tiene sentido construir alertas sobre un dato que va a cambiar de modelo pronto"). Con el sistema de campos custom (ver abajo) ese momento llegó — NDA se resembró como un campo "con seguimiento" con alertas configurables
- Sin API/webhooks — sin definir fecha todavía, tiene sentido cuando haya una necesidad concreta de integración externa

### Salto a Etapa 2: primer paso hacia "CRM con todas las letras" (venta enterprise 1:1, todavía sin self-registration/billing/landing)
El usuario aclaró explícitamente: no es el momento de plantarse en el mercado como SaaS self-serve (eso sigue siendo Etapa 2 completa — self-registration, billing, planes, landing). Pero sí es el momento de dejar de vender "a mano" en el sentido de que cada cliente nuevo con necesidades de datos distintas requiera que el desarrollador toque código. **Campos custom por workspace** es la pieza de mayor apalancamiento para eso — quedan para después (con o sin más contexto de uso real primero): permisos a nivel proyecto (`project_members`, ya diseñado en Etapa 2), reportes/vistas guardadas, notificaciones por email, SSO, integración de email/calendario.

#### Campos custom por workspace + campo "con seguimiento" (Proyectos y Entidades)
- [x] **Arquitectura data-type-driven**, decidida explícitamente por el usuario: el `field_type` define el comportamiento (guardado/validación/render/export); el `label` es 100% texto libre que define cada workspace — nunca se hardcodea lógica por nombre de campo. Tipos v1: texto libre, texto largo, numérico, fecha, casilla, lista desplegable, selección múltiple, y **campo con seguimiento**
- [x] Tabla nueva `custom_field_definitions` (`workspace_id, object_type ['negotiation'|'entity'], key, label, field_type, options jsonb, sort_order`), mismo patrón RLS que `custom_states`/`entity_types` (`my_workspace_ids()`). Columna `custom_fields jsonb` nueva en `negotiations` (no tenía ninguna columna jsonb hasta ahora) + `custom_field_alerts jsonb` en `negotiations` y `entities` (marcador de alertas ya avisadas, por campo)
- [x] Valor guardado envuelto en `{ value, updated_at }` (nunca un escalar suelto) — `updated_at` lo mantiene únicamente la app, comparando contra el valor anterior en cada guardado (`mergeCustomFieldValue`, `src/lib/customFields.js`). Esto es lo que permite que el modo "inactividad" de un campo con seguimiento funcione genérico, sin bookkeeping aparte por cada punto de guardado — mejora sobre el patrón de `due_soon_notified_at` que necesita un reset manual explícito
- [x] **Campo "con seguimiento"**: no es un 9° tipo separado — es un valor normal (texto/lista/fecha, `underlying_type`) más una config de alerta (`trigger_mode`: fecha límite o inactividad, elegido por campo al crearlo; `alert_days`, configurable). Esto es lo que le permite a NDA convertirse en un campo con seguimiento sin inventar un tipo aparte
- [x] Settings → pestaña nueva "Campos personalizados": toggle Proyectos/Entidades, alta con selector de 8 tipos + sub-formulario condicional (opciones para lista/multi-select, disparador+días para "con seguimiento"), edición inline (label, opciones, días — el tipo y el modo de disparo quedan inmutables después de creado, cambiar la forma de un valor ya guardado es semánticamente complicado). Borrar un campo no borra los valores ya cargados, solo deja de mostrarlo
- [x] **Bug real encontrado y corregido en el camino**: `EntityModal.jsx` (y su versión de importación) sobreescribía el objeto `custom_fields` entero en cada guardado (`custom_fields: { company_type: ... }` reemplazaba todo) — cualquier campo custom nuevo se hubiera borrado solo la próxima vez que alguien editara datos básicos de la entidad. Corregido para mergear siempre, nunca reemplazar (`mergeCustomFieldValues`). Verificado con un test de regresión específico: editar el sitio web de una entidad ya NO borra su `custom_fields.company_type` ni ningún campo custom cargado
- [x] `NegotiationModal`/`EntityModal` — sección "Campos personalizados" al final del formulario (`CustomFieldsFormSection`/`CustomFieldInput`, `src/components/CustomFieldInput.jsx`, compartido entre ambos). `NegotiationDetail.saveInlineField` extendido (`saveCustomField`) para edición inline en el detalle, mismo patrón que ya usaba para estado/NDA/descripción
- [x] Proyectos: los 4 switches paralelos que ya despachaban por columna (`renderCell`, `renderCardField`, `getExportValue`, y el merge de `useColumnPrefs`) ahora tienen un caso default que renderiza por `field_type` cuando la key matchea una definición custom fetcheada — Kanban lo hereda gratis porque ya reusa `renderCardField`. El Excel export (`exportNegotiationsXlsx`) ya iteraba dinámicamente por `cols`, así que un campo custom queda incluido sin código nuevo aparte del caso default
- [x] Entidades — alcance acotado en esta ronda (documentado como decisión, no como bug): los campos custom se muestran y editan en el formulario y en el detalle (sección "Información"), pero **no** todavía en la vista de tabla/mosaico (Entidades no tiene ningún `ALL_COLUMNS`/column-editor hoy, a diferencia de Proyectos) — fast-follow
- [x] Probado con Playwright: CRUD completo en Settings (alta/edición/borrado, los 3 tipos con más config — texto, lista, con seguimiento), formularios de Proyecto y Entidad con la sección dinámica + el test de regresión del bug de sobreescritura en ambos, render en detalle, Excel export incluyendo la columna del campo custom con el valor resuelto (id de opción → label)

##### Motor de alertas de "campo con seguimiento" — SQL aplicado y confirmado
Esta sesión no tiene acceso de red a la Supabase real (confirmado, 403 de política del sandbox) — el schema y la función del cron se le pasaron al usuario para correr manualmente, mismo flujo que ya veníamos usando. Ya corrido y validado contra Nerva Testing:
- [x] Tabla `custom_field_definitions` + RLS, columnas `custom_fields`/`custom_field_alerts` en `negotiations`, `custom_field_alerts` en `entities`
- [x] Función `notify_custom_field_alerts()` (PL/pgSQL, función hermana de `notify_pending_events()`, sin tocarla) + cron propio `notify-custom-field-alerts-daily` — escanea campos "con seguimiento" por workspace, evalúa `trigger_mode` (fecha límite o inactividad) contra `alert_days`, notifica a los asignados de tareas del proyecto/entidad respetando `notification_preferences`, tipo nuevo `custom_field_due`. **Sin fallback a owners/admins** — decisión explícita del usuario: si no hay tarea asignada, no avisa a nadie (ni marca el campo como notificado, así se reevalúa solo apenas se asigne una tarea). No requiere cambios en `NotificationBell.jsx` — ya resuelve `negotiation_id`/`entity_id` genérico, igual que con las notificaciones de @menciones
- [x] Siembra de NDA como campo "con seguimiento" (`key='nda'`, `underlying_type='select'`, choices = Enviado/En Revisión/Firmado, `trigger_mode='inactivity'`, 30 días) + backfill de los valores existentes de `negotiations.nda` — confirmado en Nerva Testing
- [x] Siembra de "Tipo de empresa" como campo `select` en Entidades — corrida, no encontró ningún valor existente en `custom_fields.company_type` para migrar (nadie lo había cargado todavía en Nerva Testing), así que no se creó ninguna definición ni backfill. El campo se puede crear a mano desde Settings cuando se necesite
- [x] `select notify_custom_field_alerts();` corrido manualmente una vez — sin resultados (esperable: recién sembrado, nada vencido todavía) antes de dejarlo en cron diario
- [x] **Confirmado 2026-08-14**: el `<select>` hardcodeado de NDA y el `<textarea>` de Tipo de empresa ya no existen en el código — se sacaron en el refactor "todo campo pasa a ser custom real" (ver más abajo). Si hace falta un campo de Tipo de empresa, se crea desde Settings como campo custom.

#### Campos custom — 5 tipos nuevos + Dirección/WhatsApp fijos (a pedido del usuario, revisando comentarios que se habían perdido en una transición de plan mode)
- [x] **País** (`field_type='country'`) — reusa el mismo `CountrySelector`/lista de países ya usada para "País de origen", cero datos nuevos. Configurable por campo, elegido una vez al crearlo: `multiple` (uno o varios países — cubre tanto "país de origen" como "países donde comercializa") y `show_flag` (banderita o solo texto en las vistas de lectura). Selector múltiple nuevo (`CountryMultiSelect` en `CustomFieldInput.jsx`) con chips + buscador, reusa los estilos del dropdown de `CountrySelector.css`. La bandera en modo lectura se resuelve como emoji Unicode (no `<img>`) para que `renderCustomFieldDisplay` siga devolviendo texto plano y funcione igual en tabla/tarjetas/Excel sin tratamiento especial
- [x] **Usuario del workspace** (`field_type='user'`) — imprescindible para que @menciones/asignaciones tengan sentido en un campo custom. El widget de edición (`UserFieldSelect`) hace su propio fetch de `workspace_members` (activos) al montarse, así no hace falta pasar la lista de miembros a través de todos los formularios que ya usan `CustomFieldInput`. La lectura (`renderCustomFieldDisplay`) sí necesita la lista para resolver el nombre — se agregó un parámetro opcional `members`, ya lo tenían disponible tanto Proyectos como el detalle de Entidad (este último no lo pasaba todavía al `NegotiationModal`/`NegotiationDetail` embebidos — quedaban con `members={[]}` hardcodeado, se corrigió de paso, mejora real aunque no era el objetivo de esta ronda)
- [x] **Link**, **Email**, **Teléfono** — inputs tipados (`url`/`email`/`tel`), en modo lectura salen clickeables (`mailto:`/`tel:`/`target="_blank"`) solo en las vistas de detalle (`CustomFieldReadOnly`, nuevo componente en `CustomFieldInput.jsx`) — en tabla/tarjetas/Excel siguen siendo texto plano, mismo criterio que ya regía para el resto de los tipos
- [x] **Dirección** en Entidades — a diferencia de los anteriores, decisión explícita del usuario de dejarlo **fijo** (como Sitio web/País hoy), no como campo custom — columna nueva `entities.address`, siempre visible en el formulario y el detalle. Si se necesita un campo de dirección en Proyectos, ya está cubierto por el tipo texto libre genérico, no hace falta un tipo dedicado
- [x] **WhatsApp** en Contactos (columna nueva `contacts.whatsapp`, opcional) — a pedido del usuario, junto con nombre/puesto/mail/teléfono ya existentes. En el detalle sale como link a `wa.me/<número sin caracteres no numéricos>`
- [x] Probado con Playwright: alta de los 3 tipos configurables en Settings con su sub-formulario, los 5 widgets nuevos dentro de `EntityModal` (incluido el multi-select de países con chips), guardado con la forma `{value, updated_at}` correcta, Dirección y WhatsApp en el formulario y en el body enviado, y el detalle de una entidad existente confirmando bandera+nombre de país, nombre de usuario resuelto, link clickeable, y el link de WhatsApp con el número limpio

##### Fast-follow explícito (fuera de esta ronda, con motivo)
- Export a PDF de campos custom (`exportPdf.js`) — no es automático como el Excel, hay que sumar filas `[label, valor]` a la tabla clave-valor que ya existe por página. Mejor hacerlo después de ver qué campos reales termina usando cada cliente. (Dirección y WhatsApp sí se sumaron al PDF de Entidades esta ronda, al ser campos fijos y no custom)
- ~~Filtrar por valor de campo custom en el toolbar de Proyectos/Entidades~~ — resuelto más abajo (ronda "Filtros configurables desde Settings")
- Column-editor completo (visibilidad/orden, como ya tiene Proyectos) para Entidades
- Editar `underlying_type`/`trigger_mode`/`multiple` de un campo "con seguimiento" o "país" ya creado — v1 los deja inmutables después de creados, cambiar la forma de un valor ya guardado es semánticamente complicado
- Dirección como columna de import (`ImportEntitiesModal`) — no se agregó esta ronda, mismo criterio que el resto del import (headers fijos, sin tocar sin necesidad concreta)

#### Modales grandes y consistentes + orden de campos configurable + campo obligatorio
El usuario probó el modal de creación de Entidades después de sumarle los campos custom nuevos y quedó chico (forzaba scroll). Pidió agrandarlo, unificar el tamaño de todos los modales, sacar el apartado separado de "Campos personalizados" (que sea parte del mismo formulario), poder reordenar campos fijos + custom mezclados desde Settings, y un tilde "obligatorio" por campo custom.
- [x] Al revisar, solo `EntityModal` (crear/editar entidad) estaba chico (680px, sin alto fijo) — `NegotiationModal`, `NegotiationDetail` y `EntityDetailModal` ya usaban `90vw / max-width 1100px / height 85vh`. Se llevó `EntityModal` al mismo tamaño, sin tocar los otros tres
- [x] Columna nueva `workspaces.field_order jsonb` — `{ "entity": [...keys], "negotiation": [...keys] }`, mezclando keys de campos fijos (`'name'`, `'product'`, etc.) y custom (`'cf_xxx'`) en un solo array por objeto. Se descartó sembrar los fijos como filas falsas en `custom_field_definitions` (ensuciaría una tabla con significado preciso) y se descartó guardarlo por-usuario en localStorage (es una decisión de estructura de datos del equipo, no una preferencia de visualización individual — mismo criterio que ya rige `custom_field_definitions`/`custom_states`/`entity_types`)
- [x] Helper `computeFieldOrder()` (`src/lib/customFields.js`) mergea el orden guardado con la lista real de keys — descarta keys de campos borrados, agrega al final las keys nuevas que el orden guardado todavía no conoce. Con `field_order` vacío (todo workspace hoy) el resultado es exactamente el orden actual, cero cambio visual hasta que alguien reordene algo
- [x] `EntityModal` y `NegotiationModal`: reescritos a una grilla de 2 columnas (`grid-template-columns: 1fr 1fr`, campos "anchos" — texto largo, selección múltiple, país múltiple, combobox de entidades vinculadas — ocupan el ancho completo) recorriendo el orden combinado, dispatch por key (mismo patrón que `renderCell`/`renderCardField` de Proyectos) a un renderer fijo o a `CustomFieldInput`. Se eliminó `CustomFieldsFormSection` (sin usuarios tras el refactor)
- [x] **Quedan fuera del reorder, fijos al final** (no son un valor atómico simple, son sub-formularios repetibles con su propia alta/borrado): Contactos en Entidades; Tareas iniciales e Hitos de pago en Proyectos
- [x] Alcance del merge "sin apartado separado": completo en ambos modales de creación/edición, y en la sección "Información" de `EntityDetailModal` (solo lectura, cambio chico y de bajo riesgo). **`NegotiationDetail` (solo lectura) no se tocó** — Estado/NDA/Moneda son badges/pills en un layout ya diseñado, forzarlos a una lista plana genérica hubiera sido un rediseño visual no pedido; decisión documentada, no pendiente
- [x] Columna nueva `custom_field_definitions.required boolean` — checkbox "Obligatorio" en el alta y edición de un campo custom en Settings (no aplica a campos fijos, que ya tienen su propia validación: Nombre en Entidades, Producto en Proyectos). Bloquea el guardado en `EntityModal`/`NegotiationModal` (mensaje listando los campos faltantes) y también la edición inline puntual de un campo desde `NegotiationDetail` (si se intenta vaciar un campo obligatorio, no guarda, muestra error, y el input vuelve al último valor válido)
- [x] Settings → Campos personalizados: la lista pasó a ser unificada (fijos + custom mezclados, en el orden real), arrastrable con drag & drop nativo (mismo patrón que el `ColumnEditor` de columnas de Proyectos) — persiste inmediatamente al soltar, sin botón "Guardar orden" aparte. Los campos fijos muestran badge "Campo fijo", son arrastrables pero no editables ni borrables
- [x] Probado con Playwright: tamaño de `EntityModal`/`NegotiationModal` (1100×850 con viewport de 1000px de alto, confirma el 85vh), ambos formularios sin header "CAMPOS PERSONALIZADOS" separado, drag-reorder persistiendo el `PATCH` correcto a `workspaces.field_order`, validación de obligatorio bloqueando el guardado con mensaje correcto en ambos modales, y el bloqueo inline en `NegotiationDetail` con snap-back del valor

##### SQL pendiente de aplicar
- [x] `alter table public.workspaces add column field_order jsonb not null default '{}'::jsonb;`
- [x] `alter table public.custom_field_definitions add column required boolean not null default false;`

#### Todo campo (menos lo genuinamente estructural) pasa a ser un campo custom real
El usuario probó el reorder de "campos fijos" del punto anterior y se dio cuenta de que el modelo estaba mal: casi ningún campo de esa lista JS estática era realmente estructural — la mayoría era "lo que se me ocurrió pedir para este caso de uso" (licensing farmacéutico), y otro cliente con otro rubro va a querer otra cosa. Pidió que todos pasen a ser filas reales de `custom_field_definitions` (editable el label, borrable salvo un puñado genuinamente estructural), y de paso sacó dos campos que nunca representaron datos reales (copiados de la plataforma en la que se basó Nerva) y renombró/replanteó otros tres.
- [x] Dos columnas nuevas en `custom_field_definitions`: `storage_column text` (si está seteada, el valor vive en una columna real de `negotiations`/`entities`, no en el jsonb `custom_fields`) y `is_structural boolean` (campos de los que depende la app para funcionar — identidad del registro, routing — no borrables, `required` fijo en `true` salvo Contactos que no tiene concepto de obligatorio)
- [x] 5 `field_type` nuevos, sembrables solo por SQL (nunca elegibles en el desplegable "+ Agregar campo" de Settings): `entity_type`, `status`, `entities_link`, `financial`, `contacts` — cada uno con su widget bespoke, el mismo JSX que ya existía, ahora tomando el label de la definición en vez de texto hardcodeado
- [x] `field_type='user'` suma soporte a `options.multiple` (mismo patrón que ya tenía `country`) — Participantes pasa a ser este tipo con `multiple: true`, sigue reflejando automáticamente a los miembros reales del workspace sin curación manual en Settings. Nuevo widget `UserMultiSelect` en `CustomFieldInput.jsx`
- [x] **Estructurales** (no borrables): Nombre y Tipo en Entidades, Contactos (no borrable pero sin concepto de obligatorio — es un sub-formulario repetible, no un valor); Nombre del proyecto y Estado en Proyectos
- [x] **Pasan a ser regulares** (editables, borrables): País de origen, Sitio web, Dirección, Tipo de empresa en Entidades; Descripción, Fecha objetivo, Participantes (ahora usuario múltiple) en Proyectos
- [x] **Clientes / Potenciales clientes** (antes "Empresas interesadas") — mismo campo `companies`, renombrado y pasa a ser un preset borrable en vez de fijo
- [x] **Financiero** — folda en un solo preset borrable lo que antes eran dos secciones fijas separadas (selector de Moneda + Hitos de pago/`deal_milestones`), mismo JSX exacto, ahora mostrado/ocultado según exista o no la definición
- [x] **Entidades vinculadas** — el combobox+lista de roles existente no mapea a ningún tipo genérico con sentido, así que quedó bespoke (`field_type='entities_link'`) pero SÍ es reordenable y borrable como cualquier otro preset
- [x] **Territorios**: se eliminó por completo (columna `negotiations.territories` incluida) — nunca representó datos reales, era un campo heredado de la plataforma en la que se basó Nerva. Sin reemplazo por defecto; si alguien lo necesita, lo arma con un campo tipo País en modo múltiple
- [x] **NDA** (columna vieja `negotiations.nda`, distinta del campo custom `nda` "con seguimiento" ya sembrado semanas atrás): se eliminó por completo también, sin migrar nada — decisión explícita del usuario, la data actual era de prueba ("no pasa nada si se pierde, ni nos gastemos en migrarlo"). El campo custom `nda` con seguimiento (con datos reales backfilleados) no se tocó, sigue viviendo en `custom_fields` como cualquier campo tracked
- [x] `computeFieldOrder()` simplificado — ya no necesita una lista aparte de "keys fijas por defecto", con todo viviendo en `custom_field_definitions` el orden es directamente `customDefs` mergeado con lo guardado en `field_order`
- [x] `EntityModal`/`NegotiationModal`/`NegotiationDetail`/`Entities.jsx` reescritos para despachar por `field_type` (nunca por `key` hardcodeada) y guardar por `storage_column` cuando está seteado, o en `custom_fields` (jsonb) cuando no — mismo patrón ya usado en Proyectos para columnas de tabla
- [x] Settings → Campos personalizados: deja de mezclar "fijos (JS) + custom (DB)", es 100% lo que devuelve la tabla. Filas `is_structural`: label editable, sin botón Eliminar, checkbox Obligatorio deshabilitado y tildado (oculto en Contactos). Contactos además queda pinneado al final de la lista, sin drag handle (para que el owner lo vea siempre y no duplique un campo de "datos de contacto" custom por error)
- [x] **Bug real encontrado y corregido en el camino**: las columnas "Participantes" (tabla/tarjetas/export CSV/PDF) y la sección homónima del detalle de proyecto mostraban el array crudo de `neg.participants` sin resolver — con el tipo viejo (texto libre) eso mostraba nombres tal cual se habían tipeado, pero con el nuevo tipo `user` los valores guardados son `user_id` (UUID), así que sin el fix hubieran aparecido UUIDs pelados en vez de nombres. Se exportaron `resolveMemberName`/`resolveMemberNames` desde `customFields.js` y se usaron en los 4 puntos de render (`renderCell`, `renderCardField`, `getExportValue`, `exportPdf.js`) para resolver contra la lista de `workspace_members`
- [x] Probado con Playwright: Settings muestra los presets estructurales (sin Eliminar, Obligatorio tildado y bloqueado, Contactos pinneado sin drag handle) y regulares (editables/borrables/con drag), borrar un preset regular (Descripción) lo saca del modal de alta y del detalle, `EntityModal`/`NegotiationModal` con validación de obligatorio bloqueando el guardado, "Financiero" foldeando Moneda+Hitos en un solo bloque, "Entidades vinculadas" mostrando la entidad principal en el hero y las secundarias en su propia sección, y Participantes resolviendo a nombre real (no UUID) en el detalle — sin ninguna referencia rota a NDA/Territorios en toda la app

##### Nota para el usuario
- **`Fecha objetivo` (`target_date`)**: confirmado por el usuario que no debía venir precargado — sacado del seed. La columna real `negotiations.target_date` sigue existiendo (no se borra, no hay motivo), simplemente no se siembra ninguna definición para ella; si se necesita, se puede crear a mano desde Settings como campo tipo Fecha (quedaría en el jsonb `custom_fields`, no en la columna vieja)
- **Participantes** (antes texto libre, ahora `user` múltiple con `user_id` real): si ya hay proyectos reales con participantes cargados como texto libre, esos valores no se migran (no hay forma automática de mapear un nombre tipeado a un usuario real del workspace) — quedarán invisibles hasta cargarse de nuevo desde el selector nuevo. Mismo criterio que NDA/Territorios: si esa data era de prueba, no hace falta hacer nada; si había datos reales, avisar para ver si conviene un mapeo manual.

##### SQL — ya aplicado (confirmado 2026-08-14, el archivo estaba desactualizado)
- [x] `custom_field_definitions.storage_column`, `.is_structural` — existen
- [x] `negotiations.territories`, `.nda` — confirmado borrados (no existen)
- [x] Seed de los 14 presets — la app funciona con normalidad usando este modelo

#### Estados de Proyectos — label editable
El usuario preguntó si los Estados (Settings → Estados) se pueden renombrar, ya que hoy solo se pueden agregar/borrar — cada workspace maneja un flujo distinto y el set inicial no le sirve a todos igual.
- [x] Botón "Editar" nuevo en cada fila de `TabEstados` (mismo patrón que Tipos de entidad y Campos personalizados): nombre + color editables inline
- [x] **`negotiations.status` guarda el nombre del estado como texto libre** (matcheo por nombre, no por id) — a diferencia de los campos custom (que matchean por `key` estable), renombrar un estado sin más dejaría "huérfanos" a todos los proyectos que ya tenían ese estado asignado. `handleSaveEdit` hace un `update negotiations set status = nuevoNombre where status = nombreViejo` en cascada, en el mismo flujo que el rename
- [x] **"Completado" queda sin botón Editar** (solo el badge "🔒 Protegido" de siempre) — su nombre está hardcodeado en varios lugares de la app (conteos de Dashboard, exports a PDF, filtro de actividad, el propio candado de protección) que comparan por el string literal `'Completado'`, no por ninguna referencia estable. Permitir renombrarlo rompería esas comparaciones silenciosamente. El color si se podría habilitar a futuro sin este riesgo, no se hizo esta ronda por acotar el cambio
- [x] Probado con Playwright: "Completado" sin botón Editar, renombrar un estado regular actualiza tanto `custom_states` como los proyectos existentes que lo tenían asignado (confirmado con mock de datos)

##### Hallazgo: pestañas "Entidades"/"Tareas" en Estados estaban huérfanas — RESUELTO
El usuario reportó que en Configuración → Estados no puede personalizar etiquetas, "vienen hardcodeadas" — investigado y confirmado en su momento: `TabEstados` tenía 3 sub-pestañas (Proyectos/Entidades/Tareas) pero solo Proyectos estaba conectada a algo real (`negotiations.status`).
- [x] **Resuelto en la reorganización de Configuración por módulo** (ver "Follow-up inmediato (10)" más abajo, en la sección de Productos): `TabEstados` perdió su selector, quedó exclusiva de Proyectos (`STATES_OBJECT_TYPE = 'negotiation'`, hardcodeado, sin sub-pestañas). Confirmado contra el código actual (2026-08-17) — no hay nada pendiente de decidir acá, la nota había quedado desactualizada tras resolverse más abajo en este mismo archivo.

#### Import de Entidades/Proyectos data-driven + filtros configurables desde Settings
Tras probar el import con planillas de prueba, dos pedidos: que la plantilla de import refleje los campos reales del workspace (no 4 columnas fijas), y que los filtros de las toolbars de Proyectos/Entidades salgan de Settings en vez de estar hardcodeados por campo.
- [x] `ImportEntitiesModal`/`ImportNegotiationsModal` reescritos data-driven — headers/parseo/guardado 100% desde `entityFieldDefs`/`negotiationFieldDefs`. Cada `field_type` tiene su lógica de parseo de celda (select/multiselect resuelven contra las opciones configuradas, país vía `getCountryCode`, fecha con el parser ya existente). Casos especiales que se mantienen aparte: "Proveedor" (Proyectos, matchea por nombre de entidad — `entities_link` no es una celda simple) y "Estado" (matchea contra `custom_states`, no contra `options.choices`, con el mismo fallback al primer estado configurado)
- [x] Import de Entidades suma 4 columnas opcionales para el contacto principal (`Contacto: Nombre/Cargo/Email/Teléfono`), solo si el workspace tiene el preset Contactos activo — importa uno solo, el resto se agrega a mano
- [x] Quedan fuera del import (documentado): `user` (participantes/asignados — mapear texto libre contra miembros reales de forma confiable es un problema aparte) y `financial` (compuesto, no una celda)
- [x] **Filtros configurables**: columna nueva `custom_field_definitions.filterable boolean` — checkbox "Mostrar como filtro" en Settings, visible solo para tipos que encajan con un filtro tipo "elegí un valor de una lista" (`select`, `multiselect`, `country`, `user`, `boolean`, `status`, y `tracked` con `underlying_type` compatible). El filtro de Estado de Proyectos (antes hardcodeado) pasa a ser un caso más de este mecanismo; Entidades suma filtros por primera vez (antes solo tenía buscador de texto)
- [x] Nuevo componente `CustomFieldFilter` (en `CustomFieldInput.jsx`) — un `<select>` (múltiple si el campo lo es) con las opciones que correspondan según el tipo. Quedan como casos especiales sin generalizar: "Proveedor" (Proyectos) y "Actividad" (`activity_status`, calculado, no es un campo custom)
- [x] Probado con Playwright: import con campos select/tracked/país múltiple/contacto principal resolviendo y guardando bien en ambas páginas; checkbox de filtro visible solo en tipos compatibles, filtro aparece en la toolbar apenas se activa desde Settings, y filtrado real funcionando en Proyectos (Estado) y Entidades (Tipo de empresa)

##### SQL — ya aplicado (confirmado 2026-08-14)
- [x] `custom_field_definitions.filterable` — existe (nota: quedó como dead code, ver auditoría más arriba — el filtrado real es 100% por `field_type`)

### Feedback del primer cliente real
Tras dar de alta al primer cliente pagador y que empezara a usar la app, surgieron cosas que para el uso propio de Gervasio pasaban desapercibidas pero no son genéricas para un SaaS con clientes reales.

1. **[x] Invitación por email nunca le mostró `/set-password` — y ni siquiera quedaba con acceso real al workspace** — investigado a fondo tras el pedido de "invitar cliente nuevo": el redirect a `/set-password` siempre estuvo bien configurado (`redirectTo` en `generateLink`), pero se encontró un **bug real más profundo**: para un invitado nuevo (nunca antes registrado), `invite-user` creaba el usuario de auth y mandaba el link, pero **nunca insertaba la fila en `workspace_members`** — ni la función, ni `SetPassword.jsx` (que solo cambia la contraseña y borra la invitación pendiente, no lee `invited_workspace_id`/`invited_role` de los metadatos para completar el alta). Un invitado nuevo terminaba sin ningún acceso real al workspace, lo cual explica por qué hubo que darlo de alta a mano por SQL. Fix: `addOrInviteUser()` (helper nuevo, compartido) inserta `workspace_members` inmediatamente con el id que `generateLink` ya devuelve, sin depender de ningún paso posterior. Sigue pendiente configurar SMTP real (Resend) para que el mail se mande solo — hoy sigue dependiendo de copiar/pegar el link a mano
2. **[x] Primer login caía en el workspace personal en vez del de equipo** — confirmado: `AuthContext.fetchWorkspaces()` no priorizaba nada entre WS personal y de equipo cuando no había nada guardado en `localStorage`, y el personal (creado automático por el trigger de signup, antes de que se invite a nadie a un WS de equipo) quedaba primero en el orden de retorno de la consulta. Fix: se agrega `teamWs = memberWorkspaces.find(w => w.type !== 'personal')`, priorizado antes del fallback al primero de la lista (después de lo guardado en localStorage y del WS de testing, que sigue con prioridad para uso interno)
3. **Mini tutorial guiado (pop-ups) en el primer ingreso** — idea a futuro, anotada a pedido explícito del usuario, sin diseñar ni implementar todavía. Mostraría las funciones principales la primera vez que alguien entra a un workspace, en vez de tener que descubrirlas solo
4. **[x] El picker de columnas de Proyectos no coincidía con los campos configurados** — confirmado, bug real: `ALL_COLUMNS` en `Negotiations.jsx` tenía 6 keys hardcodeados (`product`/`entities`/`status`/`description`/`companies`/`participants`) que **duplicaban** keys que ya existen en `custom_field_definitions` desde la refactorización de campos custom, con labels viejos sin actualizar (ej. `entities` figuraba como "Proveedor", ignorando el label real configurado en Settings). Como `allColumns = [...ALL_COLUMNS, ...customFieldDefs...]` y todo se resuelve con `.find()` por key, la entrada vieja siempre "tapaba" a la real — se veía en el picker de columnas, en los `<th>` de la tabla y en el header del export a Excel. Fix: se sacaron esos 6 keys de `ALL_COLUMNS` (solo quedan ahí los que genuinamente no son un campo — `target_date`, `notes`, `observations`, `activity_status`, `last_activity_at`), se invirtió el orden de merge para que `customFieldDefs` tenga prioridad, y se corrigió el valor por defecto de "visible" al agregar una columna nueva (antes quedaba oculta siempre, lo que hacía que un workspace nuevo viera la tabla vacía hasta tocar el editor de columnas a mano)
5. **Encabezado de tabla tipo Excel — click para filtrar y ordenar por columna** — pedido para Proyectos y Entidades. Decisiones tomadas con el usuario antes de construir: la vista Tabla de Entidades pasa a tener columnas configurables (reemplaza la lista fija anterior, no se agrega como vista aparte); el filtro por columna en el encabezado convive con los filtros de la toolbar (no los reemplaza); el click-para-ordenar aplica a la vista Tabla en ambas páginas, y además se suma un selector simple de orden en la vista Tarjetas.
   - [x] **Primer incremento — paridad de tabla configurable para Entidades**: se extrajo `useColumnPrefs`/`ColumnEditor` (antes vivían solo dentro de `Negotiations.jsx`) a un componente compartido `src/components/ColumnEditor.jsx`, generalizado con `storageKey`/`staticColumns`/`defaultVisible` como parámetros en vez de constantes de módulo — usado ahora por ambas páginas, evitando duplicar la lógica (y el riesgo de repetir el bug del punto 4) a futuro. `Negotiations.jsx` se actualizó para consumirlo sin cambiar de comportamiento
   - [x] Vista Tabla de Entidades (`EntitiesGridTable`, nuevo, reemplaza a la vieja `EntitiesTable` de filas fijas): columnas 100% desde `entityFieldDefs` (con el mismo criterio de paridad de label que Proyectos) más 2 calculadas (`contacts_count`, `projects_total` — "Contactos" no entra como campo simple, es un sub-formulario repetible). Botón "⚙ Columnas" nuevo en la toolbar de Entidades, mismo patrón que "⚙ Vista" de Proyectos. Selección múltiple con "seleccionar todos los visibles" (no existía antes en Entidades)
   - [x] **Segundo incremento — click-para-ordenar + filtro por columna + selector en Tarjetas, en ambas páginas**: `src/lib/tableSort.js` (nuevo) con `sortRows`/`nextSortDir`/`customFieldSortValue` compartidos — nulls/vacíos siempre al final sin importar la dirección (criterio Excel/Sheets). `src/components/ColumnHeaderCell.jsx` (nuevo) — `<th>` con el label clickeable para ordenar (ciclo asc → desc → sin ordenar) y un `▾` que abre un popover con el mismo `CustomFieldFilter` que ya usa la toolbar, escribiendo al mismo estado de filtros (conviven, no se duplican)
   - [x] `getNegSortValue`/`getEntitySortValue` (uno por página, mismo criterio que `getExportValue`/`renderCell`: casos especiales primero, default a `customFieldSortValue` para cualquier campo custom) — number/date ordenan por su valor real, el resto por el string que ya se muestra
   - [x] Selector de orden en vista Tarjetas (ambas páginas) — mismo estado (`sortKey`/`sortDir`) que la Tabla, así cambiar de vista no pierde el orden elegido
   - [ ] Sin probar con Playwright todavía (esta sesión sigue sin acceso de red a la Supabase real) — verificado por build + lectura de código, pendiente de confirmación manual del usuario
6. **Confirmación aparte, sin cambios de código**: Estados de Proyectos ya funciona exactamente como se pidió — el campo `status` es estructural (obligatorio, columna real `negotiations.status`, no se puede sacar), pero sus opciones (`custom_states`) son 100% configurables por cada owner desde Configuración → Estados — agregar/renombrar/borrar libremente, salvo "Completado" que queda protegido por las comparaciones hardcodeadas que dependen de ese string exacto en varios lugares de la app

### Filtro "Con tareas pendientes" en Proyectos y Entidades (2026-08-14)
Pedido explícito: poder identificar rápido, a nivel equipo, dónde quedan cosas por hacer.
- [x] Botón toggle nuevo en el toolbar de ambas páginas (`.pending-tasks-toggle-btn`, definido una sola vez en `Negotiations.css`, reusado en Entidades vía el bundle global de CSS — mismo patrón que `.neg-stat-card`/`.clear-filters-btn`)
- [x] Proyectos: `has_pending_tasks` calculado en `fetchAll()` — trae `tasks.negotiation_id` con `status in ('pending','in_progress')` para los proyectos cargados
- [x] Entidades: `has_pending_tasks` cuenta tanto tareas propias de la entidad (`tasks.entity_id`) como tareas de cualquier proyecto vinculado — mismo criterio "entidad como hub" que ya usa el timeline de actividad
- [ ] Sin probar con Playwright — verificado por build y lectura de código, pendiente de confirmación manual del usuario

### Invitar cliente nuevo — solo para Staff
Hasta ahora, dar de alta a un cliente nuevo (workspace de equipo + esa persona como owner) se hacía a mano por SQL en el editor de Supabase. Se pidió una opción en la UI, distinta de "Invitar usuario" (que suma a alguien a un workspace ya existente y ya existía), disponible solo para cuentas con `is_staff = true`.
- [x] `invite-user` (Edge Function) suma la acción `invite_client`: verifica `profiles.is_staff` del que llama (no ownership de ningún workspace, porque todavía no existe ninguno), crea el workspace (`type: 'team'`, `onboarded: false`) y reusa la misma lógica de invitación que ya existía para sumar al cliente como `owner`
- [x] Refactor: la lógica de "generar el link o sumar directo si ya tiene cuenta confirmada" se extrajo a un helper compartido `addOrInviteUser()`, usado tanto por `invite` (acción existente) como por `invite_client` (nueva) — antes estaba duplicada línea por línea dentro del handler de `invite`
- [x] `Profile.jsx` suma un bloque "Panel de Staff — Dar de alta un cliente nuevo" (nombre del workspace + email), visible solo si `isStaff` — vive en Perfil (no en Configuración) porque no está atado a ningún workspace en particular, a diferencia de "Invitar usuario"
- [ ] Sin probar contra la Supabase real (esta sesión sigue sin acceso de red a la base) — verificado por build + lectura de código, pendiente de confirmación manual del usuario

### Módulo de Productos/Servicios — tercer polo, conectado a Entidades por vínculo
Pedido: un catálogo de productos/servicios, con tipos configurables por workspace igual que Entidades (ej. Producto terminado / API / Maquinaria), donde cada producto pertenece a una entidad (su proveedor), y un proyecto pueda vincular varios productos además de sus entidades.

Antes de tocar código se repensó la arquitectura contra la decisión ya tomada en la sesión del 6/7 ("Sobre el 'framework de módulos' genérico", más arriba en este archivo): *"todos los módulos se conectan a `entities` vía tabla de vínculo — ningún módulo 'posee' la entidad"*. Productos es el primer caso real de esa idea — no se metió adentro de `entities` (tipos y vocabulario distintos, relación de pertenencia real vía `entity_id`), se armó como un tercer polo del mismo tamaño que Entidades, siguiendo exactamente su mismo patrón (tipos configurables, campos custom por workspace, vista Tabla/Tarjetas con columnas configurables).

Decisiones de diseño confirmadas con el usuario antes de construir:
- Un producto pertenece a **una sola** entidad (`products.entity_id`, FK simple) — si el mismo producto lo ofrecen dos proveedores distintos, son dos filas separadas (tiene sentido en licensing: distinto proveedor = distinta especificación/registro/términos)
- Un proyecto puede vincular **varios** productos (portfolio deals) — mismo patrón que Entidades vinculadas: combobox + lista, uno marcado como principal
- Preset base mínimo, a pedido explícito: Nombre + Descripción como único par estructural/regular sembrado — sin campos custom de más, sin tipos de producto pre-cargados (el owner arma sus propios tipos desde Configuración, mismo criterio que "Tipo de empresa" en Entidades: no sembrar datos que en realidad son del cliente)
- Sin pedir todavía (explícitamente fuera de alcance esta ronda): notas/tareas/documentos/timeline de actividad colgando de un producto, y Estados/ciclo de vida de producto — se puede sumar después si hace falta

Lo construido:
- [x] 3 tablas nuevas: `product_types` (calco de `entity_types`), `products` (`entity_id`, `product_type_id`, `name`, `description`, `custom_fields`), `negotiation_products` (tabla de vínculo negociación↔producto, calco de `negotiation_entities` sin columna `role`) + `negotiations.primary_product_id` (calco de `primary_entity_id`, para mostrar el producto principal sin joins extra en tabla/tarjetas)
- [x] `custom_field_definitions` suma `object_type = 'product'` y 3 `field_type` especiales nuevos (solo sembrables por SQL, nunca elegibles en Settings): `product_type` (dropdown de tipos), `product_entity` (dropdown de entidades, el "Proveedor" del producto), `products_link` (combobox múltiple en Proyectos, igual patrón visual que `entities_link`)
- [x] Página `/products/:typeId` (`Products.jsx`, nuevo) — mismo esqueleto que Entidades: Tarjetas + Tabla configurable (columnas, orden por click en encabezado, filtro por columna, selector de orden en Tarjetas — reusa el mismo sistema compartido que ya tenía Proyectos/Entidades), selección múltiple + borrado en lote, modal de alta/edición (`ProductModal.jsx`, calco liviano de `EntityModal.jsx`, sin sub-formulario de contactos)
- [x] Detalle de producto: Información (campos custom) + lista de Proyectos vinculados (click abre el detalle completo del proyecto, con edición real wireada — `NegotiationModal`/`NegotiationDetail` reusados tal cual)
- [x] Sidebar: los tipos de producto suman su propia sección con divisor, mismo patrón que tipos de entidad. Nueva pestaña "Tipos de producto" en Configuración (calco de "Tipos de entidad"), y "Productos" se sumó como tercera opción al toggle Proyectos/Entidades/Productos de "Campos personalizados"
- [x] `NegotiationModal`/`NegotiationDetail`/tabla/tarjetas/export de Proyectos: dispatch completo para `products_link` (combobox de alta, guardado en `negotiation_products` + `primary_product_id`, sección "Productos vinculados" en el detalle, columna "Productos" en tabla/tarjetas/export a Excel mostrando el producto principal)
- [x] Entidades: nueva pestaña "Productos (n)" en el detalle (solo aparece si el workspace tiene el módulo de Productos configurado) — lista de productos con `entity_id` = esa entidad, click abre el detalle completo del producto
- [x] `ImportNegotiationsModal`: `products_link` sumado a `SKIP_TYPES` (no es una celda simple, igual criterio que `entities_link`) — sin este fix el import de Proyectos se hubiera roto apenas se sembrara el campo
- [ ] **Explícitamente fuera de alcance esta ronda** (documentado, no bug): import/export de Productos (Excel/CSV/PDF), notas/tareas/documentos/timeline en un producto, Estados/ciclo de vida de producto
- [ ] Sin probar contra la Supabase real — esta sesión sigue sin acceso de red a la base, y además las tablas nuevas ni siquiera existen todavía hasta correr el SQL. Verificado por build + lectura de código cuidadosa; pendiente de confirmación manual del usuario en Testing

##### SQL pendiente de aplicar — ver script completo entregado en el chat (no se pega acá, por la regla de este proyecto de mandarlo siempre en texto del chat, nunca como archivo)
- [ ] Tablas `product_types`, `products`, `negotiation_products` + columna `negotiations.primary_product_id`
- [ ] Ampliar los checks de `object_type` y `field_type` en `custom_field_definitions` para incluir `product` y los 3 tipos especiales nuevos
- [ ] Sembrar los 5 `custom_field_definitions` (4 de `product` + 1 de `negotiation`) para cada workspace de equipo/testing existente — `product_types` queda vacía a propósito, el owner carga los suyos
- [x] RLS de las 3 tablas nuevas — resuelto: el usuario corrió una query sobre `pg_policies` y pasó las policies reales de `entities`/`entity_types`/`negotiation_entities`, con eso se generó el `CREATE POLICY` + `ENABLE ROW LEVEL SECURITY` exacto para `products`/`product_types`/`negotiation_products` (mismo patrón: `PERMISSIVE`, `FOR ALL TO public`, `workspace_id IN (SELECT my_workspace_ids())` directo para las que tienen `workspace_id` propio, vía `negotiation_id IN (...)` para la tabla de vínculo) — SQL entregado en el chat, pendiente de que el usuario lo corra

### Proyectos — una columna por tipo de entidad (reemplaza "Entidades vinculadas" genérico)
Pedido de seguimiento tras la primera prueba real del módulo de Productos: el campo único `entities_link` (una entidad principal + secundarias con rol libre) no alcanza — el usuario quiere poder vincular una entidad **por cada tipo configurado** (ej. Cliente, Proveedor, Distribuidor) y que la vista Tabla muestre una columna por tipo, según el ejemplo en Excel que pasó (`Proyecto | Producto | Estado | Cliente | Proveedor | Distribuidor`).

Decisiones confirmadas con el usuario antes de construir:
- Como máximo **una** entidad por tipo en un proyecto (no una lista)
- El filtro único de toolbar ("Proveedor" hardcodeado) se reemplaza por **un filtro por tipo de entidad**

Diseño: sin tablas ni columnas nuevas — `negotiation_entities` (entity_id) y `entities.entity_type_id` ya tienen todo lo necesario. El cambio es 100% de cómo se agrupa/renderiza/edita ese mismo dato (por tipo de entidad en vez de por posición "principal/secundaria" en un array).

- [x] `NegotiationModal`: estado interno pasa de `entity_ids` (array con rol libre) a `entity_by_type` (objeto `{entityTypeId: entityId}`) — un `<select>` por tipo de entidad configurado, con las entidades de ese tipo como opciones
- [x] Guardado: `primary_entity_id` sale del primer tipo (en orden de `sort_order`) que tenga una entidad asignada; `negotiation_entities` se inserta sin columna `role` (ya no aplica, el "rol" ahora es el tipo de entidad en sí)
- [x] Tabla/Tarjetas/Kanban: columnas virtuales `entity_type:<id>` (una por tipo configurado) reemplazan a la columna única `entities` — mismo sistema de columnas configurables/ordenables que ya tenían Proyectos y Entidades, incluido filtro en el propio encabezado de columna
- [x] Export a Excel: encabezados de las columnas por tipo resuelven al nombre real del tipo (plural si está configurado), no al UUID crudo
- [x] Detalle de proyecto: la sección "Entidades vinculadas" pasa de mostrar principal+secundarias a una fila por tipo de entidad con datos asignados
- [ ] **Explícitamente fuera de alcance esta ronda, no investigado**: el import de Proyectos (`ImportNegotiationsModal`) sigue con su columna única "Proveedor" (matchea por nombre contra cualquier entidad, solo setea `primary_entity_id`, no crea filas por tipo) — no lo tocó el usuario en este pedido, queda como limitación conocida del import masivo
- [ ] Sin SQL nuevo — no hace falta correr nada en Supabase para esta ronda

##### Follow-up inmediato: toolbar con demasiados filtros duplicados + buscador incompleto
Al probarlo, feedback de que la toolbar quedó con demasiados filtros (uno por tipo de entidad + uno por cada campo custom filtrable, todos duplicando el filtro `▾` que ya vive en el encabezado de cada columna) y que el buscador ("Proyecto o producto...") en realidad solo buscaba por nombre de proyecto, nunca por el producto vinculado.
- [x] Se sacaron de la toolbar todos los filtros por tipo de entidad y por campo custom — quedan solo Buscar y Actividad. El filtrado por columna pasa a vivir exclusivamente en el encabezado de la tabla (mismo estado `entityTypeFilters`/`customFilterValues` de antes, misma vista Tabla que ya lo soportaba, ahora es la única forma de filtrar por esas columnas)
- [x] Buscador ahora matchea también contra el producto principal vinculado (`negotiation_products` vía `getProductName`), no solo contra el nombre del proyecto
- [ ] Trade-off a tener en cuenta: si una columna filtrable está oculta (vista "⚙ Vista"), su filtro deja de estar disponible hasta volver a mostrarla — comportamiento esperado del patrón "tipo Excel" pedido, no un bug

##### Follow-up inmediato (2): el filtro de encabezado era un `<select>` de una sola opción, no "tipo Excel" de verdad
Feedback tras probar el punto anterior: el filtro `▾` de cada columna era un desplegable de una sola opción (había que scrollear a buscar y solo se podía elegir un valor) — pidió que fuera más parecido al autofiltro real de Excel: buscador + poder tildar varios valores.
- [x] `ColumnFilterMenu.jsx` (nuevo, componente compartido): buscador de texto + checklist de checkboxes con "Todos"/"Ninguno"/"Limpiar", reemplaza al `<select>` en el filtro de encabezado de Proyectos — tanto para las columnas por tipo de entidad como para cualquier campo custom filtrable (Estado, Participantes, etc.)
- [x] `matchesFieldFilter` generalizado para aceptar valor único o array indistintamente (compatibilidad con la tarjeta de stats de Estado, que sigue escribiendo un valor a la vez) — mismo semántica "alguno de los elegidos"
- [x] Fix de paso: el click en una tarjeta de stats de Estado ahora hace toggle sobre el array en vez de pisarlo, para no perder selección si ya había filtros tildados desde el encabezado

##### Follow-up inmediato (3): extender a Entidades/Productos + columnas de ancho fijo/ajustable + confirmar que las prefs son por usuario
Pedido: llevar el filtro tipo Excel a las tablas de Entidades y Productos también (quedaron afuera de la ronda anterior a propósito, por acotar alcance). Además, feedback de que la Tabla "saltaba" al cambiar de filtro porque el ancho de columna se recalculaba según el contenido visible — pidió anchos fijos pero ajustables a mano (tipo Excel: arrastrás una vez, después queda así hasta que lo vuelvas a mover). Por último, preguntó si las vistas/filtros/anchos de columna son por usuario o se comparten con todo el workspace.
- [x] `ColumnFilterMenu` (buscador + checklist) ahora también en el encabezado de la Tabla de Entidades y de Productos, mismo componente que ya usaba Proyectos
- [x] Columnas de ancho fijo y ajustable: `.neg-table` pasa a `table-layout: fixed`, `ColumnHeaderCell.jsx` suma un handle de resize en el borde derecho de cada `<th>` (arrastrar con el mouse, mínimo 70px). El ancho elegido se guarda en las mismas prefs de columna por usuario que ya existían — no hay tabla/columna nueva en Supabase
- [x] Confirmado con el código, no hacía falta cambiar nada: las prefs de columna (`nerva_col_prefs_<user_id>` en Proyectos, equivalentes en Entidades/Productos) viven en `localStorage`, con el `user.id` en la clave — ya eran 100% por usuario (y por navegador/dispositivo, localStorage no sincroniza entre dispositivos del mismo usuario). Los filtros activos (`customFilterValues`, `entityTypeFilters`, texto de búsqueda, orden) son estado de React en memoria: no se guardan en ningún lado, se pierden al recargar la página y nunca viajan a Supabase — el workspace comparte los *datos*, nunca cómo cada usuario los está mirando en un momento dado

##### Follow-up inmediato (4): consistencia visual entre páginas + iconos de biblioteca
Feedback de que Entidades/Productos "quedan feo" comparadas con Proyectos porque los elementos del toolbar están ubicados distinto, y de que el proyecto mezcla `lucide-react` (ya instalado) con SVG dibujado a mano en varios lugares — pidió unificar todo a la biblioteca de íconos.
- [x] `.entities-toolbar` tenía `justify-content: flex-end` + `align-items: center` (todo pegado a la derecha, sin wrap) — causa raíz de que "las cosas se ubiquen en otro lado" comparado con `.neg-toolbar` de Proyectos (flujo natural a la izquierda, `align-items: flex-end`, con wrap). Alineado. El buscador de Entidades/Productos suma el mismo wrapper con label "Buscar" que ya tenían el resto de los filtros
- [x] Selector de vista Tabla/Mosaico unificado entre las 3 páginas: mismas clases (`.neg-view-toggle`/`.neg-view-btn`) y mismos íconos `lucide-react` (`Table2`/`LayoutGrid`/`Kanban`) en vez del SVG a mano que tenían Entidades/Productos y los glifos de texto que tenía Proyectos
- [x] Botón de filtro de columna (▾) agrandado a 24×24px con ícono `ListFilter`, en vez de un texto de 11px casi invisible
- [x] `Layout.jsx` (sidebar + header): Dashboard/Agenda/Tareas/Proyectos/Configuración, toggle de menú móvil, flechas de colapsar sidebar, chevron del selector de workspace, e íconos de fallback de tipo de entidad/producto (cuando el tipo no tiene ícono elegido) — todos pasan de SVG a mano a `lucide-react`. Mismo criterio en la lupa del buscador global y en el toggle barras/donut del Dashboard
- [ ] Deliberadamente no tocado: los SVG de los gráficos donut del Dashboard (son visualizaciones de datos reales, no íconos de sección)

##### Follow-up inmediato (5): Productos — página única con tarjetas de filtro por tipo (implementado)
Confirmado con el usuario: Productos deja de navegarse como Entidades (una página separada por tipo, con un ítem propio en el sidebar) y pasa a una sola página con todos los productos, filtrando por tipo con tarjetas clicables arriba — al estilo de las tarjetas de Estado en Proyectos. Se evaluó explícitamente la alternativa de un toggle configurable (unificado vs. separado por tipo) y se descartó: una página única con tarjetas de filtro ya cubre los dos casos (ver todo junto por default, o acotar a un tipo con un click) sin duplicar arquitectura de routing/sidebar. Lo único que se pierde es una URL fija por tipo — aceptado como trade-off razonable.
- [x] `FILTERABLE_TYPES` (customFields.js) suma `product_type` — con eso el tipo de producto entra al mismo mecanismo genérico de filtrado que ya usan Estado/select/etc. (incluido el filtro por columna en el encabezado de la Tabla), `filterChoicesFor` suma el caso `product_type` (recibe `productTypes` como opción)
- [x] Tarjetas de filtro por tipo (mismas clases que las tarjetas de Estado de Proyectos), multi-selección, excluidas de la fila de filtros del toolbar para no duplicar el control
- [x] `Products.jsx` ya no recibe `productTypeId`/`productTypeName`/`productTypeSingular` como props — fetchea todos los productos y todos los tipos del workspace de una. `ProductModal` no necesitó cambios (ya era agnóstico al tipo, siempre lo eligió desde un desplegable propio)
- [x] Sidebar: un solo ítem "Productos" en vez de uno por tipo (misma visibilidad condicional: solo aparece si hay al menos un tipo configurado). `App.jsx`: ruta `/products/:id` → `/products`
- [x] Vista mínima del producto repensada a pedido explícito ("el producto mínimo tiene que mostrar cuál es su entidad vendedora"): la tarjeta ahora siempre muestra el tipo (chip junto al nombre, antes no aparecía en mosaico) y la entidad vendedora — si no tiene, dice "Sin entidad vendedora" en vez de ocultar la línea, para que la ausencia sea visible
- [ ] Mismo patrón NO aplicado todavía a Entidades — quedó explícitamente para "a futuro", no se tocó esta ronda

##### Follow-up inmediato (6): "Todas las entidades" — vista unificada ADICIONAL, sin tocar las páginas por tipo
El usuario corrigió el rumbo del punto anterior: para Entidades, a diferencia de Productos, **no** quiere reemplazar la arquitectura por tipo (páginas + ítems de sidebar existentes) — la pide intacta ("dejala como están"). Lo que sí pidió es sumar una página "Todas las entidades" con vista unificada, y dentro de ella solapas por tipo de entidad; además, tanto en esa vista unificada como en cada página por tipo, quiere tarjetas de filtro por un campo tipo "Tipo de empresa" (una clasificación distinta de `entity_type`, ej. un select configurado a mano).
- Antes de construir se preguntó y confirmó: (1) el campo que genera las tarjetas es **configurable por workspace** desde Configuración (no un nombre de campo hardcodeado — cada workspace puede no tener "Tipo de empresa" o llamarlo distinto), y (2) la nueva página "Todas las entidades" va **arriba** del divisor de tipos en el sidebar, como acceso rápido adicional, sin sacar nada existente
- [x] SQL: `custom_field_definitions` suma columna `card_filter boolean` — ver bloque de SQL más abajo
- [x] Configuración → Campos personalizados: nuevo toggle "Usar como tarjetas de filtro" en la edición de un campo (junto a "Mostrar como filtro", mismo gate `isFieldFilterable`) — solo uno puede estar activo por `object_type`, activar uno desactiva cualquier otro automáticamente
- [x] `Entities.jsx`: `entityTypeId` pasa a ser opcional. Sin él (ruta `/entities`, sin `:id`) fetchea todas las entidades del workspace (antes filtraba por tipo en la query) y muestra: solapas por tipo ("Todas" + una por `entity_type`, 100% client-side, no dispara requests nuevos al cambiar) y, si hay un campo marcado `card_filter`, tarjetas clicables con sus valores (mismas clases que Estado en Proyectos / Tipo de producto en Productos)
- [x] Las tarjetas de filtro (no las solapas) aparecen también en las páginas por tipo existentes, no solo en la vista unificada — a pedido explícito ("dentro de cada [página/tipo] sí genera los filtros de tarjeta")
- [x] Import de Excel/CSV se oculta en modo unificado (es inherentemente por tipo, no se extendió esta ronda — no pedido)
- [x] Vista mínima de tarjeta en modo unificado: chip de tipo de entidad junto al nombre (mismo criterio aplicado a Productos la ronda anterior)
- [x] Sidebar: nuevo ítem "Todas las entidades" arriba del divisor de tipos (visible solo si hay al menos un tipo configurado, mismo criterio que el resto). `App.jsx`: ruta nueva `/entities` (sin `:id`) convive con `/entities/:id` sin cambios
- [ ] **Hallazgo de paso, no corregido esta ronda**: el toggle "Mostrar como filtro" en Configuración ya existía antes de esta sesión pero resultó ser dead code — ninguna página lo lee, la elegibilidad para mostrar un filtro se decide 100% por `field_type` vía `isFieldFilterable()`. El usuario confirmó que ya no hace falta (era para lo que ahora resuelve el header de la Tabla) — pendiente sacarlo cuando se retome el punto de filtros en Mosaico/Kanban (ver más abajo)
- [x] SQL corrido y confirmado por el usuario en producción — las tarjetas funcionan

##### Bug encontrado probándolo: editar una entidad con contactos viejos rompía el guardado (y borraba los contactos) — corregido
Al probar las tarjetas de "Tipo de empresa", el usuario reportó que editar una entidad existente y guardar se quedaba colgado en "Guardando..." para siempre. Consola: `TypeError: Cannot read properties of null (reading 'trim')`.
- Causa: `EntityModal.handleSubmit` hacía `.trim()` directo sobre los campos opcionales de cada contacto (cargo/email/teléfono/whatsapp/notas). Los contactos nuevos arrancan en `''` (via `emptyContact()`), pero los contactos ya guardados en la base pueden tener esos campos en `null` — típico en contactos viejos sin completar todo. Sin `try/catch`, la excepción cortaba `handleSubmit` a mitad de camino, nunca llegaba al `setLoading(false)`
- **Importante para el usuario**: en el flujo de edición el `delete` de contactos viejos ya había corrido antes de la excepción, así que el `insert` de los nuevos nunca se ejecutaba — los contactos de cualquier entidad donde se haya pegado contra este bug (editar y que se cuelgue en "Guardando...") quedaron borrados. Vale la pena revisar si hay entidades con contactos faltantes
- [x] Fix: los 5 campos se normalizan con `(campo || '').trim()` antes de guardar (alta y edición), y `handleSubmit` queda envuelto en `try/catch` — un error similar en el futuro va a mostrar un mensaje en pantalla en vez de colgar el botón en silencio
- [ ] Sin SQL — no hace falta correr nada, es un fix de código nada más

##### SQL pendiente de aplicar
- [ ] `alter table public.custom_field_definitions add column if not exists card_filter boolean not null default false;` — **ya corrido por el usuario en esta ronda**, se deja el bloque documentado por historial

##### Follow-up inmediato (7): botón "Filtros" para Mosaico/Kanban — acordado y construido
Se pensó junto con el usuario antes de tocar código (pidió explícitamente no implementar hasta acordar el enfoque). Confirmado: un solo botón "Filtros" en el toolbar, visible en las 3 vistas, que abre un panel reutilizando `ColumnFilterMenu` por campo — en vez de volver a poner N desplegables sueltos (eso era justo la queja original sobre el toolbar de Proyectos). Sobre el buscador: confirmado que la búsqueda 100% libre vive únicamente en el buscador global del header — los buscadores de cada página quedan acotados a nombre (o nombre + producto vinculado, como ya estaba en Proyectos), no se tocan.
- [x] `FiltersPanelButton.jsx` (nuevo, compartido) — botón + panel popover con un `ColumnFilterMenu` por campo filtrable, mismo estado que ya escriben el encabezado de columna y (en Proyectos) las tarjetas de tipo de entidad
- [x] Proyectos: hueco real corregido — antes de esta ronda, Mosaico/Kanban solo tenían acceso a Estado (tarjetas propias) y Actividad; ahora también a Cliente/Proveedor/Participantes/etc. vía este botón
- [x] Entidades/Productos: sus filtros de toolbar (un `<select>` de una sola opción por campo, siempre en fila) se consolidan en este mismo botón — mejora de consistencia, no había un hueco funcional ahí (ya tenían acceso en toda vista), pero quedaba desprolijo y con un widget más pobre que el checklist
- [x] Los campos con tarjetas propias siempre visibles (Estado, Tipo de producto, el campo elegido para tarjetas en Entidades) quedan afuera del panel — no hace falta duplicarlos, ya tienen acceso en cualquier vista
- [x] Limpieza confirmada con el usuario: se saca el toggle "Mostrar como filtro" de Configuración (dead code documentado la ronda anterior, ahora confirmado innecesario) y el componente `CustomFieldFilter` que quedó sin consumidores
- [ ] Sin SQL — cambio de código nada más

##### Follow-up inmediato (8): Tabla y Mosaico unificados entre Proyectos/Entidades/Productos
Pedido explícito de limpieza de código y armonía visual — las tres páginas tenían su propia implementación de Tabla y de Mosaico, casi idénticas pero no compartidas. Antes de tocar código se acordaron dos decisiones: (1) qué diseño gana en cada vista al unificar, y (2) si Kanban se suma a Entidades/Productos.
- Confirmado: Tabla se unifica sobre la base de Proyectos (columnas redimensionables + filtro en el encabezado, la más avanzada de las tres); Mosaico se unifica sobre la base de Entidades/Productos (avatar circular + pie con badges, la más prolija), extendido a Proyectos. Kanban queda exclusivo de Proyectos, sin cambios — Entidades/Productos no tienen un campo de tipo "estado/pipeline" con el mismo sentido
- Pedido de paso: el checkbox de selección en Mosaico no debía superponerse con el contenido — en Entidades/Productos era `position:absolute` en la esquina y con texto largo (o el chip de tipo nuevo) quedaba encima. Se corrigió como parte de la unificación: ahora es un hijo más del layout flex, igual criterio que ya tenía resuelto Proyectos con su franja lateral
- [x] `TableGrid.jsx` (nuevo, compartido) reemplaza las 3 implementaciones de tabla — cada página solo aporta `renderCell` y `getColumnFilter`
- [x] `CardGrid.jsx`/`CardTile`/`CardTileNew` (nuevo, compartido) reemplaza las 3 implementaciones de mosaico — avatar, título+insignia, subtítulo, badge a la derecha (estado en Proyectos), pie para chips/badges. Checkbox sin superposición
- [x] `src/lib/avatarColors.js` (nuevo) — `getInitials`/`getAvatarColor` que antes estaban duplicados idénticos en Entidades y Productos
- [x] Kanban de Proyectos sin tocar — sigue usando `renderCardField` tal cual, que ahora también reutiliza CardsView de Proyectos (mismo helper, dos consumidores)
- [x] Limpieza: ~170 líneas netas menos pese a sumar 3 archivos compartidos — se borraron las 3 implementaciones de tabla viejas, las clases CSS `.neg-card*`/`.entity-card*` que quedaron sin ningún uso, y los helpers de avatar duplicados
- [ ] Sin SQL — cambio de código nada más

##### Follow-up inmediato (9): ajustes tras probar la unificación — vista por defecto, Contactos, tipo de entidad en Mosaico/Kanban
- [x] Tabla pasa a ser la vista por defecto en las 3 páginas (en escritorio; Mosaico sigue siendo el default en pantallas angostas, mismo criterio que ya tenía Proyectos) — Entidades/Productos abrían en Mosaico, ahora las tres abren igual
- [x] Bug real en Entidades: "Contactos" (sub-formulario repetible, no una celda) podía aparecer como columna en Tabla/Mosaico si el navegador tenía una preferencia de columnas guardada de antes de que existiera la exclusión ya aplicada a `allColumns`/Configuración — esa exclusión no cubría `visibleCols` dentro de la grilla en sí. Se agrega un filtro defensivo (`safeCols`) en el único lugar que hacía falta, para que ese campo nunca pueda mostrarse sin importar qué haya quedado guardado de antes
- [x] Proyectos: cuando hay más de una entidad vinculada de distinto tipo, Mosaico y Kanban ahora muestran el tipo como prefijo del nombre ("Cliente: Acme S.A.")
- [x] Tabla de Entidades/Productos: la columna "Proyectos totales" mostraba un número pelado — se reemplaza por los mismos badges por estado que ya tenía el pie de Mosaico (`getStateCounts`/`getStateConfig`), confirmado con el usuario vía pregunta explícita ("mismos badges" vs. una versión más compacta de punto+contador)
- [ ] Sin SQL — cambio de código nada más

##### Follow-up inmediato (10): Configuración reorganizada por módulo — Proyectos/Entidades/Productos
Propuesta del propio usuario, con estructura detallada incluida en el pedido ("¿No es mejor armar un menú por cada tipo de cosa...?"). Antes de construir se le devolvió una lectura del alcance real (Estados/Tipos de entidad/Tipos de producto ya eran pestañas separadas; lo único cross-cutting era "Campos personalizados") y una propuesta concreta, confirmada por el usuario.
- [x] 3 pestañas padre nuevas (Proyectos / Entidades / Productos) reemplazan las 4 viejas (Estados / Tipos de entidad / Tipos de producto / Campos personalizados). Cada una con sub-secciones internas (mismo widget de pastillas que ya existía para los selectores de objeto)
- [x] `TabCamposPersonalizados` pasa a recibir `objectType` como prop en vez de tener su propio selector interno
- [x] `TabEstados` pierde su selector Proyectos/Entidades/Tareas — se confirmó en el código que "Entidades" y "Tareas" no estaban conectados a nada real (tareas tiene estados fijos en código; entidades no tiene un campo de estado propio), así que queda exclusivo de Proyectos
- [x] Contactos: consultado explícitamente con el usuario, se decide dejarlo tal cual — sigue viviendo dentro de "Campos" de Entidades, sin sub-sección propia, porque hoy no hay nada más configurable ahí (los sub-campos del contacto están fijos en código, no son data-driven)
- [ ] Sin SQL — cambio de código nada más

##### Follow-up inmediato (11): 4 ajustes reportados probando Tabla/Mosaico en uso real
- [x] Contactos: se saca por completo de Tabla/Mosaico de Entidades, incluido el conteo (`contacts_count`) que había quedado — solo se ve en el modal de la entidad
- [x] Orden preset de columnas: ahora sigue el orden ya armado en Configuración → Campos (`computeFieldOrder`) en vez del orden de creación crudo — cada usuario lo sigue pudiendo reordenar después a su gusto, eso no cambia
- [x] UI: bandera pegada al nombre en la columna "Nombre" de Entidades — celda sin `display:flex` propio, corregido
- [x] Filtros de columna solo alcanzaban a los campos con lista de opciones predefinida — se extiende a texto/número/fecha/link/email/teléfono, armando el checklist con los valores realmente cargados (mismo criterio que un filtro de Excel). Se separa `isCardFilterable` (para "tarjetas de filtro", sigue restringido al set chico) de `isFieldFilterable` (para el checklist, ahora amplio)
- [ ] Sin SQL — cambio de código nada más

##### Follow-up inmediato (12): tarjeta de Total + porcentaje en las 3 páginas
- [x] `TotalStatCard` (nuevo, compartido) — primera tarjeta siempre visible en Proyectos/Entidades/Productos (y cada página por tipo de entidad, mismo componente `Entities`), con el total sin filtrar. En Entidades, si hay una solapa de tipo activa, el total es de ese tipo
- [x] Subtotal condicional: si hay algún filtro activo, segunda línea nombrando qué está filtrado cuando se puede armar una etiqueta legible (ej. "5 entidades: Argentina") — nuevo helper `describeFieldFilters` en `customFields.js`
- [x] Porcentaje agregado junto al conteo en todas las tarjetas con barra de progreso (Estado en Proyectos, tarjetas de filtro en Entidades, Tipo de producto en Productos)
- [ ] Sin SQL — cambio de código nada más

##### Follow-up inmediato (13): filtros facetados — solo valores realmente disponibles
- [x] `filterChoicesFor` recorta TODOS los tipos enumerables (país/usuario/estado/tipo de producto/select/multiselect) a los valores presentes en las filas relevantes, no un catálogo de referencia completo (el bug reportado: ~195 países del mundo en el filtro de País de Entidades, cuando el workspace solo tenía 5)
- [x] Filtrado facetado estilo Excel: el checklist de cada filtro se arma contra las filas que matchean todos los DEMÁS filtros activos (búsqueda, otros campos, tipo de entidad, actividad) — recorta dinámicamente a medida que se aplican otros filtros, en las 3 páginas, tanto en el encabezado de columna como en el botón "Filtros"
- [x] La fila de tarjetas superior (Estado/Tipo de producto/tarjetas de Entidades) queda sin facetar a propósito, mismo criterio que ya tenía — solo se le aplica el recorte a valores realmente cargados
- [x] Nuevo helper `matchesAllFieldFilters` en `customFields.js`, reusado por `matchesAllXFilters(row, {excludeDefKey})` en las 3 páginas
- [ ] Sin SQL — cambio de código nada más

##### Follow-up inmediato (14): import/export masivo de Productos
Pedido explícito, con la decisión de dónde ubicarlo dejada a criterio propio ("desde cada entidad o desde la pestaña correspondiente, donde creas que quede mejor"). Se eligió la página de Productos (ya unificada, sin pestañas por tipo) en vez de repartirlo por entidad — un import masivo típicamente trae productos de varios proveedores en una sola planilla, no encaja bien scopeado a una sola entidad.
- [x] `ImportProductsModal.jsx` (nuevo) — mismo patrón que `ImportEntitiesModal.jsx`, con "Tipo de producto" y "Proveedor/Vendedor" como columnas de texto resueltas por nombre (no hay pestaña que dé el tipo implícito, a diferencia de Entidades)
- [x] Export a Excel (.xlsx) — respeta selección actual o lo filtrado, mismo criterio que Proyectos
- [ ] Sin SQL — cambio de código nada más

### Pantalla de bienvenida para workspaces nuevos sin configurar
Al abrir el primer cliente pagador (workspace de equipo creado a mano vía SQL, sin flujo de alta propio todavía), el owner entraba a una app completamente vacía — sin tipos de entidad, sin estados, sin campos custom — y tenía que armar todo desde Configuración antes de poder cargar el primer dato. Se pidió una pantalla de bienvenida que ofrezca eso de entrada.
- [x] Columna nueva `workspaces.onboarded boolean not null default true` — default `true` a propósito, para que ningún workspace ya en uso muestre esta pantalla retroactivamente. Los workspaces nuevos se crean con `onboarded = false` explícito en el insert de bootstrap
- [x] `WelcomeSetup.jsx` (nuevo): se muestra en vez del sidebar+contenido normal cuando el workspace activo es de equipo, `onboarded = false` y el usuario es `owner` — un miembro invitado después a un workspace ya configurado no la ve nunca, porque para cuando se lo invita `onboarded` ya quedó en `true`
- [x] Dos opciones, ambas marcan `onboarded = true` al terminar: **Configuración recomendada** (siembra 3 tipos de entidad, pipeline de 5 estados y los 14 campos — mismo dominio de licensing farmacéutico que ya usa el resto de la app) y **Armarlo yo mismo** (siembra solo los 5 campos estructurales indispensables + 2 estados básicos, sin tipos de entidad ni campos sugeridos)
- [x] `src/lib/seedWorkspaceDefaults.js` (nuevo) — la siembra vive en JS (mismos inserts que ya hace Settings a mano), no en el SQL de bootstrap, así puede ofrecerse como elección en la UI en vez de ser todo-o-nada
- [ ] Sin probar con Playwright — no se puede simular un workspace nuevo real sin la columna `onboarded` ya corrida en Supabase (esta sesión no tiene acceso a la Supabase real). Verificado por build + lectura de código; pendiente de confirmación manual del usuario tras correr el SQL

##### SQL pendiente de aplicar
- [ ] `alter table public.workspaces add column if not exists onboarded boolean not null default true;`
- [ ] Al crear un workspace de equipo nuevo a mano, agregar `onboarded: false` explícito al insert de bootstrap (si no, hereda el default `true` y nunca vería la pantalla)

### Bulk actions y import desde Excel/CSV
- [x] **Selección múltiple + acciones en lote** — en Proyectos (tabla y mosaico, ya existían los checkboxes para la card de pipeline) y en Entidades (nuevo, checkboxes agregados a ambas vistas). Al tildar filas aparece una barra/card con la cantidad seleccionada
  - Proyectos: cambiar estado en lote (dispara el mismo efecto secundario que un cambio individual — `notifyNegotiationStatusChanged` + `logActivity` por cada proyecto afectado, no un atajo que se salte las notificaciones) y eliminar en lote, gateado a owner (mismo permiso que el borrado individual)
  - Entidades: eliminar en lote, mismo gate de owner. Tildar un checkbox no abre el detalle (`stopPropagation`)
  - El borrado en lote reusa `DeleteConfirmModal` con `itemName="ELIMINAR"` en vez de un nombre específico — no tiene sentido pedir que escriban el nombre exacto cuando son varios elementos distintos, pero se mantiene la fricción de "escribir para confirmar" antes de un borrado irreversible
- [x] **Import desde Excel/CSV** — botón "⬆ Importar" en el toolbar de Proyectos y de Entidades (gateado a owner/admin/editor). Mismo componente `parseSpreadsheet()` (`src/lib/importXlsx.js`) para ambos, reusa `xlsx` (SheetJS) con `import()` dinámico igual que los exports — nada de esto suma peso al bundle inicial
  - Flujo en 2 pasos: subir archivo → preview con validación fila por fila (✓ ok / ⚠ advertencia, se importa igual / ✗ error, se excluye) → confirmar. Nunca se importa a ciegas
  - Botón "Descargar plantilla vacía" en el paso de subida (genera un `.xlsx` con solo los headers esperados) — para no dejar al usuario adivinando qué columnas poner
  - Entidades: columnas `Nombre*` / `País` / `Sitio web` / `Tipo de empresa`. País se resuelve por nombre o código de 2 letras (`getCountryCode`, reverso nuevo de `getCountryName` en `CountrySelector.jsx`) — si no matchea, advertencia y se importa sin país
  - Proyectos: columnas `Producto*` / `Proveedor` / `Estado` / `NDA` / `Territorios` (separados por coma) / `Fecha objetivo`. Proveedor se resuelve por nombre exacto contra las entidades ya cargadas del workspace (cualquier tipo, no solo Proveedores) — si no matchea, advertencia y el proyecto se crea igual sin vincular. Estado se resuelve contra los `custom_states` reales del workspace — si no matchea o viene vacío, usa el primero de la lista y avisa
  - Bug real encontrado y corregido durante las pruebas: al parsear `.csv` las fechas se convertían al número de serie de Excel en vez de una fecha (`cellDates: true` solo estaba puesto en la rama de parseo de `.xlsx`, faltaba en la de `.csv`) — y aparte, el helper genérico `getCell()` volvía todo `String()` antes de llegar al parser de fechas, lo que rompía el objeto `Date` ya bien parseado. Se sumó `getCellRaw()` (sin stringificar) específicamente para la columna de fecha
  - Deliberadamente sin remapeo de columnas por UI (los headers son fijos, documentados en el modal + la plantilla descargable) y sin registrar una entrada de `activity_log` por cada fila importada (sería puro ruido en el timeline para un import de decenas de filas) — si hace falta más adelante, se puede sumar un tipo de evento "import" que loguee un resumen en vez de una entrada por fila
  - Probado con Playwright en ambos flujos (selección+lote y import), con archivos `.xlsx` y `.csv` reales generados para el test, incluyendo filas con error/advertencia a propósito para validar que el preview las marca bien

### @menciones
- [x] Se pueden mencionar compañeros de equipo escribiendo "@Nombre" en cualquier nota (`NotesPostIts` — cubre notas de proyecto, de entidad, y las sueltas del workspace personal, es un único componente reusado en los 3 lugares). Autocompletado al tipear "@" con los miembros activos del workspace (excepto uno mismo), navegable con click; `Escape` cierra el dropdown sin insertar nada
- [x] Sin sintaxis oculta ni IDs embebidos — al elegir a alguien del dropdown se inserta literalmente "@Nombre Completo " como texto plano en la nota (igual de legible releyendo la nota después). A quién notificar se decide comparando ese texto contra los nombres reales de los miembros del workspace al momento de guardar, no parseando con una regex de "una sola palabra" (los nombres tienen espacios)
- [x] Al editar una nota existente, **solo notifica las menciones nuevas** (compara el texto anterior contra el nuevo) — resguardar contra el caso de re-guardar una nota ya mencionada y generar una notificación duplicada cada vez
- [x] `notifyMentioned()` en `src/lib/notifications.js`, mismo patrón que el resto de notificaciones existentes (respeta `notification_preferences`, no te notifica si te mencionás a vos mismo). Nuevo tipo `mentioned` sumado a la lista configurable en Settings → Notificaciones
- [x] Deep-link completo en las 2 superficies con navegación posible: nota de proyecto (`negotiation_id`) y nota de entidad (`entity_id`, columna nueva en `notifications`). Notas sueltas del workspace personal siguen sin a dónde navegar (no cuelgan de nada) — la notificación llega igual, solo se puede descartar
- [x] **Nota técnica sobre el flujo de esta sesión**: este entorno de trabajo corre en un sandbox sin salida de red hacia la base de Supabase real (confirmado — cualquier intento de pegarle directo devuelve 403 de política), así que las migraciones de schema no las puedo ejecutar yo — se le pasa el SQL al usuario y lo corre manualmente en el editor de Supabase, como ya se venía haciendo en sesiones anteriores. Acá se le pasó `alter table notifications add column entity_id uuid references entities(id) on delete cascade;`, confirmó haberlo corrido, y recién ahí se wireó `entity_id` en `notifyMentioned`/`NotesPostIts`/`NotificationBell` (este último resuelve `entity_type_id` a partir del `entity_id` de la notificación al hacer click, mismo patrón de lookup que ya usaba para `task_id` → `negotiation_id`, para armar el link `/entities/:entityTypeId?openEntity=:id`)
- [x] Probado con Playwright en dos superficies (nota de proyecto y nota de entidad): autocompletado filtra bien, inserción de mención correcta, notificación con destinatario/tipo/body/negotiation_id correctos, no se auto-notifica al autor, y volver a guardar la nota sin agregar menciones nuevas no genera notificaciones repetidas

### Scorecard de proveedor (o cualquier tipo de entidad)
- [x] Nueva pestaña "Resumen" en el detalle de una entidad (`EntityDetailModal` → `EntityScorecard`), primera de la lista y activa por defecto (antes arrancaba en "Actividad") — consolida en un solo lugar métricas que antes estaban dispersas o no existían en ningún lado
- [x] Tarjetas de stat (mismo estilo que las chips que ya existían en la pestaña Proyectos): Proyectos totales, Completados, En curso, Tareas pendientes (suma las de sus proyectos vinculados + las tareas propias de la entidad, `entity_id`)
- [x] Valor de pipeline vinculado a esa entidad — no existía antes a nivel entidad (solo agregado a nivel workspace en Dashboard/Proyectos). Suma `deal_milestones` de todos sus proyectos agrupado por moneda, mismo criterio que el resto de la app (sin conversión automática)
- [x] Distribución por estado como gráfico de barras horizontal (CSS puro, sin canvas/librería — `.scorecard-bars`), usando los colores reales de `custom_states` del workspace
- [x] Bloque de actividad: última actividad entre todos sus proyectos (fecha relativa "hace Nd", mismo criterio que la tabla de Proyectos), alerta si tiene proyectos pausados/inactivos (`activity_status`), y antigüedad de la relación ("Proveedor desde {fecha}", usando `entities.created_at`)
- [x] Desglose de NDA (cuántos proyectos en cada estado de NDA), mismo formato que el resumen del export a PDF
- [x] Deliberadamente **no** se incluyó "tiempo de respuesta" pese a estar en la idea original — no hay ningún timestamp de mensajes/respuestas en el modelo de datos actual para calcularlo sin inventar un dato; queda para si en algún momento se agrega algo tipo hilo de mensajes
- [x] Todo el fetch de datos nuevos (pipeline, tareas de los proyectos vinculados) vive en un `useEffect` propio del modal, con queries puntuales por `negotiation_id in (...)` — mismo patrón que ya se usaba en los exports a PDF, no se tocó el fetch principal de la lista de Entidades
- [x] Probado con Playwright: la pestaña "Resumen" abre por defecto, tarjetas y valores correctos con una entidad con 4 proyectos en distintos estados/actividad (uno completado, uno inactivo, uno pausado), pipeline sumado bien entre 2 hitos, barras por estado con los colores esperados, alerta de inactivo/pausado, antigüedad y desglose de NDA correctos, y que cambiar de pestaña y volver no rompe nada

### Export de Proyectos
- [x] Botón "⬇ Exportar Excel" en el toolbar de `/negotiations`, junto a "⚙ Columnas". Exporta la lista `filtered` (respeta los filtros de búsqueda/proveedor/estado/actividad activos) usando exactamente las columnas visibles del usuario (`cols`) — si hay filas seleccionadas, exporta solo esas en vez de todo lo filtrado
- [x] Arrancó como CSV cliente-only, pero probando en real aparecieron dos bugs seguidos específicos de Excel: (1) todo el contenido caía en una sola columna — Excel en configuración regional es-AR/es-ES usa coma como separador decimal y espera `;` como separador de CSV, no `,`; (2) después de corregir el delimitador, los acentos salían con mojibake (`DroguerÃ­a` en vez de `Droguería`) — problema de detección de codificación que ni el BOM UTF-8 resolvía de forma confiable. En vez de seguir parchando caso por caso, se cambió a generar un **`.xlsx` real** con la librería `xlsx` (SheetJS) — sin delimitador ni codificación de texto de por medio, ambos problemas desaparecen de raíz
- [x] `exportNegotiationsXlsx` — 100% cliente (sin Edge Function), usa `XLSX.utils.aoa_to_sheet` + `XLSX.writeFile`, ancho de columna fijo, mismo mapeo de columnas que tenía el CSV (fechas en ISO en vez del formato relativo "hace Nd" de la tabla)
- [x] Nota de seguridad: `xlsx` tiene 2 CVEs sin parchear (prototype pollution y ReDoS), pero ambos son del lado de **parseo/lectura** de archivos maliciosos — acá solo se usa para **escribir** desde datos propios del workspace, nunca se lee un `.xlsx` subido por nadie. Si en algún momento se construye el import de proyectos/entidades por Excel (ver "Bulk actions / import CSV" más abajo), ahí sí hay que revisar esto de nuevo antes de habilitar la lectura
- [x] Probado con Playwright: descarga real, parseo del `.xlsx` resultante con la misma librería para confirmar headers, valores y que los acentos viajan bien (`Droguería del Sur` exacto, sin mojibake)
- [x] **Export a PDF** — el botón "⬇ Exportar" pasa a abrir un menú con 2 opciones (Excel / PDF) en vez de exportar directo. El usuario compartió un PDF de referencia de una versión anterior de la app (NegociaTrack) y pidió una "presentación completa" en hojas horizontales, no solo el detalle de proyectos
  - `src/lib/exportPdf.js` — genera el PDF 100% del lado del cliente con `jspdf` + `jspdf-autotable` (sin Edge Function): portada full-bleed navy (marca Nerva) con título/subtítulo/stats, página de resumen con 4 tarjetas de stat (Proyectos/Proveedores/Completados/Tareas pend.), línea de valor de pipeline (reusa `pipelineByCurrency` ya existente), gráfico de barras horizontal "Pipeline por estado" usando los colores reales de `custom_states` del workspace (no hardcodeados como el ejemplo), línea de desglose de NDA, y una página por proyecto (header con estado/NDA/fecha en pills, tabla clave-valor con proveedor/territorios/participantes/empresas/descripción/notas/observaciones/tareas). Pie de página con paginación en todas las páginas
  - Los proyectos se ordenan por proveedor y después por producto (agrupación dejada a mi criterio, así quedan juntos los proyectos del mismo proveedor, como en el ejemplo de referencia)
  - Las tareas no vienen precargadas en la lista principal de Proyectos — se agregó una query puntual (`fetchTasksByNegotiation`) que solo corre al generar el PDF, trayendo título/estado/fecha/asignado de cada tarea de los proyectos exportados
  - `xlsx` y `jspdf`/`jspdf-autotable` se cargan con `import()` dinámico (code-splitting) en vez de import estático — jsPDF arrastra `html2canvas`+`dompurify` de dependencia, y como son acciones ocasionales (no el flujo principal de la página) no tiene sentido sumarlos al bundle inicial. El chunk principal de `/negotiations` quedó igual de liviano que antes de agregar estos exports
  - Probado con Playwright: genera 5 páginas para 3 proyectos (portada + resumen + 3 detalle), conteo de página verificado con `pdf-parse`, texto extraído confirma stats correctos, agrupación por proveedor correcta, acentos sin mojibake, tareas con "(hecha)" cuando corresponde
  - Refactor: las piezas visuales compartidas (colores, `drawCover`/`drawFooter`/`drawStatCards`/`drawStateBarChart`/`drawPill`/`stateColorRgb`/`formatDatePdf`) se extrajeron a `src/lib/pdfTheme.js` para reusarlas también en el export de Proveedores (ver abajo) sin duplicar código. Re-probado con Playwright después del refactor para confirmar que no rompió nada

### Export de Entidades (todos los tipos, un solo PDF)
- [x] Mismo botón "⬇ Exportar PDF" en el toolbar de `/entities/:id`, junto al toggle de vista. El usuario compartió una presentación de referencia (`.pptx` de una versión anterior de la app) con el contenido que quería incluir — se usó `markitdown` para extraer el texto de las 14 diapositivas (el conversor a imagen de LibreOffice no funcionó en este entorno), suficiente porque el lenguaje visual ya estaba definido por el PDF de Proyectos
- [x] Primera versión exportaba solo el tipo de entidad de la pestaña activa (un archivo distinto por cada tipo — Proveedores, Clientes, etc.). El usuario pidió unificarlo: **un solo PDF con todos los tipos**, descargable desde cualquier pestaña de Entidades, con estructura resumen general → una página divisoria por tipo → el detalle de cada entidad de ese tipo, y así con el siguiente tipo
- [x] `exportAllEntitiesPdf({ workspaceId, customStates, workspaceName })` en `src/lib/exportEntitiesPdf.js` — ya no recibe la lista de entidades ya cargada por la pestaña (`filtered`, acotada a un tipo), hace sus propias queries por `workspace_id` para traer **todos** los `entity_types` y **todas** las `entities` del workspace de una sola vez
- [x] Portada navy + resumen general (tarjetas de stat/pipeline/gráfico de barras por estado, usando `pdfTheme.js` compartido) con una línea nueva "ENTIDADES POR TIPO" (ej. "5 Proveedores · 3 Clientes") para dar contexto de la mezcla de tipos. Después, por cada tipo con al menos una entidad: una página divisoria navy de ancho completo (mismo estilo que la portada, título = nombre plural del tipo) seguida de una página por entidad (contactos, pills de estado, tabla de proyectos) — sin página divisoria para tipos sin entidades cargadas
- [x] Las páginas divisorias no llevan pie de página (el texto gris del footer no se leería sobre el fondo navy) — se arma explícitamente la lista de páginas que sí llevan footer en vez de aplicarlo a un rango continuo, así la numeración final ("1/9", "2/9"...) solo cuenta resumen + detalle de entidades, no las divisorias
- [x] Adaptado al modelo de datos real de Nerva en vez de copiar la referencia tal cual: sin campo "Tipo" (no existe en `entities`) ni columna "#" en la tabla de proyectos (no hay numeración global estable) — se mantuvo `#{índice}` (reiniciado por tipo) en el header de cada página, igual que el export de Proyectos
- [x] Territorios, tareas pendientes por proyecto e hitos de pago no vienen precargados en ningún lado — `fetchExtraData` hace 2 queries puntuales (`tasks`/`deal_milestones`) solo al generar el PDF; territorios y moneda ahora se traen en la misma query de `negotiations` en vez de una query aparte (ya no hace falta, al no reusar la lista de Entidades.jsx)
- [x] Genérico respecto a los tipos de entidad configurados por workspace — no hardcodea "Proveedores"/"Proveedor" en ningún lado, usa `entity_types.name`/`entity_types.plural` reales de cada tipo
- [x] Probado con Playwright: botón disparado desde la pestaña de un tipo (Proveedores) genera igual un PDF con 7 páginas para 2 tipos con 3 entidades en total (portada + resumen + divisoria Proveedores + 2 detalle + divisoria Clientes + 1 detalle), confirmado que incluye entidades de un tipo distinto al de la pestaña activa, contenido verificado con `pdf-parse` (nombres y contactos con acentos sin mojibake, breakdown por tipo, pills de estado, tabla de proyectos), capturas visuales de portada y ambas páginas divisorias revisadas

### Kanban visual de Proyectos
- [x] Tercera vista en `/negotiations` (☰ tabla / ⊞ cards / ▦ kanban), toggle junto a los otros dos. Columnas = `custom_states` del workspace (mismas que ya se configuran en Settings, orden por `sort_order`) — no hace falta ningún estado nuevo, ni tabla nueva
- [x] `KanbanView` — cards con producto/título, proveedor principal (+ bandera), NDA, fecha objetivo e ícono de pausado/inactivo, mismo criterio visual que `CardsView`. Drag & drop nativo (mismo patrón que el Kanban de la Agenda personal) + botones ‹/› como fallback accesible/testeable, moviendo a la columna anterior/siguiente según el orden de `custom_states`
- [x] Mover una card dispara exactamente el mismo efecto secundario que cambiar el estado desde el detalle: `notifyNegotiationStatusChanged` (notifica a los asignados de las tareas del proyecto) + `logActivity` (entrada en el timeline de actividad) — se extrajo a `handleKanbanMove` en vez de duplicar lógica
- [x] El editor de campos visibles (ahora "⚙ Vista", renombrado — antes "⚙ Columnas") está presente en las 3 vistas (tabla/mosaico/kanban) en vez de ocultarse en kanban, y las cards de kanban ahora respetan de verdad esa configuración (reusan `renderCardField`, la misma función que ya usaba la vista mosaico) — pedido del usuario tras notar que ocultar el botón en kanban hacía "saltar" el resto del toolbar
- [x] Ajuste de estética menor (pedido del usuario, screenshot de por medio): los botones del toolbar de Proyectos y de Entidades no compartían la misma altura (padding vertical variable según el tamaño de fuente de cada uno) — se fijó `height: 36px` + `box-sizing: border-box` en todos los botones/toggles de ambos toolbars
- [x] Probado con Playwright: columnas correctas, cards correctas, click abre detalle, drag&drop nativo y botones ‹/› ambos mueven y actualizan el status en el servidor, notificación y activity log generados. Alturas de botones consistentes (36px) en las 3 vistas, sin salto de layout al cambiar a kanban, cards de kanban reflejan la config de campos visibles

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

*(Plan/billing/self-registration/permisos por proyecto → absorbido por **Fase E** del Roadmap Maestro, arriba. Se ejecuta cuando el CRM esté probado con más de un cliente pago, no antes.)*

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

*(API/webhooks y self-serve → **Fase E**; constructor de formularios/subentidades/calendario/multi-workspace completo quedan de backlog general, sin fase asignada todavía — se ubican cuando haya necesidad concreta de un cliente real.)*

- [ ] Constructor de formularios custom por workspace
  - Primer caso concreto pedido por el usuario (sesión 2026-07-30): el campo **"Tipo de empresa"** de Entidades (`entities.custom_fields.company_type`, hoy un `<textarea>` de texto libre en `EntityModal` — "Ej: Laboratorio multinacional, Distribuidor regional...") tiene que pasar a ser una **lista de clases configurable desde Settings**, no texto libre. Aclaración explícita del usuario: esto es un campo *dentro* de cada entidad, no confundir con el **tipo de entidad** (Proveedor/Cliente/etc., tabla `entity_types`) — aplica igual sin importar el tipo de entidad, no es una lista distinta por tipo
  - Motivo: hoy no se puede filtrar por tipo de empresa porque cada quien lo tipea distinto (mismo problema que ya se resolvió para `negotiations.status` con `custom_states`) — el usuario pidió explícitamente que quede "bien armado" porque el objetivo final es habilitarlo como filtro en Entidades, así que la lista de clases tiene que vivir en una tabla propia (mismo patrón que `custom_states`/`entity_types`: nombre + `sort_order` + `workspace_id`, gestionada desde una pestaña nueva de Settings) en vez de seguir siendo una entrada más de un JSON de texto libre
  - Migración de datos pendiente de diseñar: las entidades que ya tienen `custom_fields.company_type` como texto libre necesitan mapearse a la clase nueva más parecida (o quedar sin clasificar) al activar esto — no se puede simplemente convertir el campo de tipo sin perder o tener que reconciliar los valores existentes
- [ ] Multi-workspace completo con selector al login
- [ ] Subentidades / Líneas de negocio dentro de entidades
- [ ] Vista calendario para tareas y proyectos
- [ ] Notificaciones por email con Resend
- [x] Buscador global (`GlobalSearch.jsx`) — sumados Productos, Contactos y Documentos (2026-08-12). Ahora busca en Proyectos, Entidades, Productos, Contactos, Tareas, Notas y Documentos. Productos no tenía mecanismo de deep-link (`?openProduct=`) todavía, se agregó en `Products.jsx` siguiendo el mismo patrón que Proyectos/Entidades. Regla a seguir de acá en más: **cada vez que se agregue una sección/tabla nueva de contenido buscable a la app, sumarla también acá** — para que no se desactualice de nuevo como pasó con Productos
- [x] Invitaciones por email — resuelto vía API de Resend llamada directo desde la Edge Function `invite-user` (`RESEND_API_KEY` como secret, ya configurado en Supabase). Si Resend no está configurado o falla el envío, no rompe la invitación — el link se sigue devolviendo para copiar a mano, como fallback
  - [ ] **Sin verificar en la práctica todavía**: se usa el dominio de pruebas de Resend (`onboarding@resend.dev`), que solo entrega al email exacto con el que se creó la cuenta de Resend (ni siquiera un alias `+algo` del mismo Gmail cuenta como "el mismo email" para ese chequeo). No se pudo probar de punta a punta porque el único candidato a mano (el email del dueño de la cuenta de Resend) ya es usuario de Nerva — al ya tener cuenta confirmada, `invite-user` lo suma directo al workspace sin pasar por el camino que manda mail. Probar con un email nuevo (sin cuenta en Nerva) que coincida exacto con el de la cuenta de Resend, o esperar a tener un dominio propio verificado — ver ítem de dominio más abajo
  - [ ] Todavía sin dominio propio verificado en Resend (el usuario no tiene uno) — evaluar comprar uno barato (`.com` vía Cloudflare Registrar ~USD 10/año, o `.com.ar` vía NIC Argentina) para poder mandar a cualquier destinatario real, no solo al dueño de la cuenta

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
