// Helpers compartidos para el sistema de campos custom por workspace
// (Proyectos y Entidades). El valor de cada campo se guarda envuelto en
// { value, updated_at } dentro de la columna jsonb `custom_fields` — nunca
// como un escalar suelto — porque `updated_at` es lo que permite que el
// modo "inactividad" de un campo con seguimiento funcione de forma genérica
// (el cron de alertas solo necesita comparar esa fecha, sin bookkeeping
// aparte por cada punto de guardado).

import { getCountryName } from '../components/CountrySelector'

function countryFlagEmoji(code) {
  if (!code || code.length !== 2) return ''
  return String.fromCodePoint(...code.toUpperCase().split('').map(c => 127397 + c.charCodeAt(0)))
}

function resolveMemberName(members, userId) {
  const m = members?.find(m => (m.user_id || m.id) === userId)
  return m?.profile?.full_name || m?.full_name || ''
}

function valuesEqual(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => v === b[i])
  }
  return a === b
}

// Mergea un valor nuevo dentro del jsonb existente — NUNCA reemplaza el
// objeto entero. Si el valor no cambió respecto al guardado, conserva su
// updated_at viejo; si cambió (o la key es nueva), lo pisa con ahora.
export function mergeCustomFieldValue(existingCF, key, newValue) {
  const cf = { ...(existingCF || {}) }
  const prev = cf[key]
  const unchanged = prev && valuesEqual(prev.value, newValue)
  cf[key] = { value: newValue, updated_at: unchanged ? prev.updated_at : new Date().toISOString() }
  return cf
}

// Mergea varios valores de una — mismo criterio, uno por uno.
export function mergeCustomFieldValues(existingCF, values) {
  let cf = existingCF || {}
  for (const [key, value] of Object.entries(values || {})) {
    cf = mergeCustomFieldValue(cf, key, value)
  }
  return cf
}

export function getCustomFieldValue(cf, key) {
  return cf?.[key]?.value
}

function resolveChoiceLabel(def, id) {
  return def.options?.choices?.find(c => c.id === id)?.label || id
}

// Representación en texto plano de un valor, para tabla/tarjetas/exports —
// resuelve ids de opciones (select/multiselect) a sus labels. `members`
// (workspace_members con profile:user_id(full_name)) es opcional, solo hace
// falta para resolver el nombre de un campo tipo "usuario".
export function renderCustomFieldDisplay(def, rawValue, members) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return '—'
  const underlyingType = def.field_type === 'tracked' ? def.options?.underlying_type : def.field_type

  if (underlyingType === 'multiselect' && Array.isArray(rawValue)) {
    return rawValue.length ? rawValue.map(id => resolveChoiceLabel(def, id)).join(', ') : '—'
  }
  if (underlyingType === 'select') return resolveChoiceLabel(def, rawValue)
  if (underlyingType === 'boolean') return rawValue ? 'Sí' : 'No'
  if (underlyingType === 'country') {
    const showFlag = def.options?.show_flag
    const codes = def.options?.multiple ? (Array.isArray(rawValue) ? rawValue : []) : [rawValue].filter(Boolean)
    if (!codes.length) return '—'
    return codes.map(code => (showFlag ? countryFlagEmoji(code) + ' ' : '') + getCountryName(code)).join(', ')
  }
  if (underlyingType === 'user') return resolveMemberName(members, rawValue) || '—'
  return String(rawValue)
}
