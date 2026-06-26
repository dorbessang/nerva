# Nerva — Changelog

Registro detallado de cambios por sesión de trabajo.

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
