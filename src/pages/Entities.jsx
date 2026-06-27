import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import EntityModal from '../components/EntityModal'
import { NegotiationDetail, NegotiationModal } from './Negotiations'
import { getFlagUrl, getCountryName } from '../components/CountrySelector'
import DeleteConfirmModal from '../components/DeleteConfirmModal'
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
  const { workspaceId } = useAuth()
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [view, setView] = useState('cards')
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
      .select(`*, entity_type:entity_type_id ( name, color ), contacts ( id, name, role, email, phone, notes, is_primary )`)
      .eq('entity_type_id', entityTypeId)
      .order('name')

    if (error) { setLoading(false); return }

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
        .select('id, product, title, status, nda, target_date, last_activity_at, activity_status, workspace_id')
        .in('id', negIds)
        .order('last_activity_at', { ascending: false })
      negsData = data || []
    }

    const combined = entitiesData.map(entity => ({
      ...entity,
      negotiation_entities: (negEntities || [])
        .filter(ne => ne.entity_id === entity.id)
        .map(ne => ({ ...ne, negotiation: negsData.find(n => n.id === ne.negotiation_id) || null }))
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

  function getStateCounts(negotiationEntities) {
    const negs = (negotiationEntities || []).map(n => n.negotiation).filter(Boolean)
    const counts = {}
    negs.forEach(n => { counts[n.status] = (counts[n.status] || 0) + 1 })
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
        <div className="entities-view-toggle">
          <button className={view === 'cards' ? 'active' : ''} onClick={() => setView('cards')} title="Mosaico">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="1" width="6" height="6" rx="1.5"/><rect x="9" y="1" width="6" height="6" rx="1.5"/>
              <rect x="1" y="9" width="6" height="6" rx="1.5"/><rect x="9" y="9" width="6" height="6" rx="1.5"/>
            </svg>
          </button>
          <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')} title="Tabla">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="1" width="14" height="14" rx="2"/>
              <line x1="1" y1="5.5" x2="15" y2="5.5"/><line x1="1" y1="10" x2="15" y2="10"/>
              <line x1="5" y1="5.5" x2="5" y2="15"/>
            </svg>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="entities-loading">Cargando...</div>
      ) : filtered.length === 0 ? (
        <div className="entities-empty"><p>No hay {entityTypeName?.toLowerCase() || 'proveedores'} todavía.</p></div>
      ) : view === 'table' ? (
        <EntitiesTable
          entities={filtered}
          negotiationStates={negotiationStates}
          getStateConfig={getStateConfig}
          getStateCounts={getStateCounts}
          onSelect={setSelectedEntity}
        />
      ) : (
        <div className="entities-grid">
          {filtered.map(entity => {
            const [bgColor, textColor] = getAvatarColor(entity.name)
            const counts = getStateCounts(entity.negotiation_entities)
            return (
              <div key={entity.id} className="entity-card" onClick={() => setSelectedEntity(entity)}>
                <div className="entity-card-header">
                  <div className="entity-avatar" style={{ backgroundColor: bgColor, color: textColor }}>
                    {getInitials(entity.name)}
                  </div>
                  <div className="entity-info">
                    <h3 className="entity-name">
                      {entity.country_code && <img src={getFlagUrl(entity.country_code)} alt="" className="entity-flag" />}
                      {entity.name}
                    </h3>
                    {entity.country_code && <p className="entity-country">{getCountryName(entity.country_code)}</p>}
                  </div>
                </div>
                <div className="entity-card-footer">
                  {Object.keys(counts).length > 0 ? (
                    <div className="entity-state-badges">
                      {Object.entries(counts).map(([status, count]) => {
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
          entities={entities}
          onClose={() => setSelectedEntity(null)}
          onUpdated={fetchEntities}
          entityTypeName={entityTypeName}
          entityTypeSingular={entityTypeSingular}
          getStateConfig={getStateConfig}
        />
      )}
    </div>
  )
}

function EntitiesTable({ entities, negotiationStates, getStateConfig, getStateCounts, onSelect }) {
  return (
    <div className="entities-list">
      {entities.map(entity => {
        const [bgColor, textColor] = getAvatarColor(entity.name)
        const counts = getStateCounts(entity.negotiation_entities)
        const total = Object.values(counts).reduce((a, b) => a + b, 0)
        const contactCount = entity.contacts?.length || 0
        const subParts = [
          entity.country_code && getCountryName(entity.country_code),
          contactCount > 0 ? `${contactCount} contacto${contactCount !== 1 ? 's' : ''}` : 'sin contactos',
        ].filter(Boolean)
        return (
          <div key={entity.id} className="entities-list-row" onClick={() => onSelect(entity)}>
            <div className="entities-tbl-entity">
              <div className="entity-avatar" style={{ width: 32, height: 32, fontSize: 11, backgroundColor: bgColor, color: textColor, flexShrink: 0 }}>
                {getInitials(entity.name)}
              </div>
              <div>
                <div className="entities-tbl-name">
                  {entity.country_code && <img src={getFlagUrl(entity.country_code)} alt="" className="entity-flag" />}
                  {entity.name}
                </div>
                <div className="entities-tbl-country">{subParts.join(' · ')}</div>
              </div>
            </div>
            <div className="entities-list-stats">
              <div className="entities-list-vdiv" />
              <div className="entities-list-stat">
                <div className="entities-list-stat-n">{total}</div>
                <div className="entities-list-stat-l">Total</div>
              </div>
              {negotiationStates.flatMap(s => [
                <div key={`div-${s.name}`} className="entities-list-vdiv" />,
                <div key={s.name} className="entities-list-stat">
                  <div className="entities-list-stat-n" style={{ color: counts[s.name] ? s.color : '#d1d5db' }}>
                    {counts[s.name] || '—'}
                  </div>
                  <div className="entities-list-stat-l">{s.name}</div>
                </div>
              ])}
            </div>
            <span className="entities-list-arrow">›</span>
          </div>
        )
      })}
    </div>
  )
}

function EntityDetailModal({ entity, negotiationStates, entities, onClose, onUpdated, entityTypeName, entityTypeSingular, getStateConfig }) {
  const { workspaceId, user, effectiveRole } = useAuth()
  const canDelete = effectiveRole === 'owner'
  const [showEditModal, setShowEditModal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showAllNegs, setShowAllNegs] = useState(false)
  const [selectedNeg, setSelectedNeg] = useState(null)
  const [editingNeg, setEditingNeg] = useState(null)
  const [showNegModal, setShowNegModal] = useState(false)
  const [bgColor, textColor] = getAvatarColor(entity.name)

  const negs = (entity.negotiation_entities || [])
    .map(n => n.negotiation)
    .filter(Boolean)
    .sort((a, b) => new Date(b.last_activity_at || 0) - new Date(a.last_activity_at || 0))

  const counts = {}
  negs.forEach(n => { counts[n.status] = (counts[n.status] || 0) + 1 })

  async function fetchFullNeg(neg) {
    const [{ data: full }, { data: ents }, { data: notesList }] = await Promise.all([
      supabase.from('negotiations').select('*').eq('id', neg.id).single(),
      supabase.from('negotiation_entities').select('negotiation_id, entity_id, entity:entity_id(id, name, country_code)').eq('negotiation_id', neg.id),
      supabase.from('negotiation_notes').select('id, negotiation_id, content, note_date').eq('negotiation_id', neg.id).order('note_date'),
    ])
    if (!full) return null
    return { ...full, negotiation_entities: ents || [], notes_list: notesList || [] }
  }

  async function handleSelectNeg(neg) {
    const full = await fetchFullNeg(neg)
    if (full) setSelectedNeg(full)
  }

  async function handleDelete() {
    await supabase.from('entities').delete().eq('id', entity.id)
    onUpdated()
    onClose()
  }

  function getEntityFlagForNeg(neg) {
    const firstEnt = neg.negotiation_entities?.[0]?.entity
    if (!firstEnt?.country_code) return null
    return getFlagUrl(firstEnt.country_code)
  }

  async function refetchNeg(id) {
    const [{ data: full }, { data: ents }, { data: notesList }] = await Promise.all([
      supabase.from('negotiations').select('*').eq('id', id).single(),
      supabase.from('negotiation_entities').select('negotiation_id, entity_id, entity:entity_id(id, name, country_code)').eq('negotiation_id', id),
      supabase.from('negotiation_notes').select('id, negotiation_id, content, note_date').eq('negotiation_id', id).order('note_date'),
    ])
    if (!full) return null
    return { ...full, negotiation_entities: ents || [], notes_list: notesList || [] }
  }

  const customStates = negotiationStates

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="entity-detail-card entity-detail-card--wide" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="entity-avatar" style={{ width: 38, height: 38, fontSize: 13, backgroundColor: bgColor, color: textColor, flexShrink: 0 }}>
              {getInitials(entity.name)}
            </div>
            <div>
              <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {entity.country_code && <img src={getFlagUrl(entity.country_code)} alt="" style={{ width: 18, borderRadius: 2 }} />}
                {entity.name}
              </h2>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
                {entity.country_code && getCountryName(entity.country_code)}
                {entity.custom_fields?.company_type && ` · ${entity.custom_fields.company_type}`}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn-edit" onClick={() => setShowEditModal(true)}>✏️ Editar</button>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="entity-detail-body entity-detail-body--cols">

          {/* Columna izquierda — info + contactos */}
          <div className="entity-detail-col entity-detail-col--left">
            <div className="detail-section">
              <div className="detail-section-title">Información</div>
              {entity.website && (
                <div className="entity-info-row">
                  <span className="entity-info-label">Sitio web</span>
                  <a href={entity.website} target="_blank" rel="noreferrer" className="detail-link">{entity.website}</a>
                </div>
              )}
              {entity.country_code && (
                <div className="entity-info-row">
                  <span className="entity-info-label">País</span>
                  <span className="entity-info-val">{getCountryName(entity.country_code)}</span>
                </div>
              )}
              {entity.custom_fields?.company_type && (
                <div className="entity-info-row">
                  <span className="entity-info-label">Tipo</span>
                  <span className="entity-info-val">{entity.custom_fields.company_type}</span>
                </div>
              )}
            </div>

            {entity.contacts?.length > 0 && (
              <div className="detail-section">
                <div className="detail-section-title">Contactos</div>
                <div className="contacts-list">
                  {entity.contacts.map(contact => (
                    <div key={contact.id} className="contact-card">
                      <div className="contact-card-header">
                        <div className="contact-name">{contact.name}</div>
                        {contact.is_primary && (
                          <span style={{ fontSize: 10, background: '#EFF6FF', color: '#1D4ED8', padding: '1px 7px', borderRadius: 99, fontWeight: 600 }}>Principal</span>
                        )}
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

            {canDelete && (
              <div className="detail-footer-inline">
                <button className="btn-delete" onClick={() => setConfirmDelete(true)}>
                  Eliminar {entityTypeSingular?.toLowerCase() || 'proveedor'}
                </button>
              </div>
            )}
          </div>

          {/* Columna derecha — proyectos */}
          <div className="entity-detail-col entity-detail-col--right">
            <div className="detail-section-title" style={{ marginBottom: 12 }}>Proyectos ({negs.length})</div>

            {negs.length === 0 ? (
              <p className="detail-empty">Sin proyectos todavía.</p>
            ) : (
              <>
                {/* Stats chips por estado */}
                {Object.keys(counts).length > 0 && (
                  <div className="entity-proj-stats">
                    {Object.entries(counts).map(([status, count]) => {
                      const cfg = getStateConfig(status)
                      return (
                        <div key={status} className="entity-proj-stat">
                          <div className="entity-proj-stat-n" style={{ color: cfg.color }}>{count}</div>
                          <div className="entity-proj-stat-lbl">{status}</div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Lista de proyectos */}
                {(() => {
                  const THRESHOLD = 5
                  const visibleNegs = showAllNegs ? negs : negs.slice(0, THRESHOLD)
                  return (
                    <>
                      <div className="entity-negs-list">
                        {visibleNegs.map(neg => {
                          const cfg = getStateConfig(neg.status)
                          const isInactive = neg.activity_status === 'inactive'
                          const isPaused = neg.activity_status === 'paused'
                          return (
                            <div
                              key={neg.id}
                              className={`entity-neg-row ${isPaused ? 'entity-neg-row--paused' : ''} ${isInactive ? 'entity-neg-row--inactive' : ''}`}
                              onClick={() => handleSelectNeg(neg)}
                            >
                              <div className="entity-neg-main">
                                <div className="entity-neg-product">
                                  {isPaused && <span style={{ fontSize: 12, marginRight: 4, opacity: 0.5 }}>⏸</span>}
                                  {isInactive && <span style={{ fontSize: 12, marginRight: 4, color: '#0369a1' }}>💤</span>}
                                  {neg.product || neg.title}
                                </div>
                                {neg.target_date && (
                                  <div className="entity-neg-date">
                                    {new Date(neg.target_date + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                                  </div>
                                )}
                              </div>
                              <div className="entity-neg-right">
                                {neg.nda && neg.nda !== '—' && neg.nda !== 'No' && (
                                  <span className="entity-neg-nda">NDA ✓</span>
                                )}
                                <span className="entity-neg-badge" style={{ backgroundColor: cfg.bg_color, color: cfg.color }}>
                                  {neg.status}
                                </span>
                                <span className="entity-neg-arrow">›</span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      {negs.length > THRESHOLD && (
                        <button
                          className="entity-negs-toggle"
                          onClick={() => setShowAllNegs(v => !v)}
                        >
                          {showAllNegs
                            ? '▲ Ver menos'
                            : `▼ Ver todos los proyectos (${negs.length - THRESHOLD} más)`}
                        </button>
                      )}
                    </>
                  )
                })()}
              </>
            )}
          </div>
        </div>
      </div>

      {confirmDelete && (
        <DeleteConfirmModal
          itemName={entity.name}
          itemType={entityTypeSingular?.toLowerCase() || 'entidad'}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {showEditModal && (
        <EntityModal
          initial={entity}
          onClose={() => setShowEditModal(false)}
          onCreated={() => { onUpdated(); onClose() }}
          entityTypeSingular={entityTypeSingular}
        />
      )}

      {showNegModal && (
        <NegotiationModal
          initial={editingNeg}
          entities={entities}
          members={[]}
          customStates={customStates}
          onClose={() => { setShowNegModal(false); setSelectedNeg(null) }}
          onCancel={async () => {
            setShowNegModal(false)
            if (editingNeg) {
              const updated = await refetchNeg(editingNeg.id)
              setSelectedNeg(updated || editingNeg)
            }
          }}
          onSaved={async () => {
            setShowNegModal(false)
            if (editingNeg) {
              const updated = await refetchNeg(editingNeg.id)
              setSelectedNeg(updated || editingNeg)
            }
            onUpdated()
          }}
          workspaceId={workspaceId}
          userId={user?.id}
        />
      )}

      {selectedNeg && (
        <NegotiationDetail
          neg={selectedNeg}
          entities={entities}
          customStates={customStates}
          getStateConfig={getStateConfig}
          getEntityFlag={getEntityFlagForNeg}
          onClose={() => setSelectedNeg(null)}
          onEdit={() => { setEditingNeg(selectedNeg); setSelectedNeg(null); setShowNegModal(true) }}
          onDeleted={() => { setSelectedNeg(null); onUpdated() }}
          onActivityChanged={() => {}}
          onNotesChanged={() => {}}
        />
      )}
    </div>
  )
}
