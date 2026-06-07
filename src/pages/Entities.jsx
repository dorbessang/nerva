import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import EntityModal from '../components/EntityModal'
import { getFlagUrl, getCountryName } from '../components/CountrySelector'
import './Entities.css'

const AVATAR_COLORS = [
  ['#EFF6FF', '#1D4ED8'],
  ['#F5F3FF', '#6D28D9'],
  ['#ECFDF5', '#059669'],
  ['#FFFBEB', '#D97706'],
  ['#FEF2F2', '#DC2626'],
]

function getInitials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

function getAvatarColor(name) {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]
}

export default function Entities({ entityTypeId, entityTypeName, entityTypeSingular }) {
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [selectedEntity, setSelectedEntity] = useState(null)
  const [negotiationStates, setNegotiationStates] = useState([])

  useEffect(() => {
    fetchEntities()
    fetchNegotiationStates()
  }, [entityTypeId])

  async function fetchEntities() {
    setLoading(true)

    const { data: entitiesData, error } = await supabase
      .from('entities')
      .select(`
        *,
        entity_type:entity_type_id ( name, color ),
        contacts ( id, name, role, email, phone, notes, is_primary )
      `)
      .eq('entity_type_id', entityTypeId)
      .order('name')

    if (error) {
      console.log('entities error:', error)
      setLoading(false)
      return
    }

    const entityIds = entitiesData.map(e => e.id)
    const { data: negEntities } = await supabase
      .from('negotiation_entities')
      .select('entity_id, negotiation_id')
      .in('entity_id', entityIds)

    const negIds = [...new Set((negEntities || []).map(ne => ne.negotiation_id))]
    let negsData = []
    if (negIds.length > 0) {
      const { data } = await supabase
        .from('negotiations')
        .select('id, title, status')
        .in('id', negIds)
      negsData = data || []
    }

    const combined = entitiesData.map(entity => ({
      ...entity,
      negotiation_entities: (negEntities || [])
        .filter(ne => ne.entity_id === entity.id)
        .map(ne => ({
          ...ne,
          negotiation: negsData.find(n => n.id === ne.negotiation_id) || null
        }))
    }))

    setEntities(combined)
    setLoading(false)
  }

  async function fetchNegotiationStates() {
    const { data } = await supabase
      .from('custom_states')
      .select('name, color, bg_color')
      .eq('object_type', 'negotiation')
      .order('sort_order')
    if (data) setNegotiationStates(data)
  }

  function getStateConfig(stateName) {
    const found = negotiationStates.find(s => s.name === stateName)
    return found || { color: '#64748B', bg_color: '#F1F5F9' }
  }

  function getNegotiationSummary(negotiationEntities) {
    if (!negotiationEntities || negotiationEntities.length === 0) return null
    const negs = negotiationEntities.map(n => n.negotiation).filter(Boolean)
    if (negs.length === 0) return null
    const counts = {}
    negs.forEach(n => {
      if (!counts[n.status]) counts[n.status] = 0
      counts[n.status]++
    })
    return counts
  }

  const filtered = entities.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="entities-container">
      <div className="entities-header">
        <h1 className="entities-title">{entityTypeName || 'Proveedores'}</h1>
        <button className="entities-new-btn" onClick={() => setShowModal(true)}>
          + Nuevo {entityTypeSingular?.toLowerCase() || 'proveedor'}
        </button>
      </div>

      <div className="entities-toolbar">
        <input
          className="entities-search"
          type="text"
          placeholder={`🔍 Buscar ${entityTypeSingular?.toLowerCase() || 'proveedor'}...`}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="entities-loading">Cargando...</div>
      ) : filtered.length === 0 ? (
        <div className="entities-empty">
          <p>No hay {entityTypeName?.toLowerCase() || 'proveedores'} todavía.</p>
        </div>
      ) : (
        <div className="entities-grid">
          {filtered.map(entity => {
            const [bgColor, textColor] = getAvatarColor(entity.name)
            const summary = getNegotiationSummary(entity.negotiation_entities)
            return (
              <div key={entity.id} className="entity-card" onClick={() => setSelectedEntity(entity)}>
                <div className="entity-card-header">
                  <div className="entity-avatar" style={{ backgroundColor: bgColor, color: textColor }}>
                    {getInitials(entity.name)}
                  </div>
                  <div className="entity-info">
                    <h3 className="entity-name">
                      {entity.country_code && (
                        <img src={getFlagUrl(entity.country_code)} alt={entity.country_code} className="entity-flag" />
                      )}
                      {entity.name}
                    </h3>
                    {entity.country_code && (
                      <p className="entity-country">{getCountryName(entity.country_code)}</p>
                    )}
                  </div>
                </div>
                <div className="entity-card-footer">
                  {summary ? (
                    <div className="entity-state-badges">
                      {Object.entries(summary).map(([status, count]) => {
                        const cfg = getStateConfig(status)
                        return (
                          <span key={status} className="entity-state-badge" style={{ backgroundColor: cfg.bg_color, color: cfg.color }}>
                            {count} {status}
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <span className="entity-no-projects">Sin proyectos</span>
                  )}
                </div>
              </div>
            )
          })}

          <div className="entity-card entity-card-new" onClick={() => setShowModal(true)}>
            <span>+ Nuevo {entityTypeSingular?.toLowerCase() || 'proveedor'}</span>
          </div>
        </div>
      )}

      {showModal && (
        <EntityModal
          onClose={() => setShowModal(false)}
          onCreated={fetchEntities}
          entityTypeSingular={entityTypeSingular}
        />
      )}

      {selectedEntity && (
        <EntityDetailModal
          entity={selectedEntity}
          negotiationStates={negotiationStates}
          onClose={() => setSelectedEntity(null)}
          onUpdated={fetchEntities}
          entityTypeName={entityTypeName}
          entityTypeSingular={entityTypeSingular}
        />
      )}
    </div>
  )
}

function EntityDetailModal({ entity, negotiationStates, onClose, onUpdated, entityTypeName, entityTypeSingular }) {
  const [showEditModal, setShowEditModal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [bgColor, textColor] = getAvatarColor(entity.name)
  const negs = entity.negotiation_entities?.map(n => n.negotiation).filter(Boolean) || []

  function getStateConfig(stateName) {
    const found = negotiationStates.find(s => s.name === stateName)
    return found || { color: '#64748B', bg_color: '#F1F5F9' }
  }

  async function handleDelete() {
    await supabase.from('entities').delete().eq('id', entity.id)
    onUpdated()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="entity-detail-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{entity.name}</h2>
          <div className="detail-header-actions">
            <button className="btn-edit" onClick={() => setShowEditModal(true)}>✏️ Editar</button>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="entity-detail-body">
          <div className="entity-detail-hero">
            <div className="entity-avatar-large" style={{ backgroundColor: bgColor, color: textColor }}>
              {getInitials(entity.name)}
            </div>
            <div className="entity-detail-info">
              <div className="entity-detail-name">
                {entity.country_code && (
                  <img src={getFlagUrl(entity.country_code)} alt={entity.country_code} style={{ width: 20, borderRadius: 2 }} />
                )}
                {entity.name}
              </div>
              {entity.country_code && (
                <div className="entity-detail-country">{getCountryName(entity.country_code)}</div>
              )}
              {entity.custom_fields?.company_type && (
                <div className="entity-detail-type">{entity.custom_fields.company_type}</div>
              )}
            </div>
          </div>

          {entity.contacts?.length > 0 && (
            <div className="detail-section">
              <div className="detail-section-title">Contactos</div>
              <div className="contacts-list">
                {entity.contacts.map(contact => (
                  <div key={contact.id} className="contact-card">
                    <div className="contact-card-header">
                      <div className="contact-name">{contact.name}</div>
                      {contact.role && <div className="contact-role">{contact.role}</div>}
                    </div>
                    <div className="contact-card-details">
                      {contact.email && (
                        <a href={`mailto:${contact.email}`} className="contact-detail">
                          <span className="contact-icon">✉</span>{contact.email}
                        </a>
                      )}
                      {contact.phone && (
                        <a href={`tel:${contact.phone}`} className="contact-detail">
                          <span className="contact-icon">📞</span>{contact.phone}
                        </a>
                      )}
                    </div>
                    {contact.notes && <div className="contact-notes">{contact.notes}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {entity.website && (
            <div className="detail-section">
              <div className="detail-section-title">Web</div>
              <a href={entity.website} target="_blank" rel="noreferrer" className="detail-link">{entity.website}</a>
            </div>
          )}

          <div className="detail-section">
            <div className="detail-section-title">Proyectos ({negs.length})</div>
            {negs.length === 0 ? (
              <p className="detail-empty">Sin proyectos todavía.</p>
            ) : (
              <div className="detail-negs-list">
                {negs.map(neg => {
                  const cfg = getStateConfig(neg.status)
                  return (
                    <div key={neg.id} className="detail-neg-row">
                      <span className="detail-neg-title">{neg.title}</span>
                      <span className="detail-neg-badge" style={{ backgroundColor: cfg.bg_color, color: cfg.color }}>
                        {neg.status}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="detail-footer">
          {!confirmDelete ? (
            <button className="btn-delete" onClick={() => setConfirmDelete(true)}>
              Eliminar {entityTypeSingular?.toLowerCase() || 'proveedor'}
            </button>
          ) : (
            <div className="delete-confirm">
              <span>¿Seguro?</span>
              <button className="btn-delete-confirm" onClick={handleDelete}>Sí, eliminar</button>
              <button className="btn-secondary" onClick={() => setConfirmDelete(false)}>Cancelar</button>
            </div>
          )}
        </div>
      </div>

      {showEditModal && (
        <EntityModal
          initial={entity}
          onClose={() => setShowEditModal(false)}
          onCreated={() => { onUpdated(); onClose() }}
          entityTypeSingular={entityTypeSingular}
        />
      )}
    </div>
  )
}