// Orden por columna, compartido entre la vista Tabla de Proyectos y
// Entidades — nulls/vacíos siempre al final, sin importar la dirección
// (criterio Excel/Sheets habitual).
export function nextSortDir(key, sortKey, sortDir) {
  if (sortKey !== key) return 'asc'
  if (sortDir === 'asc') return 'desc'
  return null
}

export function sortRows(rows, getValue, dir) {
  if (!dir) return rows
  return [...rows].sort((a, b) => {
    const va = getValue(a)
    const vb = getValue(b)
    if (va === null && vb === null) return 0
    if (va === null) return 1
    if (vb === null) return -1
    if (va < vb) return dir === 'asc' ? -1 : 1
    if (va > vb) return dir === 'asc' ? 1 : -1
    return 0
  })
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
