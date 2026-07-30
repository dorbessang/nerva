import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import CountrySelector from './CountrySelector'
import { logActivity } from '../lib/activity'
import { mergeCustomFieldValues } from '../lib/customFields'
import { CustomFieldsFormSection } from './CustomFieldInput'
import './EntityModal.css'

const emptyContact = () => ({
  tempId: Date.now() + Math.random(),
  name: '',
  role: '',
  email: '',
  phone: '',
  notes: '',
  is_primary: false,
})

export default function EntityModal({ onClose, onCreated, initial = null, entityTypeSingular = 'proveedor', customFieldDefs = [] }) {
  const { workspaceId, user } = useAuth()
  const [name, setName] = useState(initial?.name || '')
  const [countryCode, setCountryCode] = useState(initial?.country_code || '')
  const [companyType, setCompanyType] = useState(initial?.custom_fields?.company_type || '')
  const [website, setWebsite] = useState(initial?.website || '')
  const [customFieldValues, setCustomFieldValues] = useState(() =>
    Object.fromEntries(customFieldDefs.map(def => [def.key, initial?.custom_fields?.[def.key]?.value]))
  )
  const [contacts, setContacts] = useState(
    initial?.contacts?.length > 0 ? initial.contacts.map(c => ({ ...c, tempId: Date.now() + Math.random() })) : [emptyContact()]
  )
  const [entityTypes, setEntityTypes] = useState([])
  const [entityTypeId, setEntityTypeId] = useState(initial?.entity_type_id || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchEntityTypes()
  }, [])

  async function fetchEntityTypes() {
    const { data } = await supabase
      .from('entity_types')
      .select('id, name')
      .order('sort_order')
    if (data) {
      setEntityTypes(data)
      if (!entityTypeId && data.length > 0) setEntityTypeId(data[0].id)
    }
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
    if (!name.trim()) { setError('El nombre es obligatorio'); return }
    if (!entityTypeId) { setError('Seleccioná un tipo'); return }

    setLoading(true)

    // Nunca reemplazar custom_fields entero — mergear preserva cualquier
    // campo personalizado ya cargado que este formulario no conoce.
    const customFields = mergeCustomFieldValues(
      { ...(initial?.custom_fields || {}), company_type: companyType.trim() },
      Object.fromEntries(customFieldDefs.map(def => [def.key, customFieldValues[def.key]]))
    )

    if (initial?.id) {
      const { error: entityError } = await supabase
        .from('entities')
        .update({
          name: name.trim(),
          country_code: countryCode || null,
          website: website.trim() || null,
          custom_fields: customFields,
        })
        .eq('id', initial.id)

      if (entityError) {
        setError('Error al actualizar')
        setLoading(false)
        return
      }

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
            notes: c.notes.trim() || null,
            is_primary: i === 0,
          }))
        )
      }
    } else {
      const { data: entityData, error: entityError } = await supabase
        .from('entities')
        .insert({
          workspace_id: workspaceId,
          entity_type_id: entityTypeId,
          name: name.trim(),
          country_code: countryCode || null,
          website: website.trim() || null,
          custom_fields: customFields,
          status: 'active',
        })
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
            notes: c.notes.trim() || null,
            is_primary: i === 0,
          }))
        )
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

            <div className="form-row">
              <div className="form-group">
                <label>NOMBRE *</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={`Ej: Laboratorio Chemo`} autoFocus />
              </div>
              <div className="form-group">
                <label>TIPO</label>
                <select value={entityTypeId} onChange={e => setEntityTypeId(e.target.value)}>
                  {entityTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>PAÍS DE ORIGEN</label>
                <CountrySelector value={countryCode} onChange={setCountryCode} />
              </div>
              <div className="form-group">
                <label>SITIO WEB</label>
                <input type="text" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://..." />
              </div>
            </div>

            <div className="form-group">
              <label>TIPO DE EMPRESA</label>
              <textarea value={companyType} onChange={e => setCompanyType(e.target.value)} placeholder="Ej: Laboratorio multinacional, Distribuidor regional..." rows={2} />
            </div>

            <CustomFieldsFormSection
              defs={customFieldDefs}
              values={customFieldValues}
              onChange={(key, v) => setCustomFieldValues(prev => ({ ...prev, [key]: v }))}
            />
          </div>

          <div className="entity-form-section">
            <div className="entity-section-header">
              <h3 className="entity-section-title">Contactos</h3>
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

                <div className="form-row">
                  <div className="form-group">
                    <label>NOMBRE Y APELLIDO</label>
                    <input type="text" value={contact.name} onChange={e => updateContact(contact.tempId, 'name', e.target.value)} placeholder="Ej: Juan García" />
                  </div>
                  <div className="form-group">
                    <label>CARGO / PUESTO</label>
                    <input type="text" value={contact.role} onChange={e => updateContact(contact.tempId, 'role', e.target.value)} placeholder="Ej: Director Comercial" />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>✉ EMAIL</label>
                    <input type="email" value={contact.email} onChange={e => updateContact(contact.tempId, 'email', e.target.value)} placeholder="juan@empresa.com" />
                  </div>
                  <div className="form-group">
                    <label>📞 TELÉFONO</label>
                    <input type="text" value={contact.phone} onChange={e => updateContact(contact.tempId, 'phone', e.target.value)} placeholder="+54 11 1234-5678" />
                  </div>
                </div>

                <div className="form-group">
                  <label>NOTAS ADICIONALES</label>
                  <textarea value={contact.notes} onChange={e => updateContact(contact.tempId, 'notes', e.target.value)} placeholder="Aclaraciones opcionales..." rows={2} />
                </div>
              </div>
            ))}
          </div>

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