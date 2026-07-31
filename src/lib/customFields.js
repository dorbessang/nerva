// Helpers compartidos para el sistema de campos custom por workspace
// (Proyectos y Entidades). El valor de cada campo se guarda envuelto en
// { value, updated_at } dentro de la columna jsonb `custom_fields` — nunca
// como un escalar suelto — porque `updated_at` es lo que permite que el
// modo "inactividad" de un campo con seguimiento funcione de forma genérica
// (el cron de alertas solo necesita comparar esa fecha, sin bookkeeping
// aparte por cada punto de guardado).

import { getCountryName } from '../components/CountrySelector'

// Field types "especiales": no son de guardado genérico en el jsonb
// (`storage_column` apunta a una columna real, o a otra tabla/relación) y
// tienen su propio widget bespoke — nunca aparecen en el desplegable
// "+ Agregar campo" de Settings, solo se siembran por SQL.
export const SPECIAL_FIELD_TYPES = ['entity_type', 'status', 'entities_link', 'financial', 'contacts']

function countryFlagEmoji(code) {
  if (!code || code.length !== 2) return ''
  return String.fromCodePoint(...code.toUpperCase().split('').map(c => 127397 + c.charCodeAt(0)))
}

export function resolveMemberName(members, userId) {
  const m = members?.find(m => (m.user_id || m.id) === userId)
  return m?.profile?.full_name || m?.full_name || ''
}

export function resolveMemberNames(members, userIds) {
  return (userIds || []).map(id => resolveMemberName(members, id)).filter(Boolean)
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
  if (underlyingType === 'user') {
    if (def.options?.multiple) {
      const names = resolveMemberNames(members, Array.isArray(rawValue) ? rawValue : [])
      return names.length ? names.join(', ') : '—'
    }
    return resolveMemberName(members, rawValue) || '—'
  }
  return String(rawValue)
}

// Orden final de un formulario — mergea el orden guardado por el workspace
// con la lista real de keys existentes (todas viven en
// custom_field_definitions, no hay más "campos fijos" separados): descarta
// keys de campos borrados y agrega al final las keys nuevas que el orden
// guardado todavía no conoce. Sin orden guardado, devuelve customDefs tal
// cual vienen ordenados (por sort_order).
export function computeFieldOrder(objectType, fieldOrder, customDefs) {
  const allKeys = (customDefs || []).map(d => d.key)
  const saved = fieldOrder?.[objectType]
  if (!saved || saved.length === 0) return allKeys
  const savedValid = saved.filter(k => allKeys.includes(k))
  const missing = allKeys.filter(k => !savedValid.includes(k))
  return [...savedValid, ...missing]
}

export function isCustomFieldValueEmpty(value) {
  if (Array.isArray(value)) return value.length === 0
  return value === undefined || value === null || value === ''
}

export function getMissingRequiredFields(defs, values) {
  return (defs || []).filter(d => d.required && isCustomFieldValueEmpty(values?.[d.key])).map(d => d.label)
}

// Campos que conviene ocupen el ancho completo de la grilla de 2 columnas
// (texto largo, selección múltiple, país o usuario múltiple, y los
// especiales compuestos) en vez de una celda.
export function isWideCustomField(def) {
  const type = def.field_type === 'tracked' ? def.options?.underlying_type : def.field_type
  if (SPECIAL_FIELD_TYPES.includes(def.field_type)) return true
  return type === 'textarea' || type === 'multiselect' || ((type === 'country' || type === 'user') && def.options?.multiple)
}
