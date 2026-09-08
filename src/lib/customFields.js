// Helpers compartidos para el sistema de campos custom por workspace
// (Proyectos y Entidades). El valor de cada campo se guarda envuelto en
// { value, updated_at } dentro de la columna jsonb `custom_fields` — nunca
// como un escalar suelto — porque `updated_at` es lo que permite que el
// modo "inactividad" de un campo con seguimiento funcione de forma genérica
// (el cron de alertas solo necesita comparar esa fecha, sin bookkeeping
// aparte por cada punto de guardado).

import { getCountryName, getAllCountries } from '../components/CountrySelector'

// Field types "especiales": no son de guardado genérico en el jsonb
// (`storage_column` apunta a una columna real, o a otra tabla/relación) y
// tienen su propio widget bespoke — nunca aparecen en el desplegable
// "+ Agregar campo" de Settings, solo se siembran por SQL.
export const SPECIAL_FIELD_TYPES = ['entity_type', 'status', 'entities_link', 'financial', 'contacts', 'product_type', 'product_entity', 'products_link']

// "Predefinido" = tiene una estructura fija definida por el código: o guarda
// en una columna real (storage_column) o usa uno de los widgets bespoke de
// arriba. El usuario puede prenderlo/apagarlo (columna `enabled`) pero no
// puede cambiar su forma. Todo lo demás es un campo "custom": libre, 100%
// definido por el usuario desde "+ Agregar campo", vive en el jsonb.
export function isPredefinedField(def) {
  return !!def.storage_column || SPECIAL_FIELD_TYPES.includes(def.field_type)
}

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
// falta para resolver el nombre de un campo tipo "usuario". `refLists`
// (opcional) es { entities, negotiations, products }, cada uno una lista
// liviana [{ id, name }] — hace falta para resolver campos tipo Entidad/
// Proyecto/Producto del workspace.
export function renderCustomFieldDisplay(def, rawValue, members, refLists) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return '—'
  const underlyingType = def.field_type === 'tracked' ? def.options?.underlying_type : def.field_type

  if (underlyingType === 'number' && !Number.isNaN(Number(rawValue))) {
    return Number(rawValue).toLocaleString('es-AR', { maximumFractionDigits: 2 })
  }
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
  if (underlyingType === 'entity_ref') return resolveRefNames(refLists?.entities, def, rawValue)
  if (underlyingType === 'negotiation_ref') return resolveRefNames(refLists?.negotiations, def, rawValue)
  if (underlyingType === 'product_ref') return resolveRefNames(refLists?.products, def, rawValue)
  return String(rawValue)
}

// Campos "referencia" (Entidad/Proyecto/Producto del workspace): mismo
// patrón que Usuario, pero contra una lista genérica { id, name } que arma
// cada página con los datos que ya tiene cargados (no hace falta un fetch
// aparte acá — sin lista, degrada a "—" en vez de romper).
function resolveRefNames(list, def, rawValue) {
  const ids = def.options?.multiple ? (Array.isArray(rawValue) ? rawValue : []) : [rawValue].filter(Boolean)
  if (!ids.length) return '—'
  const names = ids.map(id => list?.find(x => x.id === id)?.name).filter(Boolean)
  return names.length ? names.join(', ') : '—'
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
  const refTypes = ['country', 'user', 'entity_ref', 'negotiation_ref', 'product_ref']
  return type === 'textarea' || type === 'multiselect' || (refTypes.includes(type) && def.options?.multiple)
}

// Tipos con una lista de opciones predefinida (elegida al crear el campo,
// o resuelta desde otra tabla del workspace) — el checklist de filtro sale
// directo de ahí, no de los datos cargados.
const FILTERABLE_TYPES = ['select', 'multiselect', 'country', 'user', 'boolean', 'status', 'product_type']

// Tipos de valor libre (texto/número/fecha/link/email/teléfono): no tienen
// opciones predefinidas, pero igual son filtrables — el checklist se arma
// con los valores realmente cargados en esas filas, mismo criterio que un
// filtro de columna de Excel (con buscador para no perderse entre muchos).
const FREEFORM_FILTERABLE_TYPES = ['text', 'textarea', 'number', 'date', 'link', 'email', 'phone']

// Elegible para el checklist de filtro (encabezado de columna / botón
// "Filtros") — prácticamente cualquier campo simple.
export function isFieldFilterable(def) {
  const type = def.field_type === 'tracked' ? def.options?.underlying_type : def.field_type
  return FILTERABLE_TYPES.includes(type) || FREEFORM_FILTERABLE_TYPES.includes(type)
}

// Elegible para "tarjetas de filtro" (fila de tarjetas siempre visible,
// Configuración → Entidades → Campos) — a diferencia del checklist, ahí
// hace falta un conjunto chico y predefinido de valores; un campo de texto
// libre con decenas de valores distintos no funciona como tarjetas.
export function isCardFilterable(def) {
  const type = def.field_type === 'tracked' ? def.options?.underlying_type : def.field_type
  return FILTERABLE_TYPES.includes(type)
}

export function isMultiValueFilter(def) {
  const type = def.field_type === 'tracked' ? def.options?.underlying_type : def.field_type
  if (type === 'multiselect') return true
  if (type === 'country' || type === 'user') return !!def.options?.multiple
  return false
}

// Opciones para el widget de filtro — {id, label} — según el tipo del campo.
// `rows` (las filas relevantes en la página que llama, ya facetadas contra
// cualquier otro filtro activo) es lo que recorta la lista a lo que
// realmente puede elegirse — nunca un catálogo de referencia completo (ej.
// los ~195 países del mundo cuando el workspace solo tiene entidades de 5).
// Si no se pasa `rows` cae al catálogo completo, para no romper algún
// consumidor que todavía no lo pasa.
export function filterChoicesFor(def, { customStates, members, productTypes, rows } = {}) {
  const type = def.field_type === 'tracked' ? def.options?.underlying_type : def.field_type
  const present = rows ? presentRawValues(def, rows) : null

  if (type === 'status') {
    const base = (customStates || []).map(s => ({ id: s.name, label: s.name }))
    return present ? base.filter(c => present.has(c.id)) : base
  }
  if (type === 'select' || type === 'multiselect') {
    const base = def.options?.choices || []
    return present ? base.filter(c => present.has(String(c.id))) : base
  }
  if (type === 'country') {
    if (!present) return getAllCountries().map(c => ({ id: c.code, label: c.name }))
    return [...present].sort().map(code => ({ id: code, label: getCountryName(code) || code }))
  }
  if (type === 'user') {
    const base = (members || []).map(m => ({ id: m.user_id, label: m.profile?.full_name || 'Usuario' }))
    return present ? base.filter(c => present.has(String(c.id))) : base
  }
  if (type === 'boolean') {
    const base = [{ id: 'true', label: 'Sí' }, { id: 'false', label: 'No' }]
    return present ? base.filter(c => present.has(c.id)) : base
  }
  if (type === 'product_type') {
    const base = (productTypes || []).map(t => ({ id: t.id, label: t.name }))
    return present ? base.filter(c => present.has(String(c.id))) : base
  }
  if (FREEFORM_FILTERABLE_TYPES.includes(type)) return uniqueValueChoices(def, rows)
  return []
}

// Set de valores realmente cargados para `def` en `rows` — cubre tanto
// campos de un solo valor como de varios (multiselect, país/usuario
// "permite varios"), todo normalizado a string para comparar por igual.
function presentRawValues(def, rows) {
  const set = new Set()
  ;(rows || []).forEach(row => {
    const raw = rawFieldValue(def, row)
    if (raw === undefined || raw === null || raw === '') return
    if (Array.isArray(raw)) raw.forEach(v => set.add(String(v)))
    else set.add(String(raw))
  })
  return set
}

function uniqueValueChoices(def, rows) {
  const present = presentRawValues(def, rows)
  return [...present].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(v => ({ id: v, label: v }))
}

function rawFieldValue(def, obj) {
  return def.storage_column ? obj[def.storage_column] : getCustomFieldValue(obj.custom_fields, def.key)
}

// true si `obj` matchea todos los filtros de `defs` EXCEPTO el del campo
// `excludeKey` — para armar el checklist de un filtro facetado contra todo
// lo demás ya elegido (estilo Excel: abrís el filtro de País y solo ves los
// países que "sobreviven" dado lo que ya filtraste en otras columnas).
export function matchesAllFieldFilters(defs, obj, filterValues, excludeKey) {
  return (defs || []).every(def => def.key === excludeKey || matchesFieldFilter(def, obj, filterValues?.[def.key]))
}

// Etiquetas legibles de los filtros de campo actualmente activos — ej.
// ["Argentina"] o ["Cliente, Proveedor", "Activo"] — una entrada por
// campo con algún valor tildado. Se usa para armar la aclaración de la
// tarjeta de subtotal ("5 entidades: Argentina"), no hace falta nombrar
// cada filtro posible, solo los que realmente están activos.
export function describeFieldFilters(defs, filterValues, choicesOpts) {
  const parts = []
  ;(defs || []).forEach(def => {
    const v = filterValues?.[def.key]
    const arr = Array.isArray(v) ? v : (v ? [v] : [])
    if (arr.length === 0) return
    const choices = filterChoicesFor(def, choicesOpts)
    parts.push(arr.map(id => choices.find(c => String(c.id) === String(id))?.label || id).join(', '))
  })
  return parts
}

// true si `obj` matchea el filtro elegido para este campo — filterValue
// vacío/undefined siempre matchea (sin filtro activo). `filterValue` puede
// ser un valor único (widget viejo, un <select>) o un array (checklist tipo
// Excel, varios valores tildados) — en ambos casos matchea "alguno de los
// elegidos" contra el valor real del campo.
export function matchesFieldFilter(def, obj, filterValue) {
  if (filterValue === undefined || filterValue === null || filterValue === '' || (Array.isArray(filterValue) && filterValue.length === 0)) return true
  const raw = rawFieldValue(def, obj)
  const type = def.field_type === 'tracked' ? def.options?.underlying_type : def.field_type
  const wanted = Array.isArray(filterValue) ? filterValue : [filterValue]
  if (type === 'boolean') return wanted.includes(String(!!raw))
  if (isMultiValueFilter(def)) {
    const rawArr = Array.isArray(raw) ? raw : []
    return wanted.some(v => rawArr.includes(v))
  }
  // Los ids de choices de valor libre son siempre string (ver
  // uniqueValueChoices) — normalizamos acá para que un campo numérico o de
  // fecha siga matcheando aunque el valor guardado no sea un string.
  return wanted.includes(typeof raw === 'string' ? raw : String(raw))
}
