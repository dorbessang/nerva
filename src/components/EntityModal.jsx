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
  const [secondaryEntityTypeId, setSecondaryEntityTypeId] = useState(initial?.secondary_entity_type_id || '')
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
      .eq('workspace_id', workspaceId)
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

  // Contactos existentes vienen tal cual de la base — los campos opcionales
  // (cargo/email/teléfono/whatsapp/notas) pueden ser null ahí, a diferencia
  // de emptyContact() que siempre arranca en ''. Sin este guard, .trim()
  // sobre null tira una excepción a mitad de handleSubmit: el modal queda
  // colgado en "Guardando..." para siempre (nunca llega al setLoading(false)
  // de abajo) y en el flujo de edición, como el delete de contactos ya
  // corrió antes del insert, los contactos de esa entidad quedan borrados.
  function contactRow(c, i, entityId) {
    return {
      workspace_id: workspaceId,
      entity_id: entityId,
      name: (c.name || '').trim(),
      role: (c.role || '').trim() || null,
      email: (c.email || '').trim() || null,
      phone: (c.phone || '').trim() || null,
      whatsapp: (c.whatsapp || '').trim() || null,
      notes: (c.notes || '').trim() || null,
      is_primary: i === 0,
    }
  }

  async function handleSubmit(e) {
    e?.preventDefault()
    setError(null)

    const missing = getMissingRequiredFields(gridDefs, values)
    if (missing.length > 0) { setError(`Faltan completar campos obligatorios: ${missing.join(', ')}`); return }

    setLoading(true)

    try {
      const columnValues = {}
      const jsonbValues = {}
      for (const def of gridDefs) {
        if (def.storage_column) columnValues[def.storage_column] = typeof values[def.key] === 'string' ? values[def.key].trim() || null : (values[def.key] ?? null)
        else jsonbValues[def.key] = values[def.key]
      }
      columnValues.secondary_entity_type_id = secondaryEntityTypeId || null

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
          const validContacts = contacts.filter(c => (c.name || '').trim())
          if (validContacts.length > 0) {
            await supabase.from('contacts').insert(validContacts.map((c, i) => contactRow(c, i, initial.id)))
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
          const validContacts = contacts.filter(c => (c.name || '').trim())
          if (validContacts.length > 0) {
            await supabase.from('contacts').insert(validContacts.map((c, i) => contactRow(c, i, entityData.id)))
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
    } catch {
      setError('Error inesperado al guardar — revisá los datos e intentá de nuevo')
      setLoading(false)
    }
  }

  function renderField(def) {
    if (def.field_type === 'entity_type') {
      return (
        <>
          <div key={def.key} className="form-group">
            <label>{def.label}{def.required ? ' *' : ''}</label>
            <select value={values[def.key] || ''} onChange={e => {
              setValue(def.key, e.target.value)
              if (e.target.value === secondaryEntityTypeId) setSecondaryEntityTypeId('')
            }}>
              {entityTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div key={`${def.key}-secondary`} className="form-group">
            <label>Tipo secundario (opcional)</label>
            <select value={secondaryEntityTypeId} onChange={e => setSecondaryEntityTypeId(e.target.value)}>
              <option value="">Sin tipo secundario</option>
              {entityTypes.filter(t => t.id !== values[def.key]).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </>
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
        <div className="modal-header modal-header--sticky">
          <h2 className="modal-title">{initial ? `Editar ${entityTypeSingular.toLowerCase()}` : `Nuevo ${entityTypeSingular.toLowerCase()}`}</h2>
          <div className="modal-header-actions">
            {error && <span className="form-error" style={{ marginRight: 8 }}>{error}</span>}
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="button" className="btn-primary" onClick={() => handleSubmit()} disabled={loading}>
              {loading ? 'Guardando...' : initial ? 'Guardar cambios' : `Crear ${entityTypeSingular.toLowerCase()}`}
            </button>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
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
        </form>
      </div>
    </div>
  )
}
