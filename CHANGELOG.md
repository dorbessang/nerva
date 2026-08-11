# Nerva — Changelog

Registro detallado de cambios por sesión de trabajo.

---

## 2026-08-11 (19)

### Fix: 3 hallazgos de la auditoría de arquitectura + limpieza de CSS muerto
- **`NegotiationModal` tragaba errores de guardado**: a diferencia de `EntityModal`/`ProductModal` (que sí chequean el error de Supabase), si el `update`/`insert` de un proyecto fallaba, el modal se cerraba igual mostrando éxito falso — la data del usuario se perdía en silencio. Ahora chequea el error y lo muestra sin cerrar el modal
- **Un usuario desactivado seguía siendo asignable** en la mayoría de los selectores de responsable/participante (Tasks, TaskModal, TaskDrawer, Negotiations, Products, Entities) — solo @menciones y el campo custom de usuario ya filtraban por activo. Unificado: todos los fetches de `workspace_members` que pueblan un selector ahora filtran `status = 'active'`
- **CSS muerto** de layouts superados (pre-unificación de tablas, banner de inactividad duplicado, opción de selector de workspace nunca usada) — borrado en `Entities.css`, `Dashboard.css`, `Settings.css`, `Layout.css`, `CountrySelector.css`. Confirmado cero referencias antes de borrar, cero cambio visual
- `PENDIENTES.md` gana una regla fija: antes de correr cualquier SQL marcado como pendiente ahí, confirmar primero con el usuario que no esté ya hecho — y una sección nueva con el estado real de la auditoría (RLS de `negotiation_price_history` y backfill de roles, ambos confirmados corridos por el usuario)
- Sin cambios de SQL

## 2026-08-11 (18)

### Feature: post-its se pegan directo en la pestaña, ya no se crean desde Editar
- Antes, un post-it fijado a una página (Financiero/Bitácora/Tareas/Documentos) solo se podía crear desde el formulario de Editar, eligiendo la página en un dropdown — quedaba lejos de donde en realidad se usa
- Ahora cada pestaña tiene su propio botón "+ Agregar post-it": pega un papelito en blanco, ya en modo edición, con la fecha de hoy — se escribe directo ahí (Enter o click afuera guarda, Esc descarta) — sin formulario aparte
- Se eliminó `NegotiationNotesEditor.jsx` (quedó sin uso) y la sección "Notas" del modal de Editar
- Sin cambios de SQL

## 2026-08-11 (17)

### Fix: una notita "fijada en Bitácora" se mezclaba con el registro cronológico
- Causa: al pegar una nota eligiendo "Bitácora" como página desde el modal de Editar, se guardaba con `page = NULL` — exactamente el mismo valor que usa un renglón escrito directo en la Bitácora. Una vez guardadas, ambas cosas eran indistinguibles y el post-it terminaba renderizado como un ítem más del log, en vez de destacarse como recordatorio aparte
- Se separan los dos casos: un renglón de Bitácora sigue usando `page = NULL` (es el registro en sí), pero un post-it "pegado en Bitácora" ahora guarda `page = 'bitacora'` (antes colapsaba a NULL) — la tab de Bitácora ahora renderiza dos secciones: los post-its fijados arriba (estética de nota, como siempre) y el registro cronológico abajo (como ya funcionaba)
- Nota: notas ya guardadas antes de este fix con `page = NULL` que en realidad eran post-its "pegados en Bitácora" no se pueden distinguir retroactivamente de renglones reales del log — quedan mezcladas en el registro. Los pins nuevos, de acá en adelante, no van a tener este problema
- Sin cambios de SQL — la columna `page` ya admitía cualquier texto libre

## 2026-08-11 (16)

### Feature: Enter/Esc en composers chicos, drag & drop en Documentos, historial de precio como quiebres por volumen, "Última cotización" automática, post-its con cinta
- **Enter/Esc en inputs chicos** (no en modales grandes tipo Entidad/Proyecto, ahí solo Esc): Enter confirma, Esc cancela sin guardar — aplicado a Notas/post-its, hitos (`DealMilestones`), historial de precio (`PriceHistory`), y en Configuración a estados, tipos de entidad/producto y campos personalizados (alta y edición inline)
- **Esc cierra la ventana**: nuevo hook `useEscapeToClose` en todos los modales grandes (Entidad, Producto, Proyecto —Vista y Editar—, Tarea, los 3 modales de importación). Los inputs chicos de adentro (notas, hitos, etc.) usan `stopPropagation()` en su propio Escape para que cancelar una nota no cierre de paso el modal entero
- **Drag & drop en Documentos**: además del botón "Examinar" de siempre, ahora se puede soltar un archivo directo (desde el mail, el Finder/Explorer, donde sea) sobre la pestaña de Documentos — mismo límite de 20MB y mismo flujo de subida
- **Historial de precio, aclarado como quiebres por volumen**: "Valor" y "Cantidad" no dejaban claro que el precio es por unidad y la cantidad es el volumen mínimo de compra para ese precio (no una venta puntual) — se renombran los campos y se agrega una aclaración en el formulario. Ej: 1 kg → 1 USD/kg, pero a partir de 500 kg → 1.30 USD/kg, van como filas separadas
- **"Última cotización" en la barra lateral**: nuevo tile automático (calculado del último historial de precio cargado) al lado de Resumen — muestra precio, fecha y detalle sin cargar nada a mano. El campo de texto libre "Cotización" que hubiera configurado como campo personalizado en algún workspace queda redundante con esto — se puede borrar o renombrar desde Configuración si ya no hace falta
- **Post-its con estilo "cinta pegada"**: cada nota ahora tiene una tira de cinta washi en la parte de arriba, con ángulo alternado nota por nota (no todas iguales) — más parecido a un corcho real
- Sin cambios de SQL — todo el cambio es de código

## 2026-08-11 (15)

### Fix: pestañas del modal de Proyecto seguían necesitando scroll para ver la solapa activa
- El intento anterior (agregar `min-height: 0`) no alcanzaba porque la arquitectura era distinta a la de Entidades: tabs fijas + panel con scroll independiente, separados como hermanos flex — el borde inferior que marca la pestaña activa quedaba pegado al límite del contenedor y se recortaba
- Se reemplaza por el mismo patrón que ya funciona en el modal de Entidades: una sola columna con scroll (`.neg-detail-rightpane` con `overflow-y: auto`) donde los tabs viven en el flujo normal del documento, no fijos aparte — igual que `.entity-detail-col--right`/`.entity-tabs`
- Sin cambios de SQL — CSS nada más (`Negotiations.css`)

## 2026-08-11 (14)

### Fix crítico: datos mezclados entre workspaces al pertenecer a más de uno
- **Causa raíz**: las políticas RLS de Supabase usan `my_workspace_ids()`, que devuelve TODOS los workspaces de los que el usuario es miembro — no solo el que está seleccionado en la app. RLS por sí sola nunca restringió a "solo el workspace activo"; eso lo tiene que hacer cada query agregando `.eq('workspace_id', workspaceId)`. Mientras el usuario pertenecía a un solo workspace, el bug era invisible — al agregar una segunda membresía (para soporte/debug), empezaron a aparecer registros de ambos mezclados en listas y dropdowns
- Encontrado con una auditoría completa de los ~235 `.from(...)` del código contra las tablas por-workspace (`entities`, `entity_types`, `products`, `product_types`, `negotiations`, `tasks`, `custom_states`, `workspace_members`); se agregó el filtro faltante en cada punto confirmado:
  - `Tasks.jsx`: la query principal de tareas y los 3 fetches de sus dropdowns (entidades, proyectos, responsables) — el que más directamente explica el síntoma reportado
  - `Negotiations.jsx`: `fetchAll` (proyectos, entidades, tipos de entidad, productos, estados)
  - `Entities.jsx`: listado principal, cross-referencias, tipos de entidad, estados, productos del modal de detalle
  - `Products.jsx`: listado principal, tipos de producto, estados, entidades/tipos/productos del modal de detalle
  - Modales de alta (`EntityModal`, `ProductModal`, `TaskModal`, `TaskDrawer`) y de importación (`ImportProductsModal`, `ImportEntitiesModal`) — todos los que poblaban un dropdown sin filtrar
- No era un caso aislado: era el patrón por defecto en toda la carga inicial de cada pantalla (confiar solo en RLS). Cada punto corregido ahora filtra explícitamente por el workspace activo, además de lo que ya garantiza RLS
- Sin cambios de SQL — todo el fix es de código

## 2026-08-11 (13)

### Fix: Unidad de medida como campo libre + orden de Hitos
- **Unidad hardcodeada**: el select de Unidad (kg/litro/unidad/servicio/proyecto) no cubría los casos reales de uso — se reemplaza por texto libre en ambos lados (Editar y Vista, tab Financiero), sin lista fija. Se elimina `UNIT_OPTIONS` de `financialConfig.js`
- **Hitos, fecha/momento pegado al nombre**: la fecha o referencia de tiempo ("al lanzamiento", etc.) pasa a mostrarse al lado del nombre del hito (antes quedaba después del monto, desprolijo). El monto ahora es una columna alineada a la derecha con ancho fijo, para que se lea de un vistazo. Mismo criterio aplicado en la Vista (`DealMilestones.jsx`) y en la previsualización de hitos del formulario de creación (`NegotiationModal`)
- Sin cambios de SQL

## 2026-08-10 (12)

### Fix: 4 ajustes reportados probando el rediseño del modal de Proyecto
- **Tabs se iban con el scroll**: `.neg-detail-rightpane`/`.neg-tab-panel`/`.neg-detail-sidebar`/`.neg-detail-body--split` (grid/flex items con `overflow`) les faltaba `min-height: 0` — sin eso, un hijo con contenido largo crece más allá del alto disponible en vez de scrollear internamente, empujando toda la tarjeta y obligando a scrollear la página entera para ver el tab activo. Clásico gotcha de flex/grid + overflow
- **Nombre de entidad cortado en la barra lateral**: `.neg-detail-hero` estaba pensado para el ancho completo del modal (~1000px) — en los 280px de la barra lateral, nombre + selector de estado lado a lado no entraban. Pasa a apilarse en columna
- **Unidad de medida invisible al cargar una cotización**: "Cantidad" en el historial de precio no aclaraba en qué unidad — la Unidad solo se podía fijar desde Editar, nunca se veía en la Vista. Ahora Unidad es editable inline en el tab Financiero, al lado de Moneda (mismo criterio), con aviso si falta elegirla antes de cargar cantidades
- **403 en `negotiation_price_history`**: la tabla nueva se quedó sin políticas de RLS (nadie sabía cómo copiarlas) — bloqueaba cualquier insert. Se resuelve con SQL aparte (no corrido desde acá, sin credenciales de Supabase)
- **Hitos no respetaban la fecha asignada**: se listaban por orden de carga siempre. Ahora ordenan por `estimated_date` cuando la tienen (los sin fecha quedan al final, en orden de carga) — de paso, editar la fecha de un hito ahora refresca la lista en vez de parchear en memoria sin reordenar
- Bitácora confirmada funcionando bien tal cual (ya ordenaba por fecha sin importar el orden de carga)
- Sin SQL nuevo — cambio de código nada más (la política de RLS es aparte, en Supabase)

## 2026-08-10 (11)

## 2026-08-10 (11)

### Feature: rediseño del modal de Proyecto — Vista con barra fija + tabs, Financiero siempre presente, Bitácora, notas fijadas por página
- Motivado por feedback directo: el modal de detalle de Proyecto se sentía "desprolijo" comparado con el de Entidades (una sola columna larga de ~10 secciones apiladas), las Notas quedaban perdidas en el medio del scroll, y faltaba una bitácora de texto libre con fecha (distinta del log automático de Actividad)
- **Requiere el SQL ya corrido** (`unit_of_measure`/`payment_terms`/`estimated_value` en `negotiations`, tabla `negotiation_price_history`, `page` en `negotiation_notes`, `financial_config` en `workspaces`)
- **`NegotiationDetail` (Vista)**: mismo patrón que ya funciona en Entidades — barra izquierda fija (280px: hero, Resumen con días sin actividad/tareas pendientes/total de hitos, Entidades vinculadas, Producto, Información) + columna derecha con tabs (Financiero/Bitácora/Actividad/Tareas/Documentos), en vez de una sola columna con todo apilado
- **Financiero pasa a ser parte fija de todo proyecto**, como Contactos en Entidades — ya no depende de tener el campo custom "Financiero" configurado. Qué piezas usar (Hitos/Historial de precio/Volumen/Condiciones de pago/Valor estimado) se elige por workspace en **Configuración → Proyectos → Financiero** (switches nuevos, `workspaces.financial_config`) — Moneda no tiene switch, es la base de todo lo demás
- **Historial de precio** (`PriceHistory.jsx`, nuevo, mismo patrón que `DealMilestones.jsx`): fecha + valor + cantidad (en la unidad elegida para el proyecto: kg/litro/unidad/servicio/proyecto completo) + motivo — separado de Hitos (que son el cronograma de cobro, no la evolución del precio negociado)
- **Bitácora** (tab nuevo): timeline cronológico de texto libre con fecha, se agrega directo ahí mismo mientras se trabaja — no se confunde con Actividad (que sigue siendo 100% automática) ni son post-its
- **Notas con página**: las notitas de colores (post-it) ahora se crean desde el modal de **Editar** eligiendo "Pegar en: Bitácora/Financiero/Tareas/Documentos" (`NegotiationNotesEditor.jsx`, nuevo) — en la Vista aparecen fijadas arriba del tab que corresponda, de solo lectura ahí (se pueden seguir editando/borrando con doble-click / ✕, como siempre). `NotesPostIts.jsx` gana `page` (filtra/asigna la página), `variant` (`'postit'` de siempre o `'timeline'`, usada por Bitácora) y `hideComposer` (oculta el input de alta en los tabs donde ya no se crean ahí)
- **Decisión de alcance**: a diferencia del mockup inicial, Hitos y el Historial de precio quedan editables solo en la Vista (en vivo, mismo criterio que Documentos/Tareas ya tenían) — no se duplicó su alta dentro del modal de Editar, evita redundancia y mantiene el patrón ya establecido en el resto de la app
- Sin cambios en custom fields (confirmado la sesión anterior): siguen siendo por `object_type`, no por tipo de entidad — no aplica acá
- Ícono nuevo en Actividad para `price_updated`

## 2026-08-10 (10)

## 2026-08-10 (10)

### Feature: tipo secundario en Entidades — una misma entidad puede tener dos roles (ej. Cliente y Proveedor)
- Motivado por un caso real: una empresa puede ser Cliente en un proyecto (le vendo APIs) y Proveedor en otro (le compro productos terminados) — hasta ahora el `entity_type_id` de una entidad era fijo desde que se creaba, así que estructuralmente no podía aparecer nunca en el rol contrario, en ningún proyecto
- **Requiere correr SQL a mano en Supabase** (pasado en el chat, `migration_secondary_entity_type.sql`): nueva columna `entities.secondary_entity_type_id` (FK opcional a `entity_types`) + backfill de `negotiation_entities.role` a partir del tipo que tenía cada entidad ya vinculada, para que ningún proyecto existente cambie de rol al desplegar
- `EntityModal.jsx`: nuevo selector "Tipo secundario (opcional)" junto al de Tipo — si se elige el mismo tipo que el primario, se limpia solo
- `Entities.jsx`: una entidad con tipo secundario aparece en las dos solapas (filtro server-side con `.or()`, y el recorte client-side del modo "Todas las entidades"); el badge/columna de tipo muestra ambos ("Cliente · Proveedor") cuando corresponde
- **Hallazgo importante en `Negotiations.jsx`**: `negotiation_entities.role` existía en el esquema pero nunca se escribía — el rol de cada vínculo se infería leyendo el `entity_type_id` propio de la entidad (funciona mientras cada entidad tenga un solo tipo, pero se vuelve ambiguo apenas puede tener dos). Se empieza a usar de verdad: al guardar un proyecto, cada entidad elegida en un selector de rol (Proveedor/Cliente/Distribuidor) graba ese rol explícito en `negotiation_entities.role` — así se sabe sin ambigüedad en qué rol quedó una entidad en un proyecto puntual, más allá de qué tipo(s) tenga. `getEntitiesOfType` y todos los filtros/dropdowns por tipo pasan a leer `role` primero (con fallback al tipo propio de la entidad solo para vínculos viejos sin backfillear)
- Los 3 selectores de rol del formulario de proyecto, y los filtros de columna/panel, ahora ofrecen una entidad si matchea el tipo primario **o** el secundario (`entityHasType`, nuevo `src/lib/entityTypes.js`)
- `ImportNegotiationsModal.jsx`: la columna "Proveedor" del import ahora también graba `role` explícito (antes quedaba `null`) — se resuelve buscando el `entity_type` configurado con nombre "Proveedor"
- Sin cambios en custom fields: confirmado que `custom_field_definitions` para entidades se define solo por `object_type`, no por `entity_type_id` — una entidad con dos tipos sigue usando un único formulario/set de valores, sin duplicar nada

## 2026-08-10 (9)

## 2026-08-10 (9)

### Fix: listas de Productos/Entidades ordenaban alfabético caracter a caracter ("Prod 1, Prod 10, Prod 11... Prod 2, Prod 20")
- Reportado por el usuario viendo el listado de Productos: `order('name')` de Supabase/Postgres ordena el texto tal cual, sin tratar los números como números — "10" queda antes que "2" porque el caracter "1" es menor que "2"
- Nuevo `naturalSortByName` en `tableSort.js` (Intl `localeCompare` con `numeric: true`, mismo criterio que ya usaba `customFields.js` para las opciones de filtro) — se aplica después de cada fetch de productos/entidades que alimenta una lista o un picker: `Products.jsx`, `Entities.jsx`, `Negotiations.jsx` (fetch principal, entra directo al picker "Buscar y agregar producto"), `ProductModal.jsx`, `Tasks.jsx`
- De paso, `sortRows` (el sort por click en encabezado de columna de Tabla, en Proyectos/Entidades) ahora también usa orden natural para columnas de texto — antes solo pasaba a estar bien ordenado por casualidad si los nombres no tenían números
- Sin SQL — cambio de código nada más

## 2026-08-10 (8)

### Fix: import de Productos descartaba filas con un "Tipo de producto" que no existía todavía
- `product_type` en `ImportProductsModal.jsx` era match exacto obligatorio contra los tipos ya configurados — si no coincidía con ninguno, la fila entera se marcaba como error y no se importaba, sin ninguna forma de que se creara la categoría. Reportado por el usuario probando un listado de proveedor con un tipo nuevo
- Mismo `matchEntity` de la sesión anterior, pero con la política default invertida respecto a Proveedor: si el texto de la celda no matchea ni de cerca ningún tipo existente, no es un error — es una categoría nueva de verdad, se crea sola al confirmar el import (agrupando por nombre normalizado, para no crear la misma categoría una vez por fila si varios productos comparten el tipo nuevo). Si hay algo parecido (typo de un tipo ya cargado), sí queda en el preview con selector: Crear categoría nueva / Usar: <existente> — default Crear, mismo criterio "avisar de más" que el resto
- `Products.jsx`: `onImported` del modal ahora también refresca `fetchProductTypes` (antes solo refrescaba productos — una categoría creada durante el import no aparecía en el filtro de tipo hasta recargar la página)
- Sin SQL — cambio de código nada más

## 2026-08-10 (7)

### Feature: detección de duplicados en los 3 imports (Entidades/Productos/Proyectos)
- `ImportEntitiesModal.jsx` (el que crea proveedores/clientes) no comparaba contra la base al importar — solo detectaba duplicados dentro del mismo archivo. Si se subía un CSV con una entidad ya cargada, se intentaba crear igual (el `insert` bulk ni siquiera revisaba el error). Productos y Proyectos sí resolvían la columna de proveedor contra entidades existentes, pero con match exacto binario (encontrado / "no encontrado"), sin tolerar variaciones de escritura ni typos
- Nuevo `src/lib/entityMatching.js`, compartido por los 3 modales — sin librerías externas ni pg_trgm (mismo criterio que la búsqueda global, que usa `ilike` liso por no justificarse el volumen):
  - `normalizeName`: saca tildes, puntuación (`"S.A."` → `sa`, no `"s a"`) y sufijos legales comunes (SA, SRL, Inc, Corp, Ltda, etc.) — dos nombres que normalizan igual matchean solos, sin pedir nada
  - `similarity`: combina Dice sobre palabras (agarra reordenamientos: "Acme Distribuidora" ~ "Distribuidora Acme") y Damerau-Levenshtein sobre el string normalizado (agarra typos: "Acem Corp" ~ "Acme Corp"), se queda con el score más generoso de los dos
  - Umbral deliberadamente flojo (0.45): los imports acá se usan poco y en tandas grandes (migración de sistemas viejos, listados de productos por proveedor) — preguntar de más sale más barato que dejar pasar un duplicado real
- **Entidades**: match exacto se resuelve solo (no crea, vincula el contacto de la fila si trae uno a la entidad existente). Match parecido (no exacto) queda en el preview con selector por fila: Crear nueva / Usar la existente / Omitir esta fila — default si no se toca: Crear nueva
- **Productos y Proyectos**: mismo criterio para resolver "Proveedor" contra entidades ya cargadas, pero sin opción de "crear nueva" (estos imports no crean entidades) — selector es Usar: <candidato> / Dejar sin vincular (default, igual que el comportamiento de hoy)
- Nueva clase visual `import-row-duplicate` / `import-status--duplicate` (celeste) en el preview, distinta de warning (ámbar) y error (rojo), para diferenciar "hay una decisión que tomar" de "hay un problema"
- Sin SQL — cambio de código nada más

## 2026-08-10 (6)

### Feature: Import/Export masivo de Productos
- Productos no tenía import ni export — a diferencia de Entidades (import Excel/CSV + export PDF) y Proyectos (import + export Excel/PDF). Se agrega en la página de Productos, mismo lugar que en las otras dos (decisión propia: como Productos ya es una sola página unificada sin pestañas por tipo, tiene más sentido ahí que repartido por entidad — bulk import en particular no encaja bien "por entidad" porque una sola planilla suele traer productos de varios proveedores a la vez)
- `ImportProductsModal.jsx` (nuevo, modelado sobre `ImportEntitiesModal.jsx`): a diferencia de Entidades (donde el tipo ya está implícito en la pestaña que se importa), acá "Tipo de producto" y "Proveedor/Vendedor" van como columnas de texto en cada fila, resueltas por nombre contra lo ya configurado en el workspace — mismo criterio que país/select. Fila sin tipo reconocido o sin nombre, error de import (no se inserta)
- Export a Excel (.xlsx): respeta la selección actual si hay filas tildadas, si no exporta lo que esté filtrado en ese momento — mismo criterio que ya tenía el export de Proyectos (`exportRows`)
- Sin SQL — cambio de código nada más

## 2026-08-10 (5)

### Fix: filtros mostraban catálogos enteros (ej. los ~195 países del mundo) en vez de los valores realmente cargados
- Bug reportado por el usuario probando el filtro de País en Entidades: el checklist ofrecía todos los países del mundo aunque el workspace solo tuviera entidades de 5. `filterChoicesFor` (país/usuario/estado/tipo de producto/select/multiselect) devolvía siempre el catálogo de referencia completo — ahora se recorta a los valores que realmente aparecen en las filas relevantes, para cualquier tipo de campo, no solo los de texto libre (que ya tenían este criterio desde una ronda anterior)
- Agregado además el filtrado **facetado** (estilo Excel): el checklist de cada filtro ahora se arma contra las filas que matchean *todos los demás* filtros activos (búsqueda, otros campos, tipo de entidad en Proyectos, "Actividad") — si hay entidades de 15 países pero la selección actual (por otro filtro) sólo tiene 3 activos, el filtro de País ofrece esos 3, no los 15. Aplica en las 3 páginas, tanto en el encabezado de columna de Tabla como en el botón "Filtros" de Mosaico/Kanban
- La fila de tarjetas superior (Estado en Proyectos, Tipo de producto en Productos, el campo elegido como tarjetas en Entidades) queda **sin facetar** a propósito — sigue mostrando el panorama completo de la solapa actual, mismo criterio que ya tenía antes; solo se le aplica el recorte a "valores realmente cargados" (nunca cero tarjetas de países sin ninguna entidad)
- Refactor de paso: `filtered` en las 3 páginas ahora se arma con una función `matchesAllXFilters(row, { excludeDefKey })` reusable tanto para el resultado final como para calcular las filas de cada faceta — nuevo helper `matchesAllFieldFilters` en `customFields.js`
- Sin SQL — cambio de código nada más

## 2026-08-10 (4)

### Feature: tarjeta de Total + porcentaje en Proyectos/Entidades/Productos
- Nueva tarjeta "Total" siempre primera en la fila de tarjetas de las 3 páginas (y en cada página por tipo de entidad, que reusa el mismo componente `Entities`): muestra el total sin filtrar (en Entidades, si hay una solapa de tipo activa, el total es de ese tipo — ya viene recortado en `typeScopedEntities`)
- Si hay algún filtro activo (búsqueda, checklist de columna, tarjetas de tipo/estado/país...) la tarjeta agrega una segunda línea de subtotal, nombrando qué está filtrado cuando se puede armar una etiqueta legible — ej. "5 entidades: Argentina". Nuevo helper `describeFieldFilters` en `customFields.js` arma esas etiquetas reusando `filterChoicesFor`; en Proyectos también se nombra el filtro de "Actividad" cuando no está en el modo por defecto
- `TotalStatCard` (nuevo, compartido — `src/components/StatCards.jsx`) — antes esta fila de tarjetas en Entidades ni existía si el workspace no tenía un campo configurado como "tarjetas de filtro"; ahora la tarjeta de Total sale siempre, las de abajo (tipo/estado/país) siguen siendo opcionales
- Todas las tarjetas con barra de progreso (Estado en Proyectos, tarjetas de filtro en Entidades, Tipo de producto en Productos) ahora muestran también el porcentaje junto al conteo
- Sin SQL — cambio de código nada más

## 2026-08-10 (3)

### Fix: 4 ajustes reportados probando Tabla/Mosaico — Contactos, orden preset, espaciado, filtros incompletos
- **Contactos ya no aparece en Tabla/Mosaico, ni siquiera como conteo**: `ENTITY_STATIC_COLUMNS` tenía una columna "Contactos" (`contacts_count`, visible por defecto) mostrando cuántos contactos tiene la entidad — el dato en sí solo se ve en el modal, así que se saca por completo (columna, opción del selector, orden, sort)
- **Orden preset de columnas ahora sigue el orden de Configuración → Campos**: antes, la primera vez que se abría Tabla/Mosaico (sin preferencia guardada), los campos custom aparecían en orden de creación (`sort_order` crudo de la base) en vez del orden ya reordenado a mano en Configuración. Ahora usa `computeFieldOrder` (mismo helper que ya ordenaba los campos dentro del modal de detalle/alta) para el orden inicial — una vez que cada usuario reordena a su gusto desde "⚙ Columnas", esa preferencia manda como siempre
- **Bandera pegada al nombre en la columna "Nombre" de Entidades**: la celda no tenía ningún espaciado propio (heredaba el `<td>` genérico sin `display:flex`) — se agrega `.entities-td-name { display:flex; align-items:center; gap:8px }`
- **Filtros de columna incompletos**: solo los campos con una lista de opciones predefinida (select/multiselect/país/usuario/casilla/estado/tipo de producto) tenían filtro tipo Excel en el encabezado — texto libre, texto largo, número, fecha, link, email y teléfono se quedaban afuera. Se extiende el mismo checklist a esos tipos, armando las opciones a partir de los valores realmente cargados en las filas (`uniqueValueChoices`, mismo criterio que un filtro de columna de Excel — con buscador para no perderse entre muchos valores). El campo elegido como "tarjetas de filtro" en Configuración sigue restringido al set chico de tipos enumerables (`isCardFilterable`, nueva), separado de `isFieldFilterable` (ahora más amplio) — una fila de tarjetas no tiene sentido con decenas de valores de texto libre
- Sin SQL — cambio de código nada más

## 2026-08-10 (2)

### Refactor: Configuración reorganizada por módulo (Proyectos / Entidades / Productos)
- Pedido explícito del usuario, con propuesta de estructura propia: hoy "Estados", "Tipos de entidad", "Tipos de producto" y "Campos personalizados" vivían como pestañas separadas (esta última con un selector interno Proyectos/Entidades/Productos) — para terminar de configurar un solo tipo de dato (ej. Entidades) había que saltar entre 2 pestañas distintas
- Nueva estructura: 3 pestañas padre (Proyectos / Entidades / Productos), cada una con sub-secciones propias reusando el mismo widget de pastillas que ya tenían los selectores viejos: **Proyectos** → Estados + Campos; **Entidades** → Tipos de entidad + Campos; **Productos** → Tipos de producto + Campos
- `TabCamposPersonalizados` deja de tener su propio selector de objeto — ahora recibe `objectType` como prop fija desde el módulo padre. `TabEstados` deja de tener el suyo (Proyectos/Entidades/Tareas) — se detectó en el camino que las opciones "Entidades" y "Tareas" no estaban conectadas a ningún lugar real de la app (el estado de una tarea es fijo en código, y las entidades no tienen un campo de estado propio con ese sentido), así que Estados queda directamente exclusivo de Proyectos, sin selector — simplificación real, no solo cosmética
- Contactos (el sub-formulario repetible de Entidades) queda exactamente como estaba, sin sub-sección propia — no hay hoy nada más configurable ahí más allá del label, que ya vive dentro de "Campos"
- Sin SQL — cambio de código nada más

## 2026-08-10

### Feature: badges de estado en la columna "Proyectos totales" de Tabla (Entidades/Productos)
- Repensado explícito pedido por el usuario: la columna mostraba solo un número (`negotiation_entities?.length`). Se reemplaza por el mismo desglose por estado que ya mostraba el pie de las tarjetas en Mosaico (`Object.entries(getStateCounts(...))` + `getStateConfig(status)` → `.entity-state-badges`/`.entity-state-badge`), confirmado con el usuario vía pregunta explícita entre esa opción y una versión más compacta de punto+contador
- `getStateCounts` pasa de función local (duplicada en `Entities()`/`Products()`, usada solo por Mosaico) a helper de módulo (`renderProjectsTotalCell`), ahora compartido entre Tabla y Mosaico dentro de cada archivo — sin cambiar el comportamiento de Mosaico, que sigue llamando a la misma función

## 2026-08-07 (11)

### Fix: Tabla como vista por defecto, tipo de entidad visible en Mosaico/Kanban, Contactos nunca en columnas
- Entidades/Productos abrían en Mosaico por defecto; Proyectos ya abría en Tabla (en desktop). Se unifica: las tres arrancan en Tabla en escritorio, Mosaico solo en pantallas angostas (mismo criterio que ya tenía Proyectos)
- Bug real corregido en Entidades: "Contactos" (el sub-formulario repetible) podía colarse como columna en Tabla/Mosaico si una preferencia de columnas guardada en el navegador venía de antes de la exclusión que ya existía para `allColumns`/Configuración — esa exclusión no alcanzaba al armar `visibleCols` dentro de la grilla. Ahora hay un filtro defensivo adicional (`safeCols`) que saca ese campo específico de cualquier lugar donde se lean las columnas a mostrar, sin importar qué haya quedado guardado
- Proyectos: cuando un proyecto tiene más de una entidad vinculada (de distinto tipo — ej. Cliente y Proveedor), Mosaico y Kanban mostraban los nombres sin indicar cuál era cuál (la Tabla sí, con una columna por tipo). Ahora cada entidad vinculada muestra el nombre de su tipo como prefijo ("Cliente: Acme S.A.")

## 2026-08-07 (10)

### Refactor: Tabla y Mosaico unificados entre Proyectos/Entidades/Productos
- Las tres páginas tenían su propia implementación de Tabla y de Mosaico, con diferencias reales (Proyectos: columnas redimensionables + filtro en el encabezado, pero tarjetas simples sin avatar; Entidades/Productos: tarjetas con avatar circular y pie con badges, pero tabla sin esas mejoras). Se unifica tomando lo más avanzado de cada una como base única, extendida a las tres
- `TableGrid.jsx` (nuevo, compartido): encabezado con click-para-ordenar, ancho ajustable a mano y filtro tipo Excel por columna — antes vivía triplicado (`TableView`/`EntitiesGridTable`/`ProductsGridTable`, casi idénticos), ahora una sola implementación; cada página solo define `renderCell` (contenido de celda) y `getColumnFilter` (qué campo es filtrable y con qué opciones)
- `CardGrid.jsx` (nuevo, compartido): tile con avatar (iniciales + color por nombre), título truncado + insignia opcional, subtítulo, badge a la derecha (ej. estado) y pie para chips/detalle
- **Bug de superposición corregido** (motivo real del pedido, no solo estético): en Entidades/Productos el checkbox de selección era `position: absolute` flotando en la esquina superior derecha de la tarjeta — con texto largo o el chip de tipo nuevo, se superponía. Ahora el checkbox es un hijo más del layout flex (como ya lo tenía resuelto Proyectos con su franja lateral), nunca flota encima de nada
- `src/lib/avatarColors.js` (nuevo): `getInitials`/`getAvatarColor`, antes duplicados de forma idéntica en Entidades y Productos
- Kanban queda exclusivo de Proyectos, sin tocar — decisión explícita, Entidades/Productos no tienen un campo de tipo "estado/pipeline" con el mismo sentido
- Limpieza: ~170 líneas netas menos pese a sumar 3 archivos compartidos nuevos — se borraron las 3 implementaciones de tabla, las clases CSS `.neg-card*`/`.entity-card*` que quedaron sin uso, y los `AVATAR_COLORS`/`getInitials`/`getAvatarColor` duplicados

## 2026-08-07 (9)

### Feature: botón "Filtros" — acceso a todos los filtros también en Mosaico y Kanban
- Hueco real detectado junto con el usuario: al sacar los filtros del toolbar de Proyectos en una ronda anterior (confiando en que el encabezado de la Tabla los reemplazaba), se perdió el acceso a filtrar por Cliente/Proveedor/Participantes/etc. en las vistas Mosaico y Kanban — el encabezado de columna solo existe en Tabla
- `FiltersPanelButton.jsx` (nuevo, compartido): un solo botón "Filtros" que abre un panel con un `ColumnFilterMenu` (buscador + checklist) por cada campo filtrable — mismo componente que ya usa el encabezado de columna, mismo estado, expuesto por un segundo camino. Visible en las tres vistas de Proyectos/Entidades/Productos, no solo Tabla
- Los campos que ya tienen su propia fila de tarjetas siempre visible (Estado en Proyectos, Tipo de producto en Productos, el campo elegido como tarjetas en Entidades) quedan afuera del panel — ya tienen acceso en cualquier vista por otro lado, no hace falta duplicarlo
- Entidades y Productos: sus filtros de toolbar (antes un `<select>` de una sola opción por campo, siempre visibles en fila) pasan a vivir también dentro de este único botón, mismo criterio que Proyectos — consistencia entre las tres páginas
- Buscador: confirmado con el usuario, queda con alcance acotado por página (nombre, o nombre + producto vinculado en Proyectos como ya estaba) — la búsqueda libre por cualquier campo es responsabilidad del buscador global del header, no de estos buscadores por página
- Limpieza de paso (confirmada con el usuario): se saca el toggle "Mostrar como filtro" de Configuración — quedó del todo obsoleto ahora que la elegibilidad para filtrar la decide el `field_type` (`isFieldFilterable`) y el acceso real es el encabezado de columna + este botón nuevo. También se elimina `CustomFieldFilter` (el `<select>` que quedó sin ningún consumidor)

## 2026-08-07 (8)

### Fix: editar una entidad con contactos "viejos" rompía el guardado (y borraba los contactos)
- Bug real reportado por el usuario probando las tarjetas de tipo de empresa: al editar una entidad existente y guardar, el modal se quedaba colgado en "Guardando..." para siempre. La consola mostraba `TypeError: Cannot read properties of null (reading 'trim')`
- Causa: `EntityModal.handleSubmit` llamaba `.trim()` directo sobre `cargo`/`email`/`teléfono`/`whatsapp`/`notas` de cada contacto al reconstruir la lista para guardar. Los contactos nuevos (via `emptyContact()`) siempre arrancan en `''`, pero los contactos ya guardados en la base pueden tener esos campos opcionales en `null` — típico en contactos cargados hace tiempo sin completar todo. `null.trim()` tira una excepción, y como no había ningún `try/catch`, la función cortaba a mitad de camino sin llegar nunca al `setLoading(false)` — de ahí el botón colgado
- **Más grave que un botón colgado**: en el flujo de edición, el `delete` de los contactos viejos ya había corrido *antes* de este punto, así que la excepción cortaba antes del `insert` de los nuevos — el resultado real era que los contactos de esa entidad quedaban borrados sin reemplazo. Si alguien pegó contra este bug editando una entidad con contactos, conviene revisar si esos contactos siguen ahí
- Fix: los 5 campos ahora se normalizan con `(campo || '').trim()` antes de guardar (mismo criterio en alta y edición), y todo `handleSubmit` queda envuelto en `try/catch` — cualquier error futuro similar va a mostrar un mensaje en pantalla en vez de dejar el botón colgado en silencio

## 2026-08-07 (7)

### Feature: "Todas las entidades" — vista unificada opcional, sin tocar las páginas por tipo
- A diferencia de Productos, Entidades **no** cambia su arquitectura existente: cada tipo sigue teniendo su propia página y su propio ítem en el sidebar, sin tocar nada. Se suma un nuevo ítem "Todas las entidades" (arriba del divisor de tipos, mismo criterio de visibilidad) que lleva a `/entities` — una vista adicional, no un reemplazo
- `Entities.jsx` pasa a soportar `entityTypeId` opcional: sin él, fetchea todas las entidades del workspace y muestra solapas por tipo (client-side, sin recargar del servidor al cambiar de solapa) más una solapa "Todas". Import de Excel/CSV se oculta en este modo (es inherentemente por tipo, no se extendió)
- Vista mínima de la tarjeta de entidad en modo unificado: ahora muestra el tipo de entidad como chip junto al nombre (antes no aparecía ahí, solo en la columna de la Tabla) — mismo criterio que se sumó para Productos la ronda anterior
- **Tarjetas de filtro configurables** (a pedido explícito): `custom_field_definitions` suma la columna `card_filter` — el owner elige desde Configuración qué campo de Entidades (ej. "Tipo de empresa") se muestra como tarjetas clicables arriba, en vez de fijarlo por `field_type` como Estado en Proyectos o Tipo de producto en Productos. Solo un campo por sección puede tenerlo activo (al marcar uno se desactiva en cualquier otro). Estas tarjetas aparecen tanto en la vista unificada como en cada página por tipo — a diferencia de las solapas, que son exclusivas de la vista unificada
- Sin tocar (dead code pre-existente, no de esta ronda): el toggle "Mostrar como filtro" en Configuración ya existía pero no tenía efecto real en ninguna página — la elegibilidad de un campo para filtrar sigue determinándose 100% por `field_type` (`isFieldFilterable`), nunca por ese flag. Se dejó como está para no arriesgar romper filtros que hoy funcionan; documentado en Pendientes

## 2026-08-07 (6)

### Feature: Productos pasa a ser una sola página unificada, con tarjetas de filtro por tipo
- Reemplaza el patrón "una página por tipo, un ítem por tipo en el sidebar" (que Productos copiaba de Entidades) por una sola página `/products` con todos los productos del workspace juntos — decisión explícita del usuario: quiere ver todo unificado, con la opción de acotar por tipo cuando haga falta, sin duplicar la arquitectura de navegación para eso
- `product_type` se suma a `FILTERABLE_TYPES` (antes solo lo resolvían "a mano" las columnas de tabla/orden) — con eso, el tipo de producto entra al mismo mecanismo genérico de filtrado que ya usan Estado/select/etc., incluido el filtro por columna en el encabezado de la Tabla
- Tarjetas de filtro por tipo arriba de la página (mismas clases `.neg-stats`/`.neg-stat-card` que las tarjetas de Estado en Proyectos) — clic para acotar a uno o varios tipos a la vez, clic de nuevo para sacarlo. Se excluye el tipo de la fila de filtros del toolbar para no duplicar el mismo control dos veces
- Vista mosaico: la tarjeta mínima de un producto ahora siempre muestra su tipo (chip junto al nombre) y su entidad vendedora — antes esta última solo aparecía si estaba cargada, ahora dice explícitamente "Sin entidad vendedora" cuando falta, para que sea visible que un producto sin proveedor asignado es un dato incompleto, no un campo vacío que pasa desapercibido
- Sidebar: la sección de Productos pasa de un ítem por tipo a un único ítem "Productos" (mismo criterio de visibilidad: solo aparece si el workspace tiene al menos un tipo de producto configurado)
- `App.jsx`: ruta `/products/:id` (con el componente `ProductRoute` que resolvía el tipo) reemplazada por `/products` simple — `ProductModal` ya era agnóstico al tipo (siempre permitió elegir el tipo desde un desplegable propio), no necesitó cambios
- Preferencias de columna de Productos (`nerva_product_col_prefs_<user>_<tipo>` → `nerva_product_col_prefs_<user>`): al ya no haber una página por tipo, cada usuario tiene una sola configuración de columnas para todo Productos en vez de una por tipo — las prefs viejas quedan huérfanas en `localStorage` sin causar error, simplemente no se usan más
- Sin SQL nuevo — no hace falta correr nada en Supabase para esta ronda

## 2026-08-07 (5)

### Fix: consistencia visual entre páginas + iconos de biblioteca en vez de SVG a mano
- **Toolbar de Entidades/Productos alineada como la de Proyectos**: `.entities-toolbar` estaba con `justify-content: flex-end` (todo pegado a la derecha) y `align-items: center`, mientras que `.neg-toolbar` de Proyectos es flujo natural a la izquierda con `align-items: flex-end` — por eso "las cosas se ubicaban en otro lado". Ahora coinciden. El buscador de Entidades/Productos también pasa a tener el mismo wrapper con label "Buscar" que ya tenía el resto de los filtros (antes era el único campo del toolbar sin etiqueta)
- **Vista tabla/mosaico unificada**: Entidades y Productos tenían su propio SVG dibujado a mano para el selector de vista (`.entities-view-toggle`), distinto del que usa Proyectos (glifos de texto ☰⊞▦ en `.neg-view-toggle`). Ahora las tres páginas comparten las mismas clases y los mismos íconos de `lucide-react` (`Table2`/`LayoutGrid`/`Kanban`, este último solo en Proyectos)
- **Botón de filtro de columna, más grande**: la flechita `▾` del encabezado (tipo Excel) pasa de un texto de 11px casi invisible a un botón real de 24×24px con ícono `ListFilter` de lucide, fondo visible y estado activo en azul
- **Iconos de la sidebar y el buscador global, de la biblioteca en vez de SVG a mano**: `Layout.jsx` tenía la mayoría de sus íconos (Dashboard, Agenda/Tareas, Proyectos, Configuración, toggle de menú móvil, flechitas de colapsar sidebar, chevron del selector de workspace, ícono de tipo de entidad/producto sin ícono propio) dibujados a mano en SVG, mientras que "Mi perfil" y los íconos elegidos por el usuario en Configuración ya usaban `lucide-react` (que ya estaba instalado). Se unifica todo a `lucide-react`. Mismo criterio en el buscador global (lupa) y en el selector barras/donut del gráfico de estados en el Dashboard
- Sin tocar (fuera de alcance, no eran íconos de sección sino visualizaciones reales): los SVG de los gráficos donut del Dashboard

## 2026-08-07 (4)

### Feature: filtro tipo Excel en Entidades y Productos + columnas de ancho fijo y ajustable
- `ColumnFilterMenu` (buscador + checklist multi-valor, construido en la ronda anterior solo para Proyectos) ahora se usa también en el encabezado de la Tabla de Entidades y de Productos — mismo componente compartido, mismo criterio
- **Columnas de ancho fijo, ajustable a mano**: la Tabla (Proyectos/Entidades/Productos) recalculaba el ancho de cada columna según el contenido visible, así que al cambiar de filtro la pantalla "saltaba". Ahora `table-layout: fixed` + un ancho explícito por columna (arrastrando el borde derecho del encabezado, como en Excel) — una vez que el usuario mueve una columna, ese ancho queda fijo pase lo que pase con los datos filtrados, hasta que la vuelva a mover. `ColumnHeaderCell.jsx` (compartido) suma el handle de resize; el ancho se guarda en las mismas prefs de columnas por usuario que ya existían (visibilidad/orden), no es una tabla ni columna nueva en Supabase
- Confirmado (no requirió cambios): las preferencias de columnas (visibilidad, orden y ahora ancho) y los filtros activos ya eran 100% por usuario/por navegador — las columnas viven en `localStorage` con clave `nerva_col_prefs_<user_id>` (nunca en Supabase, nunca compartidas entre miembros del workspace) y los filtros (`customFilterValues`, `entityTypeFilters`, búsqueda, orden) son estado de React en memoria, se pierden al recargar y nunca se comparten entre usuarios ni pestañas — el workspace solo comparte los datos, nunca cómo cada quien los mira

## 2026-08-07 (3)

### Feature: filtro de columna estilo Excel — buscador + checklist multi-valor
- `src/components/ColumnFilterMenu.jsx` (nuevo): reemplaza al `<select>` de una sola opción del filtro de encabezado por un buscador + lista de checkboxes (con "Todos"/"Ninguno"/"Limpiar") — se puede tildar varios valores a la vez, como el autofiltro de Excel. Aplica tanto a los campos custom filtrables (Estado, Participantes, etc.) como a las columnas por tipo de entidad
- `matchesFieldFilter` (customFields.js) generalizado para aceptar tanto un valor único (compatibilidad con lo que ya escribía la tarjeta de stats de Estado) como un array (el nuevo checklist) — mismo semántica "alguno de los elegidos" en ambos casos
- Fix de paso: al hacer click en una tarjeta de stats de Estado ahora hace toggle correctamente sobre el array de estados filtrados en vez de pisarlo con un solo valor, así conviven sin perder selección con el filtro nuevo del encabezado

## 2026-08-07 (2)

### Fix: toolbar de Proyectos con demasiados filtros duplicados + buscador que no encontraba por producto vinculado
- La toolbar tenía un filtro por cada tipo de entidad (Cliente, Proveedor, Distribuidor...) más uno por cada campo custom filtrable (Estado, Participantes, etc.), duplicando exactamente lo que ya ofrecía el filtro `▾` en el propio encabezado de cada columna (mismo estado, dos UIs). Se sacaron todos esos filtros de la toolbar — quedan solo Buscar y Actividad — y el filtrado por columna pasa a vivir 100% en el encabezado, estilo Excel
- El buscador ("Proyecto o producto...") solo miraba el nombre del proyecto — nunca el producto vinculado desde el módulo de Productos/Servicios, aunque el placeholder ya lo prometía. Ahora también matchea contra el producto principal vinculado (`negotiation_products`), para cubrir el caso real: a veces el nombre del proyecto no repite el nombre del producto

## 2026-08-07 (1)

### Feature: Proyectos — una columna por tipo de entidad (reemplaza "Entidades vinculadas" genérico)
- Rediseño pedido tras la primera prueba real de Productos: en vez de un campo único con entidad principal + secundarias de rol libre, ahora se vincula **una entidad por cada tipo configurado** (ej. Cliente, Proveedor, Distribuidor), y la Tabla muestra una columna por tipo — sin tablas ni columnas nuevas en la base, `negotiation_entities`/`entities.entity_type_id` ya alcanzaban; el cambio es de agrupamiento/render, no de esquema
- Confirmado con el usuario: máximo una entidad por tipo (no lista), y el viejo filtro único de toolbar se reemplaza por un filtro por tipo de entidad
- `NegotiationModal`: `entity_ids` (array) → `entity_by_type` (objeto por tipo), un `<select>` por tipo configurado. `primary_entity_id` sale del primer tipo con entidad asignada (orden de `sort_order`)
- Tabla/Tarjetas/Kanban/export a Excel/detalle de Proyectos: columnas virtuales `entity_type:<id>` reemplazan a la columna única `entities`, con el mismo sistema de columnas configurables + filtro en el encabezado que ya tenían Proyectos/Entidades
- Fuera de alcance, no tocado: el import masivo de Proyectos sigue con su columna única "Proveedor" (limitación conocida, no pedida en esta ronda)

## 2026-08-02 (5)

### Feature: módulo de Productos/Servicios — tercer polo conectado a Entidades por vínculo
- Repensado de arquitectura antes de construir: sigue el patrón ya decidido en la sesión de repensada estratégica ("todos los módulos se conectan a `entities` vía tabla de vínculo, ningún módulo posee la entidad") — Productos es el primer caso real de ese patrón, no se metió adentro de `entities`
- 3 tablas nuevas (`product_types`, `products`, `negotiation_products`) + `negotiations.primary_product_id`, mismo esqueleto que Entidades/Proyectos. Un producto pertenece a una sola entidad (su proveedor); un proyecto puede vincular varios productos
- `custom_field_definitions` suma `object_type='product'` y 3 `field_type` especiales (`product_type`, `product_entity`, `products_link`), mismo criterio que los 5 ya existentes (solo sembrables por SQL)
- `Products.jsx` (nuevo): página con Tarjetas + Tabla configurable, mismo sistema de columnas/orden/filtro que Proyectos y Entidades. `ProductModal.jsx` (nuevo): alta/edición
- Sidebar suma sección de tipos de producto; Configuración suma pestaña "Tipos de producto" y "Productos" al toggle de Campos personalizados
- `NegotiationModal`/`NegotiationDetail`/tabla/tarjetas/export de Proyectos: dispatch completo para `products_link`. Entidades suma pestaña "Productos" en el detalle
- Preset base mínimo a pedido explícito: solo Nombre + Descripción sembrados, sin tipos de producto pre-cargados (el owner arma los suyos)
- Explícitamente fuera de alcance esta ronda: import/export de Productos, notas/tareas/documentos/timeline y Estados en un producto
- **Pendiente crítico sin resolver**: las tablas nuevas necesitan RLS con las mismas policies que ya protegen `entities`/`entity_types`/`negotiation_entities` — esta sesión no tiene visibilidad de esas policies, hay que copiarlas a mano desde el Dashboard de Supabase

## 2026-08-02 (4)

### Feature: encabezado de tabla tipo Excel — ordenar y filtrar por columna
- `src/lib/tableSort.js` (nuevo): `sortRows`/`nextSortDir`/`customFieldSortValue` compartidos entre Proyectos y Entidades — nulls/vacíos siempre al final sin importar la dirección, number/date ordenan por su valor real, el resto por el string ya mostrado (case-insensitive)
- `src/components/ColumnHeaderCell.jsx` (nuevo): `<th>` con label clickeable para ordenar (ciclo asc → desc → sin ordenar, con flechita) y un botón `▾` que abre un popover con el mismo `CustomFieldFilter` que ya usaba la toolbar — escriben al mismo estado de filtros, conviven sin duplicar el mecanismo
- `getNegSortValue`/`getEntitySortValue` (uno por página) resuelven el valor comparable por columna, mismo criterio que `getExportValue`/`renderCell`: casos especiales primero (producto, entidad principal, estado, etc.), default a `customFieldSortValue` para cualquier campo custom
- Selector de orden simple en la vista Tarjetas de ambas páginas, compartiendo el mismo estado que la Tabla — cambiar de vista no pierde el orden elegido

## 2026-08-02 (3)

### Feature: tabla configurable para Entidades (primer incremento del encabezado tipo Excel)
- `src/components/ColumnEditor.jsx` (nuevo): `useColumnPrefs`/`ColumnEditor` que antes vivían solo dentro de `Negotiations.jsx`, ahora compartidos y parametrizados (`storageKey`/`staticColumns`/`defaultVisible` en vez de constantes de módulo) — `Negotiations.jsx` pasa a consumirlos sin cambiar de comportamiento
- Vista Tabla de Entidades reemplazada: `EntitiesGridTable` (columnas 100% desde `entityFieldDefs`, con la misma prioridad de label que Proyectos, más 2 columnas calculadas — Contactos y Proyectos totales) sustituye a la vieja `EntitiesTable` de filas fijas con conteo por estado. Nuevo botón "⚙ Columnas" en la toolbar, mismo patrón que Proyectos. Selección múltiple suma "seleccionar todos los visibles" (no existía antes en Entidades)
- Decidido con el usuario, pendiente de construir: click-para-ordenar por columna (ambas tablas) y filtro por columna en el encabezado (convive con los filtros de toolbar existentes, no los reemplaza), más un selector de orden simple en la vista Tarjetas de ambas páginas

## 2026-08-02 (2)

### Feature: invitar cliente nuevo (solo Staff) + fix del bug real detrás de "invitación no funcionaba"
- **Bug real, más profundo de lo que parecía**: investigando por qué la invitación por email nunca dejó al cliente con acceso, se encontró que `invite-user` (para un invitado nuevo, nunca antes registrado) creaba el usuario de auth y el link, pero **nunca insertaba la fila en `workspace_members`** — ni la función ni `SetPassword.jsx` (que solo cambia la contraseña, no lee `invited_workspace_id`/`invited_role` de los metadatos). El redirect a `/set-password` siempre estuvo bien configurado; el problema real era que ni con el link nunca terminaba con acceso al workspace
- Fix: se extrajo la lógica de "sumar a alguien a un workspace" (generar link o sumar directo si ya tiene cuenta) a un helper compartido `addOrInviteUser()`, que ahora inserta `workspace_members` inmediatamente con el id que `generateLink` ya devuelve — sin depender de ningún paso posterior que en los hechos no existía
- Nueva acción `invite_client` en el mismo Edge Function: crea un workspace de equipo nuevo (`onboarded: false`) y suma al email dado como `owner`, reusando `addOrInviteUser()` — gateado a `profiles.is_staff` (no a ownership de ningún workspace, porque todavía no existe ninguno). Reemplaza el flujo manual por SQL que se venía usando para dar de alta clientes
- `Profile.jsx` suma un bloque "Panel de Staff — Dar de alta un cliente nuevo" (nombre del workspace + email), visible solo si `isStaff`

### Fixes: feedback del primer cliente real
- **Bug real**: el picker de columnas de Proyectos (`ALL_COLUMNS` en `Negotiations.jsx`) tenía 6 keys hardcodeados que duplicaban campos ya definidos en `custom_field_definitions` (`product`/`entities`/`status`/`description`/`companies`/`participants`), con labels viejos que tapaban al label real configurado en Settings — se veía tanto en el picker como en los encabezados de la tabla y del export a Excel. Se sacaron esos 6 keys de la lista estática (solo quedan los que genuinamente no son un campo: fecha, notas, aclaraciones, actividad, última actividad), se invirtió la prioridad de resolución de label a favor de `custom_field_definitions`, y se corrigió el default de "visible" para columnas nuevas (antes arrancaban ocultas, dejando la tabla vacía en un workspace recién creado)
- **Bug real**: el primer login de un usuario nuevo caía siempre en su workspace personal (autogenerado al firmar) en vez del workspace de equipo al que fue invitado, porque `AuthContext` no priorizaba nada entre ambos al elegir el activo por defecto — se agregó esa prioridad (después de lo guardado en localStorage y del workspace de testing, que sigue siendo prioridad para uso interno)
- Confirmado sin necesidad de cambios: Estados de Proyectos ya funciona como se pidió — campo obligatorio/estructural, pero sus opciones (`custom_states`) 100% configurables por owner
- Documentado (sin implementar todavía, a la espera de decisión/alcance): un mini-tutorial guiado para el primer ingreso, y encabezados de tabla tipo Excel con filtro+orden por columna en Proyectos/Entidades (para Entidades hace falta primero construir un sistema de columnas configurables, que hoy no existe)

## 2026-08-02 (1)

### Fixes: feedback del primer cliente real
- **Bug real**: el picker de columnas de Proyectos (`ALL_COLUMNS` en `Negotiations.jsx`) tenía 6 keys hardcodeados que duplicaban campos ya definidos en `custom_field_definitions` (`product`/`entities`/`status`/`description`/`companies`/`participants`), con labels viejos que tapaban al label real configurado en Settings — se veía tanto en el picker como en los encabezados de la tabla y del export a Excel. Se sacaron esos 6 keys de la lista estática (solo quedan los que genuinamente no son un campo: fecha, notas, aclaraciones, actividad, última actividad), se invirtió la prioridad de resolución de label a favor de `custom_field_definitions`, y se corrigió el default de "visible" para columnas nuevas (antes arrancaban ocultas, dejando la tabla vacía en un workspace recién creado)
- **Bug real**: el primer login de un usuario nuevo caía siempre en su workspace personal (autogenerado al firmar) en vez del workspace de equipo al que fue invitado, porque `AuthContext` no priorizaba nada entre ambos al elegir el activo por defecto — se agregó esa prioridad (después de lo guardado en localStorage y del workspace de testing, que sigue siendo prioridad para uso interno)
- Documentado (sin implementar todavía, a la espera de decisión/alcance): la invitación por email no manda mail automático hoy (depende de que el owner copie/pegue el link a mano — falta configurar SMTP propio), un mini-tutorial guiado para el primer ingreso, y encabezados de tabla tipo Excel con filtro+orden por columna en Proyectos/Entidades (para Entidades hace falta primero construir un sistema de columnas configurables, que hoy no existe)

## 2026-08-01 (1)

### Feature: pantalla de bienvenida para workspaces nuevos sin configurar
- Problema: el bootstrap manual de un workspace de equipo (SQL que corre Gervasio para dar de alta a un cliente nuevo) deja el workspace con 0 `entity_types`/`custom_states`/`custom_field_definitions` — el owner entraba a una app completamente en blanco y tenía que armar todo a mano desde Configuración antes de poder cargar el primer dato
- Nueva columna `workspaces.onboarded boolean not null default true` — default `true` para no afectar retroactivamente a ningún workspace ya en uso; los workspaces nuevos se crean explícitamente con `onboarded = false`
- `WelcomeSetup.jsx` (nueva pantalla): se muestra en vez del contenido normal cuando el workspace activo es de equipo (`type != 'personal'`), `onboarded = false` y el usuario logueado es `owner` de ese workspace — otros miembros invitados a un workspace ya configurado nunca la ven, porque para cuando se los invita `onboarded` ya es `true`. Ofrece dos caminos:
  - **Configuración recomendada**: siembra el dominio típico de licensing farmacéutico — 3 tipos de entidad (Proveedor/Cliente/Distribuidor), pipeline de 5 estados y los 14 campos (5 estructurales + 9 regulares) que ya usa el resto de la app, todo editable después desde Configuración
  - **Armarlo yo mismo**: siembra solo los 5 campos estructurales indispensables (Nombre, Tipo, Contactos, Nombre del proyecto, Estado) + 2 estados básicos, sin tipos de entidad ni campos sugeridos — el resto lo elige el owner
  - Cualquiera de las dos opciones marca `onboarded = true` al terminar y no vuelve a aparecer
- `src/lib/seedWorkspaceDefaults.js` (nuevo): la lógica de siembra en JS, mismo shape de datos que ya se usa en Settings (via inserts a `entity_types`/`custom_states`/`custom_field_definitions`, respetando RLS del owner)
- `AuthContext.jsx` suma `onboarded` al select de `workspace:workspace_id(...)`; `Layout.jsx` calcula el gate y renderiza `WelcomeSetup` en vez del sidebar+contenido cuando corresponde

## 2026-07-31 (11)

### Feature: filtros configurables desde Settings, reemplazan a los hardcodeados
- Nueva columna `custom_field_definitions.filterable boolean` — checkbox "Mostrar como filtro" en Settings (alta y edición), visible solo para tipos que encajan con un widget de filtro genérico: `select`, `multiselect`, `country`, `user`, `boolean`, `status` (y `tracked` cuando su `underlying_type` es uno de esos). Texto libre, número, fecha y los compuestos (Entidades vinculadas/Financiero/Contactos) no muestran el checkbox — no hay un filtro genérico razonable para esos, ya cubre el buscador de texto
- `CustomFieldFilter` (nuevo, en `CustomFieldInput.jsx`): un `<select>` por campo marcado `filterable`, con las opciones que correspondan (choices configurados, estados, países, miembros del workspace, o Sí/No) — múltiple si el campo lo es (matchea "alguno de los elegidos")
- El filtro de "Estado" de Proyectos (antes hardcodeado, `filterStatus`) pasa a ser uno más de este mecanismo genérico — las tarjetas de estado (pipeline por estado) siguen funcionando igual, ahora clickean sobre el campo `status` en vez de un state aparte
- Entidades suma filtros por primera vez (antes solo tenía buscador de texto) — mismo mecanismo, mismo componente
- Quedan como casos especiales, sin generalizar (documentado, no bug): "Proveedor" en Proyectos (`entities_link`, busca por nombre de entidad, no por una lista de opciones) y "Actividad" (`activity_status`, calculado, no es un campo custom)
- Probado con Playwright: checkbox visible solo en tipos compatibles, guardado correcto, filtro nuevo aparece en la toolbar apenas se activa desde Settings, y filtrado real funciona en ambas páginas (Proyectos por Estado, Entidades por Tipo de empresa)

## 2026-07-31 (10)

### Feature: import de Proyectos data-driven, mismo criterio que Entidades
- `ImportNegotiationsModal` tenía las mismas 4 columnas hardcodeadas de siempre (Producto/Proveedor/Estado/Fecha objetivo) — no reflejaba Descripción, Clientes/Potenciales clientes, ni ningún campo custom nuevo. Reescrito con la misma arquitectura que el import de Entidades: headers/parseo/guardado 100% desde `negotiationFieldDefs`
- "Estado" tiene su propia resolución (matchea contra `custom_states`, no contra `options.choices`, con el mismo fallback al primer estado configurado que ya tenía antes) y "Proveedor" sigue siendo una columna aparte que matchea por nombre contra entidades ya cargadas (concepto de `entities_link`, no una celda simple) — ambos casos especiales se mantienen, todo lo demás (Descripción, Clientes, y cualquier campo select/multiselect/fecha/número que se agregue a futuro) sale del mecanismo genérico
- Quedan fuera del import (documentado): `financial` (compuesto: moneda + hitos) y `participants` (usuario, mismo motivo que en Entidades)
- Probado con Playwright: import con Descripción + Clientes (multiselect resuelto) + Prioridad (select custom) + Proveedor, preview y guardado correctos, columnas reales vs jsonb bien separadas

## 2026-07-31 (9)

### Feature: import de Entidades — contacto principal
- Se sumaron 4 columnas opcionales al import (`Contacto: Nombre/Cargo/Email/Teléfono`) — solo aparecen si el workspace tiene el preset Contactos activo. Importa un único contacto (el principal) por entidad; si hacen falta más, se agregan a mano después desde el detalle
- Como `contacts` necesita el `entity_id` recién creado, el insert de entidades ahora pide `.select('id')` de vuelta y el insert de contactos sale en un segundo paso, emparejado por posición

## 2026-07-31 (8)

### Feature: import de Entidades data-driven, alineado con la nueva estructura de campos
- El template de import (`ImportEntitiesModal`) seguía con 4 columnas hardcodeadas (Nombre/País/Sitio web/Tipo de empresa) — no reflejaba los campos reales del workspace (Dirección faltaba, y cualquier campo custom nuevo que alguien agregue en Settings tampoco entraba). Reescrito para construir headers/parseo/guardado 100% a partir de `entityFieldDefs`, mismo criterio data-driven que ya rige el resto de la app desde la refactorización de esta sesión
- Cada `field_type` tiene su propia lógica de parseo de celda: `select`/`multiselect` resuelven el texto contra las opciones configuradas (label o id, case-insensitive, con warning si no matchea), `country` (simple o múltiple, separado por comas) resuelve nombre o código vía `getCountryCode`, `date` reusa el mismo parser que ya usaba el import de Proyectos, `tracked` sigue el `underlying_type`. Al guardar, cada campo va a su columna real (`storage_column`) o al jsonb `custom_fields` correctamente envuelto en `{value, updated_at}`
- Quedan fuera del import (documentado, no bug): `entity_type` (implícito en qué pestaña se importa), `contacts` (sub-formulario repetible, no una celda) y `user` (mapear texto libre contra miembros reales del workspace de forma confiable queda para cuando algún preset lo necesite — hoy ninguno lo usa)
- Probado con Playwright: import con los 7 campos configurados (texto, país, link, texto, select, campo con seguimiento, país múltiple) — vista previa resuelve todos los valores a texto legible, y el insert final separa correctamente columnas reales vs jsonb

## 2026-07-31 (7)

### Fix: import de Entidades guardaba "Tipo de empresa" en formato incorrecto
- `ImportEntitiesModal` escribía `custom_fields: { company_type: texto }` — un escalar suelto, no el formato `{ value, updated_at }` que usa el resto de la app para todo campo custom. El valor importado quedaba invisible (mismo síntoma que el bug del subtítulo de ayer, en la dirección opuesta: acá el dato se guardaba mal, no se leía mal). Corregido antes de que se probara el flujo de import

## 2026-07-31 (6)

### Fix: bandera superpuesta con el texto en CountrySelector
- El padding-left del input cuando hay país seleccionado (28px) no alcanzaba para la bandera (arranca en 10px, 20px de ancho → termina en 30px) — se superponían 2px. Subido a 36px

## 2026-07-31 (5)

### Fix: bugs de País de origen tras la migración de campos custom
- **`[object Object]` en el subtítulo del detalle de entidad**: el subtítulo leía `entity.custom_fields.company_type` directo, pero todo campo custom se guarda envuelto en `{ value, updated_at }`, no como escalar — el template literal stringificaba el objeto entero. Corregido para resolver el def y el valor como corresponde (`renderCustomFieldDisplay` + `getCustomFieldValue`), mismo patrón que ya usa el resto de la app
- **`CountrySelector` no mostraba el país recién elegido** (solo la banderita, el texto seguía en "— Seleccioná un país —"): race condition real — al seleccionar, el componente llama a `.blur()` para cerrar el dropdown, lo que dispara DOS caminos distintos hacia una función `close()` (el listener de click-afuera y un `onBlur` con `setTimeout` de 150ms), y ambos leían un closure viejo de `selected` (el valor todavía no se había propagado desde el padre en ese mismo tick), pisando el nombre recién seleccionado con texto vacío. El dato en sí se guardaba bien (el `onChange` real sí corría) — el bug era puramente visual, pero confundía como si no hubiera guardado nada. Corregido con un flag (`justSelectedRef`) que blindea ambos caminos de `close()` durante los ~200ms posteriores a una selección
- SQL entregado al usuario: reconecta cualquier campo custom tipo País de una ronda anterior a la columna real `country_code` (en vez de duplicarlo), y apaga la banderita duplicada en el detalle de entidad (`options.show_flag = false`, ya que el header del modal de detalle ya muestra su propia bandera)

## 2026-07-31 (4)

### Fix: Guardar/Cancelar de Entidades al header del modal + contraste
- El modal de crear/editar entidad tenía Cancelar/Guardar al fondo del formulario, obligando a bajar para confirmar — a diferencia de Proyectos, que ya los tiene arriba en el header sticky. Movidos al header, mismo patrón (`.modal-header-actions`), eliminado el bloque duplicado de abajo
- De paso, los botones de ese header (reusados tal cual de los estilos pensados para fondo claro) quedaban con muy bajo contraste sobre el gradiente navy — sumados estilos específicos para `.modal-header-actions .btn-primary`/`.btn-secondary`/`.form-error` (blanco sólido para Guardar, borde/texto translúcido claro para Cancelar, rojo claro para el mensaje de error), aplica también al modal de Proyectos que ya tenía este problema sin que se hubiera notado

## 2026-07-31 (3)

### Feature: Estados de Proyectos editables (nombre y color)
- `Settings → Estados` solo permitía agregar/borrar — se sumó "Editar" (nombre + color) a cada fila regular, mismo patrón que ya usan Tipos de entidad y Campos personalizados
- `negotiations.status` guarda el nombre del estado como texto libre (matcheo por nombre, no por id, a diferencia de los campos custom que usan una `key` estable) — renombrar un estado ahora hace un `update` en cascada sobre los proyectos que ya lo tenían asignado, para que no queden huérfanos sin matchear ningún estado configurado
- "Completado" queda sin botón Editar (sigue con el badge "🔒 Protegido") — su nombre está hardcodeado en varios puntos de la app (Dashboard, exports a PDF, filtro de actividad) comparando por el string literal, no por una referencia estable; permitir renombrarlo rompería esas comparaciones en silencio
- Probado con Playwright con datos mockeados: "Completado" bloqueado, renombrar un estado regular actualiza `custom_states` y cascada correctamente a los proyectos existentes

## 2026-07-31 (2)

### Feature: todo campo (menos lo genuinamente estructural) pasa a ser un campo custom real
- El usuario probó el reorder de "campos fijos" de la ronda anterior y notó que el modelo estaba mal planteado: casi ningún campo de esa lista JS estática era realmente estructural, la mayoría era específico del caso de uso de licensing farmacéutico con el que arrancó Nerva. Pidió que todos pasen a ser filas reales de `custom_field_definitions` — editables, borrables salvo un puñado genuinamente estructural — y de paso eliminó dos campos que nunca representaron datos reales y renombró/replanteó otros tres
- Dos columnas nuevas en `custom_field_definitions`: `storage_column text` (si está seteada, el valor vive en una columna real de `negotiations`/`entities` en vez del jsonb `custom_fields`) y `is_structural boolean` (no borrable, `required` fijo en `true` salvo Contactos)
- 5 `field_type` nuevos sembrables solo por SQL (nunca en el desplegable de alta): `entity_type`, `status`, `entities_link`, `financial`, `contacts` — cada uno con su widget bespoke ya existente, ahora tomando el label de la definición
- `field_type='user'` suma `options.multiple` (mismo patrón que ya tenía `country`) — Participantes pasa a ser este tipo, sigue reflejando en vivo a los miembros del workspace sin curación manual. Widget nuevo `UserMultiSelect`
- **Estructurales** (no borrables): Nombre y Tipo en Entidades, Contactos; Nombre del proyecto y Estado en Proyectos. **Pasan a regulares** (editables/borrables): País de origen, Sitio web, Dirección, Tipo de empresa, Descripción, Fecha objetivo, Participantes, Clientes/Potenciales clientes (renombrado de "Empresas interesadas"), Financiero (folda Moneda + Hitos de pago en un preset), Entidades vinculadas
- **Territorios** y la columna vieja **NDA** (`negotiations.territories`/`negotiations.nda`) se eliminaron por completo sin migrar nada — decisión explícita del usuario, la data era de prueba. El campo custom `nda` "con seguimiento" (con datos reales, sembrado en una ronda anterior) no se tocó
- **Bug real encontrado y corregido en el camino**: los renders de "Participantes" (tabla, tarjetas, export CSV, export PDF, detalle) mostraban el array crudo de `neg.participants` sin resolver contra `workspace_members` — con el tipo viejo (texto libre) igual mostraba nombres legibles, pero con el tipo nuevo (`user`, valores `user_id`) hubiera mostrado UUIDs pelados. Se exportaron `resolveMemberName`/`resolveMemberNames` desde `customFields.js` y se usaron en los 4 puntos de render, incluyendo `exportPdf.js` (que no recibía `members` hasta ahora, se sumó al llamado)
- `EntityModal`/`NegotiationModal`/`NegotiationDetail`/`Entities.jsx` reescritos para despachar 100% por `field_type` (nunca por `key` hardcodeada) y guardar por `storage_column` cuando está seteado o en `custom_fields` cuando no. Settings → Campos personalizados deja de mezclar "fijos (JS) + custom (DB)": es 100% lo que devuelve la tabla, con Contactos pinneado al final sin drag handle
- Probado con Playwright: presets estructurales bloqueados correctamente, regulares editables/borrables, borrar un preset lo saca del alta y del detalle, Financiero foldeando Moneda+Hitos, Entidades vinculadas mostrando principal en el hero y secundarias aparte, Participantes resolviendo a nombre real — cero referencias rotas a NDA/Territorios
- **Dos cosas a confirmar con el usuario**: `Fecha objetivo` se conservó como preset regular aunque no estaba en el pedido explícito (para no sacar silenciosamente una feature que funcionaba); si había proyectos reales con Participantes cargado como texto libre, esos valores no se migran (no hay forma automática de mapear un nombre tipeado a un usuario real)
- SQL entregado al usuario: 2 columnas nuevas en `custom_field_definitions`, ampliación del check de `field_type`, `drop column` de `nda`/`territories`, y el seed completo de los 14 presets (`Fecha objetivo` sacado del seed a pedido del usuario — no viene precargado, se puede crear a mano como campo tipo Fecha)

## 2026-07-31

### Feature: Modales grandes y consistentes + orden de campos configurable + campo obligatorio
- El modal de creación de Entidades quedó chico tras sumarle los 5 tipos de campo custom nuevos de ayer (País/Usuario/Link/Email/Teléfono) — forzaba scroll. Al revisar los 4 modales relevantes, solo `EntityModal` (crear/editar entidad) estaba realmente chico (680px, sin alto fijo); `NegotiationModal`, `NegotiationDetail` y `EntityDetailModal` ya usaban `90vw / max-width 1100px / height 85vh` desde antes. Se llevó `EntityModal` al mismo tamaño — no hizo falta tocar los otros tres
- Los campos personalizados dejaron de vivir en un apartado "CAMPOS PERSONALIZADOS" separado — ahora son una entrada más del mismo formulario, mezclados con los campos fijos, en `EntityModal` y `NegotiationModal`. Reescritos a una grilla de 2 columnas (los tipos anchos — texto largo, selección múltiple, país múltiple, el combobox de entidades vinculadas — ocupan el ancho completo), recorriendo un orden combinado con dispatch por key (mismo patrón que `renderCell`/`renderCardField` de Proyectos). Se eliminó `CustomFieldsFormSection`, sin usuarios tras el refactor
- **Orden configurable**: columna nueva `workspaces.field_order jsonb` — un array de keys (fijas y custom mezcladas) por tipo de objeto. Se descartó sembrar los campos fijos como filas falsas en `custom_field_definitions` (ensuciaría una tabla con significado preciso) y se descartó guardarlo por-usuario en localStorage — es una decisión de estructura de datos del equipo, no una preferencia individual de visualización, mismo criterio que ya rige el resto de las tablas de Settings. Helper `computeFieldOrder()` mergea el orden guardado con la lista real (descarta campos borrados, agrega los nuevos al final) — con `field_order` vacío el resultado es exactamente el orden de hoy, cero cambio visual para quien no reordene nada
- Quedan **fuera** del reorder, fijos al final del formulario: Contactos (Entidades), Tareas iniciales e Hitos de pago (Proyectos) — son sub-formularios repetibles con su propia alta/borrado, no un valor atómico simple
- Settings → Campos personalizados: la lista pasó a ser unificada (campos fijos + custom, en el orden real), arrastrable con drag & drop nativo (mismo patrón ya usado en el column-editor de Proyectos) — persiste al soltar, sin botón aparte. Los campos fijos muestran badge "Campo fijo", arrastrables pero no editables ni borrables
- **Campo obligatorio**: columna nueva `custom_field_definitions.required boolean`, checkbox en el alta/edición de un campo custom en Settings (no aplica a campos fijos, que ya tienen su propia validación existente). Bloquea el guardado en ambos modales con un mensaje listando los campos faltantes, y también bloquea la edición inline puntual desde el detalle de un proyecto (si se intenta vaciar un campo obligatorio, no guarda y el input vuelve al último valor válido)
- Alcance del merge sin apartado separado: se extendió también a la sección "Información" de `EntityDetailModal` (solo lectura, cambio chico). **`NegotiationDetail` no se tocó** — Estado/NDA/Moneda son badges/pills en un layout ya diseñado, forzarlos a una lista plana hubiera sido un rediseño no pedido; decisión documentada
- Probado con Playwright: tamaño de ambos modales de creación (1100×850 sobre viewport de 1000px de alto), formularios sin header separado, drag-reorder persistiendo el `PATCH` correcto, validación de obligatorio bloqueando el guardado con el mensaje correcto en ambos modales y en la edición inline
- SQL entregado al usuario: `workspaces.field_order`, `custom_field_definitions.required`

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

### Feature: Campos personalizados por workspace + "campo con seguimiento" (salto a Etapa 2)
- Primer paso del "salto a Etapa 2" acordado con el usuario: todavía sin self-registration/billing/landing (sigue siendo venta uno a uno estilo enterprise), pero cada workspace ya puede definir sus propios campos en Proyectos y Entidades sin que haga falta tocar código ni redeployar por cliente
- Arquitectura data-type-driven, decisión explícita del usuario: el `field_type` de cada campo define guardado/validación/render; el `label` es texto 100% libre que define el workspace, nunca hardcodeado por nombre en el código. Tipos v1: texto, texto largo, numérico, fecha, casilla, lista desplegable, selección múltiple y "campo con seguimiento"
- Nueva tabla `custom_field_definitions` (RLS por workspace, mismo patrón `my_workspace_ids()` del resto de la app) + columnas `custom_fields`/`custom_field_alerts` en `negotiations` y `custom_field_alerts` en `entities` — SQL entregado al usuario para correr manualmente (esta sesión sigue sin salida de red hacia la Supabase real)
- Cada valor se guarda envuelto como `{ value, updated_at }` (`src/lib/customFields.js`) en vez de un escalar suelto — `updated_at` lo mantiene la app (se conserva si el valor no cambió, se pisa con `now()` si cambió), lo que permite que el modo "inactividad" de las alertas funcione genérico sin bookkeeping manual por cada punto de guardado
- "Campo con seguimiento" no es un tipo aparte de los otros — es un valor normal (texto/lista/fecha) más una config de alerta elegida una vez al crear el campo: **fecha límite** (avisa N días antes) o **inactividad** (avisa si no cambió en N días), con N configurable desde Settings. Esto resuelve el pendiente de alertas de vencimiento de NDA que había quedado explícitamente pausado ("no tiene sentido construir alertas sobre un dato que va a cambiar de modelo pronto")
- Nueva pestaña "Campos personalizados" en Settings (`TabCamposPersonalizados`, patrón de edición inline igual a `TabEntidades`): alta/edición/borrado por workspace, toggle Proyectos/Entidades, sub-formulario de opciones para lista/selección múltiple y de disparador+días para campo con seguimiento. Tipo y modo de disparo quedan inmutables después de creado el campo (solo label, opciones y días son editables)
- Proyectos: los campos custom se integran en los 4 despachos paralelos por `.key` que ya existían (tabla, cards, export a Excel) agregando un caso `default` que resuelve por `field_type` en vez de devolver vacío — Kanban lo hereda gratis porque ya reusa el mismo render de cards. Formulario y detalle de proyecto suman una sección "Campos personalizados" con edición inline en el detalle
- Entidades: sección de campos personalizados en el formulario y en el detalle (vista Información) — deliberadamente sin paridad de columnas/tarjetas en la grilla todavía (Entidades no tiene hoy ningún equivalente al column-editor de Proyectos; se deja como fast-follow explícito)
- Bug real encontrado y corregido: `EntityModal.jsx` pisaba el objeto `custom_fields` entero en cada guardado (`{ company_type: ... }` sin mergear) — cualquier campo custom nuevo se hubiera borrado solo en la próxima edición básica de una entidad. Corregido con `mergeCustomFieldValues`, verificado con test de regresión dedicado (edita un campo ajeno, confirma que sobreviven `company_type` y un campo custom preexistente). Se revisó `ImportEntitiesModal.jsx` por el mismo patrón — descartado, es insert-only, no tiene el bug
- Motor de alertas (`notify_custom_field_alerts()` + cron diario, función hermana de `notify_pending_events()` sin tocarla), y la siembra/backfill de NDA y "Tipo de empresa" como campos custom por defecto, quedan como SQL entregado al usuario para correr y validar a mano — no verificable desde este entorno. El `<select>` viejo de NDA y el `<textarea>` viejo de Tipo de empresa se dejan sin tocar hasta confirmar que la siembra funciona en producción
- SQL corrido y validado en Nerva Testing: NDA sembrado y backfillado correctamente; "Tipo de empresa" no tenía valores previos que migrar (campo recién introducido), así que no generó ninguna definición nueva. Ajuste al motor de alertas antes de dejarlo en cron: sin fallback a owners/admins — si un campo con seguimiento no tiene ninguna tarea asignada, directamente no avisa a nadie (decisión explícita del usuario)

### Feature: 5 tipos de campo custom nuevos (País, Usuario, Link, Email, Teléfono) + Dirección y WhatsApp fijos
- El usuario había dejado comentarios sobre el plan original de campos custom que se perdieron en una transición rara de modo plan a implementación — retomados en esta ronda tras confirmar con él qué faltaba
- **País** (`field_type='country'`): reusa el `CountrySelector`/lista de países ya existente (cero datos nuevos). Configurable por campo al crearlo: `multiple` (uno o varios países — cubre tanto "país de origen" como "países donde comercializa un proyecto") y `show_flag`. Selector múltiple nuevo con chips + buscador (`CountryMultiSelect`); en lectura la bandera se resuelve como emoji Unicode (no imagen), para que siga siendo texto plano y funcione igual en tabla, tarjetas y export a Excel sin tratamiento especial por tipo
- **Usuario del workspace** (`field_type='user'`): el widget de edición hace su propio fetch de `workspace_members` al montarse (no hace falta pasar la lista a través de cada formulario). La lectura resuelve el nombre vía un parámetro `members` opcional en `renderCustomFieldDisplay`. De paso se corrigió que el `NegotiationModal`/`NegotiationDetail` embebidos en el detalle de Entidad recibían `members={[]}` hardcodeado — ahora reciben la lista real (afecta también al selector de participantes existente, no solo a los campos custom nuevos)
- **Link / Email / Teléfono**: inputs tipados, clickeables (`mailto:`/`tel:`/`target="_blank"`) solo en las vistas de detalle vía un componente nuevo `CustomFieldReadOnly` — en tabla/tarjetas/Excel siguen siendo texto plano, mismo criterio que el resto de los tipos
- **Dirección** en Entidades: a diferencia de los anteriores, el usuario pidió explícitamente dejarlo como campo fijo (como Sitio web/País), no custom — columna nueva `entities.address`
- **WhatsApp** en Contactos: columna nueva `contacts.whatsapp` (opcional), junto a nombre/puesto/mail/teléfono. En el detalle sale como link a `wa.me/<número>`
- Probado con Playwright: alta de los tipos configurables en Settings, los 5 widgets nuevos en `EntityModal`, guardado con la forma correcta, y el detalle de una entidad confirmando bandera+país, nombre de usuario resuelto, link clickeable y WhatsApp con el número limpio
- SQL entregado al usuario: `entities.address`, `contacts.whatsapp` (dos `alter table` simples, sin RLS nueva)

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
