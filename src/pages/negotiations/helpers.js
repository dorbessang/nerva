import { getCustomFieldValue, renderCustomFieldDisplay, resolveMemberNames } from '../../lib/customFields'
import { customFieldSortValue } from '../../lib/tableSort'

export const CURRENCIES = ['USD','EUR','GBP','ARS','BRL','MXN','CHF']

// "1 de sept. 2026" -- mismo helper que PriceHistory.jsx, a mano porque
// toLocaleDateString varía el formato (cero adelante, punto en el mes)
// según el motor.
const QUOTE_MONTHS_ABBR = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sept.', 'oct.', 'nov.', 'dic.']
export function formatQuoteDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getDate()} de ${QUOTE_MONTHS_ABBR[d.getMonth()]} ${d.getFullYear()}`
}

// Columnas que NO son un campo custom configurable (calculadas o legacy) —
// product/entities/status/description/participants viven en
// custom_field_definitions y su label sale de ahí, nunca de acá, para no
// duplicar la columna con un label viejo que ignore lo que se configuró en
// Settings (bug real: esta lista tenía esos 6 keys hardcodeados y `.find()`
// devolvía siempre esta entrada primero, tapando el label real).
export const ALL_COLUMNS = [
  { key: 'target_date',      label: 'Fecha'                                  },
  { key: 'notes',            label: 'Notas'                                  },
  { key: 'observations',     label: 'Aclaraciones'                           },
  { key: 'activity_status',  label: 'Actividad'                              },
  { key: 'last_activity_at', label: 'Últ. actividad'                         },
]

export const ACTIVITY_LABELS = { active: 'En curso', paused: 'Pausado', inactive: 'Inactivo' }

// Solo depende de `neg` (a diferencia de getEntityName/getEntityFlag, que
// necesitan la lista completa de entidades como fallback) — no hace falta
// pasarla como parámetro en ningún lado.
export function getProductName(neg) {
  const primary = neg.primary_product || neg.negotiation_products?.map(np => np.product).filter(Boolean)[0] || null
  return primary?.name || '—'
}

// Entidades vinculadas a un proyecto de un tipo (rol) dado — una columna por
// tipo, máx. una entidad por tipo (confirmado con el usuario). El rol de cada
// vínculo se guarda en negotiation_entities.role (el dropdown en el que se
// eligió la entidad al armar el proyecto) — no se infiere del entity_type_id
// propio de la entidad, porque una entidad puede tener tipo primario Y
// secundario (ver EntityModal.jsx) y esa ambigüedad no diría en qué rol
// quedó para ESTE proyecto puntual. El fallback a entity_type_id es solo
// por si algún vínculo viejo quedó sin `role` (backfill de la migración).
export function getEntitiesOfType(neg, typeId) {
  return (neg.negotiation_entities || [])
    .filter(ne => (ne.role || ne.entity?.entity_type_id) === typeId)
    .map(ne => ne.entity)
}

// El filtro de Estado puede venir de la tarjeta de stats (valor único) o del
// checklist tipo Excel del encabezado de columna (array) — normaliza ambos.
export function statusFilterIncludes(filterValue, name) {
  return Array.isArray(filterValue) ? filterValue.includes(name) : filterValue === name
}

// Valor de texto plano por columna para el export CSV — separado de
// renderCell/renderCardField porque esos devuelven JSX con badges/chips.
export function getExportValue(key, neg, getEntityName, customFieldDefs, members, refLists) {
  if (key.startsWith('entity_type:')) return getEntitiesOfType(neg, key.slice('entity_type:'.length)).map(e => e.name).join(', ')
  switch (key) {
    case 'product': return neg.product || neg.title || ''
    case 'products': { const name = getProductName(neg); return name === '—' ? '' : name }
    case 'status': return neg.status || ''
    case 'description': return neg.description || ''
    case 'target_date': return neg.target_date || ''
    case 'participants': return resolveMemberNames(members, neg.participants).join(', ')
    case 'notes': return (neg.notes_list || []).map(n => `${n.note_date}: ${n.content}`).join(' | ')
    case 'observations': return neg.observations || ''
    case 'activity_status': return ACTIVITY_LABELS[neg.activity_status] || ''
    case 'last_activity_at': return neg.last_activity_at ? neg.last_activity_at.slice(0, 10) : ''
    default: {
      const def = customFieldDefs?.find(d => d.key === key)
      if (!def) return ''
      const val = renderCustomFieldDisplay(def, getCustomFieldValue(neg.custom_fields, key), members, refLists)
      return val === '—' ? '' : val
    }
  }
}

// Valor comparable por columna para el click-para-ordenar del encabezado —
// null siempre ordena al final, ver sortRows en lib/tableSort.js.
export function getNegSortValue(key, neg, getEntityName, customFieldDefs, members, refLists) {
  if (key.startsWith('entity_type:')) {
    const names = getEntitiesOfType(neg, key.slice('entity_type:'.length)).map(e => e.name)
    return names.length ? names.join(', ').toLowerCase() : null
  }
  switch (key) {
    case 'product': return (neg.product || neg.title || '').toLowerCase() || null
    case 'products': { const name = getProductName(neg); return name !== '—' ? name.toLowerCase() : null }
    case 'status': return neg.status?.toLowerCase() || null
    case 'description': return neg.description?.toLowerCase() || null
    case 'target_date': { const t = neg.target_date ? new Date(neg.target_date).getTime() : NaN; return Number.isNaN(t) ? null : t }
    case 'participants': { const names = resolveMemberNames(members, neg.participants); return names.length ? names.join(', ').toLowerCase() : null }
    case 'notes': return neg.notes_list?.length || null
    case 'observations': return neg.observations?.toLowerCase() || null
    case 'activity_status': return neg.activity_status || null
    case 'last_activity_at': { const t = neg.last_activity_at ? new Date(neg.last_activity_at).getTime() : NaN; return Number.isNaN(t) ? null : t }
    default: return customFieldSortValue(customFieldDefs?.find(d => d.key === key), neg, members, getCustomFieldValue, renderCustomFieldDisplay, refLists)
  }
}

// Excel real (.xlsx) en vez de CSV: evita de raíz los problemas de
// delimitador (coma vs ";" según configuración regional) y de codificación
// de acentos que sí aparecen con texto plano tipo CSV.
// xlsx/jspdf se cargan bajo demanda (import dinámico) para no sumarlos al
// bundle inicial de /negotiations — son acciones ocasionales, no parte del
// flujo principal de la página.
export async function exportNegotiationsXlsx(negotiations, cols, getEntityName, customFieldDefs, members, entityTypes = [], refLists) {
  const XLSX = await import('xlsx')
  const visibleCols = cols.filter(c => c.visible)
  const headers = visibleCols.map(c => {
    if (c.key.startsWith('entity_type:')) {
      const et = entityTypes.find(t => t.id === c.key.slice('entity_type:'.length))
      return et?.plural || et?.name || c.key
    }
    return customFieldDefs.find(d => d.key === c.key)?.label || ALL_COLUMNS.find(x => x.key === c.key)?.label || c.key
  })
  const rows = [
    headers,
    ...negotiations.map(neg => visibleCols.map(c => getExportValue(c.key, neg, getEntityName, customFieldDefs, members, refLists))),
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = visibleCols.map(() => ({ wch: 22 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Proyectos')
  XLSX.writeFile(wb, `nerva-proyectos-${new Date().toISOString().slice(0, 10)}.xlsx`)
}
