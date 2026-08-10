// Orden por columna, compartido entre la vista Tabla de Proyectos y
// Entidades — nulls/vacíos siempre al final, sin importar la dirección
// (criterio Excel/Sheets habitual).
export function nextSortDir(key, sortKey, sortDir) {
  if (sortKey !== key) return 'asc'
  if (sortDir === 'asc') return 'desc'
  return null
}

// Orden "natural": los números adentro del texto se comparan por su valor,
// no caracter a caracter — "Prod 2" antes que "Prod 10". Mismo criterio en
// cualquier lista ordenada por nombre en toda la app (ver naturalSortByName
// más abajo), no solo acá.
export function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

export function sortRows(rows, getValue, dir) {
  if (!dir) return rows
  return [...rows].sort((a, b) => {
    const va = getValue(a)
    const vb = getValue(b)
    if (va === null && vb === null) return 0
    if (va === null) return 1
    if (vb === null) return -1
    const cmp = typeof va === 'string' && typeof vb === 'string' ? naturalCompare(va, vb) : (va < vb ? -1 : va > vb ? 1 : 0)
    return dir === 'asc' ? cmp : -cmp
  })
}

// Para listas que no pasan por sortRows (fetch directo de Supabase, que
// ordena alfabético caracter a caracter) — mismo criterio de orden natural
// aplicado a un array de objetos con `.name`.
export function naturalSortByName(rows) {
  return [...rows].sort((a, b) => naturalCompare(a?.name || '', b?.name || ''))
}

// Valor comparable genérico para un campo custom — usado por ambas páginas
// como fallback cuando la key no es uno de los casos especiales propios de
// cada una (product/entities/status en Proyectos, name/entity_type en
// Entidades, etc.). Números y fechas ordenan por su valor real; el resto
// ordena por el string que ya se muestra (case-insensitive).
export function customFieldSortValue(def, obj, members, getCustomFieldValue, renderCustomFieldDisplay) {
  if (!def) return null
  const type = def.field_type === 'tracked' ? def.options?.underlying_type : def.field_type
  const raw = def.storage_column ? obj[def.storage_column] : getCustomFieldValue(obj.custom_fields, def.key)
  if (raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0)) return null
  if (type === 'number') return Number(raw)
  if (type === 'date') { const t = new Date(raw).getTime(); return Number.isNaN(t) ? null : t }
  const display = renderCustomFieldDisplay(def, raw, members)
  return display === '—' ? null : display.toLowerCase()
}
