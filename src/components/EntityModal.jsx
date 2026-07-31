import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { logActivity } from '../lib/activity'
import { mergeCustomFieldValues, computeFieldOrder, getMissingRequiredFields, isWideCustomField } from '../lib/customFields'
import { CustomFieldInput } from './CustomFieldInput'
import './EntityModal.css'

const emptyContact = () => ({
  tempId: Date.now() + Math.random(),
  name: '',
  role: '',
  email: '',
  phone: '',
  whatsapp: '',
  notes: '',
  is_primary: false,
})

export default function EntityModal({ onClose, onCreated, initial = null, entityTypeSingular = 'proveedor', customFieldDefs = [] }) {
  const { workspaceId, user } = useAuth()

  const gridDefs = customFieldDefs.filter(d => d.field_type !== 'contacts')
  const contactsDef = customFieldDefs.find(d => d.field_type === 'contacts')

  const [values, setValues] = useState(() => {
    const init = {}
    for (const def of customFieldDefs) {
      if (def.field_type === 'contacts') continue
      init[def.key] = def.storage_column ? (initial?.[def.storage_column] ?? null) : initial?.custom_fields?.[def.key]?.value
    }
    return init
  })
  const [contacts, setContacts] = useState(
    initial?.contacts?.length > 0 ? initial.contacts.map(c => ({ ...c, tempId: Date.now() + Math.random() })) : [emptyContact()]
  )
  const [entityTypes, setEntityTypes] = useState([])
  const [fieldOrder, setFieldOrder] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchEntityTypes()
    fetchFieldOrder()
  }, [])

  async function fetchEntityTypes() {
    const { data } = await supabase
      .from('entity_types')
      .select('id, name')
      .order('sort_order')
    if (data) {
      setEntityTypes(data)
      const entityTypeDef = customFieldDefs.find(d => d.field_type === 'entity_type')
      if (entityTypeDef && !values[entityTypeDef.key] && data.length > 0) {
        setValues(v => ({ ...v, [entityTypeDef.key]: data[0].id }))
      }
    }
  }

  async function fetchFieldOrder() {
    const { data } = await supabase.from('workspaces').select('field_order').eq('id', workspaceId).single()
    setFieldOrder(data?.field_order || {})
  }

  function setValue(key, v) {
    setValues(prev => ({ ...prev, [key]: v }))
  }

  function updateContact(tempId, field, value) {
    setContacts(prev => prev.map(c => c.tempId === tempId ? { ...c, [field]: value } : c))
  }

  function addContact() {
    setContacts(prev => [...prev, emptyContact()])
  }

  function removeContact(tempId) {
    setContacts(prev => prev.filter(c => c.tempId !== tempId))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    const missing = getMissingRequiredFields(gridDefs, values)
    if (missing.length > 0) { setError(`Faltan completar campos obligatorios: ${missing.join(', ')}`); return }

    setLoading(true)

    const columnValues = {}
    const jsonbValues = {}
    for (const def of gridDefs) {
      if (def.storage_column) columnValues[def.storage_column] = typeof values[def.key] === 'string' ? values[def.key].trim() || null : (values[def.key] ?? null)
      else jsonbValues[def.key] = values[def.key]
    }

    // Nunca reemplazar custom_fields entero — mergear preserva cualquier
    // campo personalizado ya cargado que este formulario no conoce.
    const customFields = mergeCustomFieldValues(initial?.custom_fields || {}, jsonbValues)

    if (initial?.id) {
      const { error: entityError } = await supabase
        .from('entities')
        .update({ ...columnValues, custom_fields: customFields })
        .eq('id', initial.id)

      if (entityError) {
        setError('Error al actualizar')
        setLoading(false)
        return
      }

      if (contactsDef) {
        await supabase.from('contacts').delete().eq('entity_id', initial.id)
        const validContacts = contacts.filter(c => c.name.trim())
        if (validContacts.length > 0) {
          await supabase.from('contacts').insert(
            validContacts.map((c, i) => ({
              workspace_id: workspaceId,
              entity_id: initial.id,
              name: c.name.trim(),
              role: c.role.trim() || null,
              email: c.email.trim() || null,
              phone: c.phone.trim() || null,
              whatsapp: c.whatsapp.trim() || null,
              notes: c.notes.trim() || null,
              is_primary: i === 0,
            }))
          )
        }
      }
    } else {
      const { data: entityData, error: entityError } = await supabase
        .from('entities')
        .insert({ workspace_id: workspaceId, ...columnValues, custom_fields: customFields, status: 'active' })
        .select()
        .single()

      if (entityError) {
        if (entityError.code === '23505') {
          setError(`Ya existe un ${entityTypeSingular.toLowerCase()} con ese nombre. Buscalo en la lista para agregar información.`)
        } else {
          setError('Error al crear la entidad')
        }
        setLoading(false)
        return
      }

      if (contactsDef) {
        const validContacts = contacts.filter(c => c.name.trim())
        if (validContacts.length > 0) {
          await supabase.from('contacts').insert(
            validContacts.map((c, i) => ({
              workspace_id: workspaceId,
              entity_id: entityData.id,
              name: c.name.trim(),
              role: c.role.trim() || null,
              email: c.email.trim() || null,
              phone: c.phone.trim() || null,
              whatsapp: c.whatsapp.trim() || null,
              notes: c.notes.trim() || null,
              is_primary: i === 0,
            }))
          )
        }
      }
      await logActivity(supabase, {
        workspaceId, entityId: entityData.id, type: 'entity_created',
        title: `"${entityData.name}" agregado`, actorId: user?.id,
      })
    }

    setLoading(false)
    onCreated()
    onClose()
  }

  function renderField(def) {
    if (def.field_type === 'entity_type') {
      return (
        <div key={def.key} className="form-group">
          <label>{def.label}{def.required ? ' *' : ''}</label>
          <select value={values[def.key] || ''} onChange={e => setValue(def.key, e.target.value)}>
            {entityTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
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

  const orderedKeys = fieldOrder === null ? gridDefs.map(d => d.key) : computeFieldOrder('entity', fieldOrder, gridDefs)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="entity-modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{initial ? `Editar ${entityTypeSingular.toLowerCase()}` : `Nuevo ${entityTypeSingular.toLowerCase()}`}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="entity-modal-form">
          <div className="entity-form-section">
            <h3 className="entity-section-title">Datos generales</h3>

            <div className="entity-fields-grid">
              {orderedKeys.map(key => {
                const def = gridDefs.find(d => d.key === key)
                if (!def) return null
                return renderField(def)
              })}
            </div>
          </div>

          {contactsDef && (
            <div className="entity-form-section">
              <div className="entity-section-header">
                <h3 className="entity-section-title">{contactsDef.label}</h3>
                <button type="button" className="btn-add-contact" onClick={addContact}>+ Agregar contacto</button>
              </div>

              {contacts.map((contact, index) => (
                <div key={contact.tempId} className="contact-block">
                  <div className="contact-block-header">
                    <span className="contact-block-label">{index === 0 ? 'Contacto principal' : `Contacto ${index + 1}`}</span>
                    {contacts.length > 1 && (
                      <button type="button" className="btn-remove-contact" onClick={() => removeContact(contact.tempId)}>✕</button>
                    )}
                  </div>

                  <div className="entity-fields-grid">
                    <div className="form-group">
                      <label>NOMBRE Y APELLIDO</label>
                      <input type="text" value={contact.name} onChange={e => updateContact(contact.tempId, 'name', e.target.value)} placeholder="Ej: Juan García" />
                    </div>
                    <div className="form-group">
                      <label>CARGO / PUESTO</label>
                      <input type="text" value={contact.role} onChange={e => updateContact(contact.tempId, 'role', e.target.value)} placeholder="Ej: Director Comercial" />
                    </div>
                    <div className="form-group">
                      <label>✉ EMAIL</label>
                      <input type="email" value={contact.email} onChange={e => updateContact(contact.tempId, 'email', e.target.value)} placeholder="juan@empresa.com" />
                    </div>
                    <div className="form-group">
                      <label>📞 TELÉFONO</label>
                      <input type="text" value={contact.phone} onChange={e => updateContact(contact.tempId, 'phone', e.target.value)} placeholder="+54 11 1234-5678" />
                    </div>
                    <div className="form-group">
                      <label>💬 WHATSAPP (opcional)</label>
                      <input type="text" value={contact.whatsapp || ''} onChange={e => updateContact(contact.tempId, 'whatsapp', e.target.value)} placeholder="+54 9 11 1234-5678" />
                    </div>
                    <div className="form-group form-group--wide">
                      <label>NOTAS ADICIONALES</label>
                      <textarea value={contact.notes} onChange={e => updateContact(contact.tempId, 'notes', e.target.value)} placeholder="Aclaraciones opcionales..." rows={2} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && <p className="form-error">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Guardando...' : initial ? 'Guardar cambios' : `Crear ${entityTypeSingular.toLowerCase()}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
