// Presets para la pantalla de bienvenida de un workspace nuevo (owner recién
// creado, workspace vacío). Dos niveles: "recomendado" (dominio típico de
// licensing farmacéutico, igual al que ya usa el resto de la app) y "mínimo"
// (solo los 5 campos estructurales de los que depende el código para
// funcionar — el resto lo arma el owner desde Configuración).
import { supabase } from './supabase'

const ENTITY_TYPE_PRESETS = [
  { name: 'Proveedor', plural: 'Proveedores', icon: 'Factory' },
  { name: 'Cliente', plural: 'Clientes', icon: 'Building2' },
  { name: 'Distribuidor', plural: 'Distribuidores', icon: 'Truck' },
]

const STATE_PRESETS = [
  { name: 'Contactado', color: '#1D4ED8', bg_color: '#EFF6FF' },
  { name: 'En Negociación', color: '#D97706', bg_color: '#FFFBEB' },
  { name: 'Due Diligence', color: '#7C3AED', bg_color: '#F5F3FF' },
  { name: 'Contrato', color: '#0891B2', bg_color: '#ECFEFF' },
  { name: 'Completado', color: '#059669', bg_color: '#ECFDF5', is_terminal: true },
]

const MINIMAL_STATE_PRESETS = [
  { name: 'En curso', color: '#1D4ED8', bg_color: '#EFF6FF' },
  { name: 'Completado', color: '#059669', bg_color: '#ECFDF5', is_terminal: true },
]

// is_structural: true — no borrables, required fijo en true (salvo Contactos).
const STRUCTURAL_ENTITY_FIELDS = [
  { key: 'name', label: 'Nombre', field_type: 'text', storage_column: 'name', required: true },
  { key: 'entity_type', label: 'Tipo', field_type: 'entity_type', storage_column: 'entity_type_id', required: true },
  { key: 'contacts', label: 'Contactos', field_type: 'contacts', storage_column: null },
]

const REGULAR_ENTITY_FIELDS = [
  { key: 'country', label: 'País de origen', field_type: 'country', storage_column: 'country_code', options: { multiple: false, show_flag: false }, filterable: true },
  { key: 'website', label: 'Sitio web', field_type: 'link', storage_column: 'website' },
  { key: 'address', label: 'Dirección', field_type: 'text', storage_column: 'address' },
  { key: 'company_type', label: 'Tipo de empresa', field_type: 'select', storage_column: null, options: { choices: [] }, filterable: true },
]

const STRUCTURAL_NEGOTIATION_FIELDS = [
  { key: 'product', label: 'Nombre del proyecto', field_type: 'text', storage_column: 'product', required: true },
  { key: 'status', label: 'Estado', field_type: 'status', storage_column: 'status', required: true, filterable: true },
]

// Description/Participantes no son estructurales en el sentido de que el
// código dependa de ellos para funcionar, pero como los widgets del Resumen
// del proyecto los buscan por storage_column (no por key/label, que el
// usuario puede cambiar), solo se pueden recrear con el storage_column
// correcto por SQL — no desde "+ Agregar campo" de Configuración. Por eso
// se siembran en los dos presets: el owner los puede borrar si no los
// quiere, pero no puede "agregarlos de vuelta" solo.
const RESUMEN_NEGOTIATION_FIELDS = [
  { key: 'description', label: 'Descripción', field_type: 'textarea', storage_column: 'description' },
  { key: 'participants', label: 'Participantes', field_type: 'user', storage_column: 'participants', options: { multiple: true }, filterable: true },
]

const REGULAR_NEGOTIATION_FIELDS = [
  { key: 'entities', label: 'Entidades vinculadas', field_type: 'entities_link', storage_column: null },
  { key: 'companies', label: 'Clientes / Potenciales clientes', field_type: 'multiselect', storage_column: 'companies', options: { choices: [] }, filterable: true },
  { key: 'financial', label: 'Financiero', field_type: 'financial', storage_column: null },
]

function fieldRows(workspaceId, objectType, presets, isStructural, startOrder) {
  return presets.map((f, i) => ({
    workspace_id: workspaceId,
    object_type: objectType,
    key: f.key,
    label: f.label,
    field_type: f.field_type,
    storage_column: f.storage_column ?? null,
    is_structural: isStructural,
    required: f.required ?? false,
    filterable: f.filterable ?? false,
    options: f.options ?? {},
    sort_order: startOrder + i,
  }))
}

function stateRows(workspaceId, presets) {
  return presets.map((s, i) => ({
    workspace_id: workspaceId,
    object_type: 'negotiation',
    name: s.name,
    color: s.color,
    bg_color: s.bg_color,
    sort_order: i,
    is_terminal: !!s.is_terminal,
  }))
}

async function insertStructuralFields(workspaceId) {
  const rows = [
    ...fieldRows(workspaceId, 'entity', STRUCTURAL_ENTITY_FIELDS, true, 0),
    ...fieldRows(workspaceId, 'negotiation', STRUCTURAL_NEGOTIATION_FIELDS, true, 0),
    ...fieldRows(workspaceId, 'negotiation', RESUMEN_NEGOTIATION_FIELDS, false, STRUCTURAL_NEGOTIATION_FIELDS.length),
  ]
  const { error } = await supabase.from('custom_field_definitions').insert(rows)
  if (error) throw error
}

// Preset completo: tipos de entidad + pipeline de 5 estados + los 14 campos
// (5 estructurales + 9 regulares), listo para cargar datos reales de una.
export async function seedWorkspaceRecommended(workspaceId) {
  const { error: typesError } = await supabase.from('entity_types').insert(
    ENTITY_TYPE_PRESETS.map((t, i) => ({ workspace_id: workspaceId, name: t.name, plural: t.plural, icon: t.icon, sort_order: i }))
  )
  if (typesError) throw typesError

  const { error: statesError } = await supabase.from('custom_states').insert(stateRows(workspaceId, STATE_PRESETS))
  if (statesError) throw statesError

  await insertStructuralFields(workspaceId)

  const regularRows = [
    ...fieldRows(workspaceId, 'entity', REGULAR_ENTITY_FIELDS, false, STRUCTURAL_ENTITY_FIELDS.length),
    ...fieldRows(workspaceId, 'negotiation', REGULAR_NEGOTIATION_FIELDS, false, STRUCTURAL_NEGOTIATION_FIELDS.length + RESUMEN_NEGOTIATION_FIELDS.length),
  ]
  const { error: regularError } = await supabase.from('custom_field_definitions').insert(regularRows)
  if (regularError) throw regularError
}

// Preset mínimo: solo los campos estructurales indispensables para que la
// app funcione (Nombre, Tipo, Contactos, Nombre del proyecto, Estado) + dos
// estados básicos. Sin tipos de entidad ni campos regulares — el owner
// arma el resto desde Configuración.
export async function seedWorkspaceMinimal(workspaceId) {
  const { error: statesError } = await supabase.from('custom_states').insert(stateRows(workspaceId, MINIMAL_STATE_PRESETS))
  if (statesError) throw statesError

  await insertStructuralFields(workspaceId)
}
