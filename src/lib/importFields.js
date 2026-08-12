// Funciones compartidas por los importadores de Excel (Entidades y
// Proyectos) — parseo de fecha, resolución de una opción de lista contra
// las choices configuradas, y el switch por field_type que arma el valor
// final a guardar. Antes cada importador tenía su propia copia calcada;
// la de Proyectos sabía resolver un campo tipo "estado" contra
// custom_states y la de Entidades sabía resolver "país" — unificadas acá,
// cada tipo queda disponible para cualquiera de los dos (por si algún día
// un workspace arma un campo "estado" en Entidades o "país" en Proyectos,
// que antes se hubiera colado sin avisar por el fallback de texto plano).
import { getCountryCode } from '../components/CountrySelector'

export function parseDate(v) {
  if (!v) return null
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

export function resolveChoiceId(def, text) {
  const choices = def.options?.choices || []
  const match = choices.find(c => c.label.toLowerCase() === text.toLowerCase() || c.id.toLowerCase() === text.toLowerCase())
  if (match) return { value: match.id, warning: null }
  return { value: text, warning: `"${def.label}": "${text}" no coincide con ninguna opción configurada` }
}

// `customStates` solo hace falta para un campo field_type 'status' (hoy
// solo lo usa el import de Proyectos, para el estado del proyecto) — se
// puede omitir si no aplica.
export function parseFieldValue(def, cell, cellRaw, customStates) {
  const type = def.field_type === 'tracked' ? def.options?.underlying_type : def.field_type

  if (type === 'status') {
    const fallback = customStates?.[0]?.name || 'Contactado'
    if (!cell) return { value: fallback, warning: null }
    const match = (customStates || []).find(s => s.name.toLowerCase() === cell.toLowerCase())
    if (match) return { value: match.name, warning: null }
    return { value: fallback, warning: `"${def.label}": "${cell}" no reconocido, se usó "${fallback}"` }
  }
  if (type === 'select') {
    if (!cell) return { value: null, warning: null }
    return resolveChoiceId(def, cell)
  }
  if (type === 'multiselect') {
    if (!cell) return { value: [], warning: null }
    const tokens = cell.split(',').map(t => t.trim()).filter(Boolean)
    const warnings = []
    const ids = tokens.map(t => {
      const r = resolveChoiceId(def, t)
      if (r.warning) warnings.push(r.warning)
      return r.value
    })
    return { value: ids, warning: warnings.join('; ') || null }
  }
  if (type === 'country') {
    if (def.options?.multiple) {
      if (!cell) return { value: [], warning: null }
      const tokens = cell.split(',').map(t => t.trim()).filter(Boolean)
      const warnings = []
      const codes = tokens.map(t => {
        const code = getCountryCode(t)
        if (!code) warnings.push(`"${def.label}": país "${t}" no reconocido`)
        return code
      }).filter(Boolean)
      return { value: codes, warning: warnings.join('; ') || null }
    }
    if (!cell) return { value: null, warning: null }
    const code = getCountryCode(cell)
    return { value: code, warning: code ? null : `"${def.label}": país "${cell}" no reconocido` }
  }
  if (type === 'boolean') {
    if (!cell) return { value: false, warning: null }
    return { value: ['si', 'sí', 'true', 'x', '1'].includes(cell.trim().toLowerCase()), warning: null }
  }
  if (type === 'number') {
    if (!cell) return { value: null, warning: null }
    const n = Number(cell)
    return { value: isNaN(n) ? null : n, warning: isNaN(n) ? `"${def.label}": "${cell}" no es un número` : null }
  }
  if (type === 'date') {
    const display = cellRaw instanceof Date ? cellRaw.toLocaleDateString('es-AR') : String(cellRaw || '').trim()
    if (!display) return { value: null, warning: null }
    const parsed = parseDate(cellRaw)
    return { value: parsed, warning: parsed ? null : `"${def.label}": fecha "${display}" no reconocida` }
  }
  // text, textarea, link, email, phone
  return { value: cell || null, warning: null }
}
