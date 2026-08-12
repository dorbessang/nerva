import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { mergeCustomFieldValues, computeFieldOrder, getMissingRequiredFields, isWideCustomField } from '../lib/customFields'
import { naturalSortByName } from '../lib/tableSort'
import { useEscapeToClose } from '../lib/useEscapeToClose'
import { CustomFieldInput } from './CustomFieldInput'
import SearchableSelect from './SearchableSelect'
import './EntityModal.css'

// Modal de alta/edición de Producto — mismo patrón que EntityModal (dispatch
// por field_type, guardado por storage_column vs. jsonb), sin sub-formulario
// de contactos (eso vive en la entidad dueña, no en el producto).
export default function ProductModal({ onClose, onCreated, initial = null, productTypeSingular = 'producto', customFieldDefs = [] }) {
  const { workspaceId } = useAuth()
  useEscapeToClose(onClose)

  const [values, setValues] = useState(() => {
    const init = {}
    for (const def of customFieldDefs) {
      init[def.key] = def.storage_column ? (initial?.[def.storage_column] ?? null) : initial?.custom_fields?.[def.key]?.value
    }
    return init
  })
  const [productTypes, setProductTypes] = useState([])
  const [entities, setEntities] = useState([])
  const [fieldOrder, setFieldOrder] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchProductTypes()
    fetchEntities()
    fetchFieldOrder()
  }, [])

  async function fetchProductTypes() {
    const { data } = await supabase.from('product_types').select('id, name').eq('workspace_id', workspaceId).order('sort_order')
    if (data) {
      setProductTypes(data)
      const typeDef = customFieldDefs.find(d => d.field_type === 'product_type')
      if (typeDef && !values[typeDef.key] && data.length > 0) {
        setValues(v => ({ ...v, [typeDef.key]: data[0].id }))
      }
    }
  }

  async function fetchEntities() {
    const { data } = await supabase.from('entities').select('id, name').eq('workspace_id', workspaceId).order('name')
    if (data) setEntities(naturalSortByName(data))
  }

  async function fetchFieldOrder() {
    const { data } = await supabase.from('workspaces').select('field_order').eq('id', workspaceId).single()
    setFieldOrder(data?.field_order || {})
  }

  function setValue(key, v) {
    setValues(prev => ({ ...prev, [key]: v }))
  }

  async function handleSubmit(e) {
    e?.preventDefault()
    setError(null)

    const missing = getMissingRequiredFields(customFieldDefs, values)
    if (missing.length > 0) { setError(`Faltan completar campos obligatorios: ${missing.join(', ')}`); return }

    setLoading(true)

    const columnValues = {}
    const jsonbValues = {}
    for (const def of customFieldDefs) {
      if (def.storage_column) columnValues[def.storage_column] = typeof values[def.key] === 'string' ? values[def.key].trim() || null : (values[def.key] ?? null)
      else jsonbValues[def.key] = values[def.key]
    }

    const customFields = mergeCustomFieldValues(initial?.custom_fields || {}, jsonbValues)

    if (initial?.id) {
      const { error: productError } = await supabase
        .from('products')
        // Si venía marcado "para completar" (creado al vuelo desde un
        // proyecto), guardar acá — con los obligatorios ya validados
        // arriba — es la señal de que se terminó de cargar.
        .update({ ...columnValues, custom_fields: customFields, needs_review: false })
        .eq('id', initial.id)

      if (productError) {
        setError('Error al actualizar')
        setLoading(false)
        return
      }
    } else {
      const { error: productError } = await supabase
        .from('products')
        .insert({ workspace_id: workspaceId, ...columnValues, custom_fields: customFields })
        .select()
        .single()

      if (productError) {
        setError(`Error al crear el ${productTypeSingular.toLowerCase()}`)
        setLoading(false)
        return
      }
    }

    setLoading(false)
    onCreated()
    onClose()
  }

  function renderField(def) {
    if (def.field_type === 'product_type') {
      return (
        <div key={def.key} className="form-group">
          <label>{def.label}{def.required ? ' *' : ''}</label>
          <select value={values[def.key] || ''} onChange={e => setValue(def.key, e.target.value)}>
            {productTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )
    }
    if (def.field_type === 'product_entity') {
      return (
        <div key={def.key} className="form-group">
          <label>{def.label}{def.required ? ' *' : ''}</label>
          <SearchableSelect
            value={values[def.key] || ''}
            onChange={v => setValue(def.key, v)}
            options={entities.map(e => ({ value: e.id, label: e.name }))}
            placeholder="Buscar proveedor..."
            emptyLabel="Sin asignar"
          />
        </div>
      )
    }
    return (
      <div key={def.key} className={`form-group ${isWideCustomField(def) ? 'form-group--wide' : ''}`}>
        <label>{def.label}{def.required ? ' *' : ''}</label>
        <CustomFieldInput def={def} value={values[def.key]} onChange={v => setValue(def.key, v)} />
      </div>
    )
  }

  const orderedKeys = fieldOrder === null ? customFieldDefs.map(d => d.key) : computeFieldOrder('product', fieldOrder, customFieldDefs)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="entity-modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header modal-header--sticky">
          <h2 className="modal-title">{initial ? `Editar ${productTypeSingular.toLowerCase()}` : `Nuevo ${productTypeSingular.toLowerCase()}`}</h2>
          <div className="modal-header-actions">
            {error && <span className="form-error" style={{ marginRight: 8 }}>{error}</span>}
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="button" className="btn-primary" onClick={() => handleSubmit()} disabled={loading}>
              {loading ? 'Guardando...' : initial ? 'Guardar cambios' : `Crear ${productTypeSingular.toLowerCase()}`}
            </button>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="entity-modal-form">
          <div className="entity-form-section">
            <h3 className="entity-section-title">Datos generales</h3>
            <div className="entity-fields-grid">
              {orderedKeys.map(key => {
                const def = customFieldDefs.find(d => d.key === key)
                if (!def) return null
                return renderField(def)
              })}
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
