import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import EntityModal from '../components/EntityModal'
import ImportEntitiesModal from '../components/ImportEntitiesModal'
import { NegotiationDetail, NegotiationModal } from './Negotiations'
import { getFlagUrl, getCountryName } from '../components/CountrySelector'
import DeleteConfirmModal from '../components/DeleteConfirmModal'
import NotesPostIts from '../components/NotesPostIts'
import ActivityTimeline from '../components/ActivityTimeline'
import Documents from '../components/Documents'
import { notifyTaskAssigned } from '../lib/tasks'
import { logActivity } from '../lib/activity'
import { formatAmount } from '../components/DealMilestones'
import { CustomFieldReadOnly } from '../components/CustomFieldInput'
import { computeFieldOrder, getCustomFieldValue, renderCustomFieldDisplay } from '../lib/customFields'
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
  const { workspaceId, activeWorkspace, effectiveRole } = useAuth()
  const canBulkDelete = effectiveRole === 'owner'
  const canImport = effectiveRole === 'owner' || effectiveRole === 'admin' || effectiveRole === 'editor'
  const location = useLocation()
  const navigate = useNavigate()
  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [view, setView] = useState('cards')
  const [showModal, setShowModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [selectedEntity, setSelectedEntity] = useState(null)
  const [negotiationStates, setNegotiationStates] = useState([])
  const [entityFieldDefs, setEntityFieldDefs] = useState([])
  const [negotiationFieldDefs, setNegotiationFieldDefs] = useState([])
  const [exportingPdf, setExportingPdf] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false)
  const [bulkWorking, setBulkWorking] = useState(false)

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleBulkDelete() {
    setBulkWorking(true)
    await supabase.from('entities').delete().in('id', [...selectedIds])
    setSelectedIds(new Set())
    setShowBulkDeleteConfirm(false)
    setBulkWorking(false)
    fetchEntities()
  }

  async function handleExportEntitiesPdf() {
    setExportingPdf(true)
    try {
      const { exportAllEntitiesPdf } = await import('../lib/exportEntitiesPdf')
      await exportAllEntitiesPdf({
        workspaceId,
        customStates: negotiationStates,
        workspaceName: activeWorkspace?.name,
      })
    } finally {
      setExportingPdf(false)
    }
  }

  useEffect(() => {
    fetchEntities()
    fetchNegotiationStates()
    fetchCustomFieldDefs()
    setSelectedIds(new Set())
  }, [entityTypeId])

  async function fetchCustomFieldDefs() {
    const { data } = await supabase
      .from('custom_field_definitions')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('sort_order')
    setEntityFieldDefs((data || []).filter(d => d.object_type === 'entity'))
    setNegotiationFieldDefs((data || []).filter(d => d.object_type === 'negotiation'))
  }

  // Si viene de la búsqueda global (u otra pantalla), abre directo el detalle
  useEffect(() => {
    const openEntityId = new URLSearchParams(location.search).get('openEntity')
    if (!openEntityId || entities.length === 0) return
    const found = entities.find(e => e.id === openEntityId)
    if (found) {
      setSelectedEntity(found)
      navigate(`/entities/${entityTypeId}`, { replace: true })
    }
  }, [location.search, entities])

  async function fetchEntities() {
    setLoading(true)
    const { data: entitiesData, error } = await supabase
      .from('entities')
      .select(`*, entity_type:entity_type_id ( name, color ), contacts ( id, name, role, email, phone, whatsapp, notes, is_primary )`)
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
        .select('id, product, title, status, target_date, last_activity_at, activity_status, workspace_id')
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
        {canImport && (
          <button
            className="entities-export-btn"
            onClick={() => setShowImportModal(true)}
            title={`Importar ${entityTypeName?.toLowerCase() || 'proveedores'} desde Excel/CSV`}
          >
            ⬆ Importar
          </button>
        )}
        <button
          className="entities-export-btn"
          onClick={handleExportEntitiesPdf}
          disabled={exportingPdf}
          title="Exportar todas las entidades (todos los tipos) a PDF"
        >
          {exportingPdf ? 'Generando…' : '⬇ Exportar PDF'}
        </button>
      </div>

      {showImportModal && (
        <ImportEntitiesModal
          entityTypeId={entityTypeId}
          entityTypeSingular={entityTypeSingular}
          entityTypeName={entityTypeName}
          workspaceId={workspaceId}
          onClose={() => setShowImportModal(false)}
          onImported={fetchEntities}
        />
      )}

      {canBulkDelete && selectedIds.size > 0 && (
        <div className="entities-bulk-bar">
          <span className="entities-bulk-count">
            {selectedIds.size} seleccionado{selectedIds.size !== 1 ? 's' : ''}
            <button className="neg-pipeline-clear" onClick={() => setSelectedIds(new Set())}>Deseleccionar</button>
          </span>
          <button className="neg-bulk-delete-btn" disabled={bulkWorking} onClick={() => setShowBulkDeleteConfirm(true)}>
            🗑 Eliminar ({selectedIds.size})
          </button>
        </div>
      )}

      {showBulkDeleteConfirm && (
        <DeleteConfirmModal
          itemName="ELIMINAR"
          itemType={`${selectedIds.size} ${selectedIds.size === 1 ? (entityTypeSingular?.toLowerCase() || 'entidad') : (entityTypeName?.toLowerCase() || 'entidades')}`}
          onConfirm={handleBulkDelete}
          onCancel={() => setShowBulkDeleteConfirm(false)}
        />
      )}

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
          canBulkDelete={canBulkDelete}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
        />
      ) : (
        <div className="entities-grid">
          {filtered.map(entity => {
            const [bgColor, textColor] = getAvatarColor(entity.name)
            const counts = getStateCounts(entity.negotiation_entities)
            return (
              <div key={entity.id} className="entity-card" onClick={() => setSelectedEntity(entity)}>
                {canBulkDelete && (
                  <input
                    type="checkbox"
                    className="entity-card-checkbox"
                    checked={selectedIds.has(entity.id)}
                    onClick={e => e.stopPropagation()}
                    onChange={() => toggleSelect(entity.id)}
                  />
                )}
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
          customFieldDefs={entityFieldDefs}
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
          entityFieldDefs={entityFieldDefs}
          negotiationFieldDefs={negotiationFieldDefs}
        />
      )}
    </div>
  )
}

function EntitiesTable({ entities, negotiationStates, getStateConfig, getStateCounts, onSelect, canBulkDelete, selectedIds, onToggleSelect }) {
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
            {canBulkDelete && (
              <input
                type="checkbox"
                className="entities-list-checkbox"
                checked={selectedIds.has(entity.id)}
                onClick={e => e.stopPropagation()}
                onChange={() => onToggleSelect(entity.id)}
              />
            )}
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

function EntityDetailModal({ entity, negotiationStates, entities, onClose, onUpdated, entityTypeName, entityTypeSingular, getStateConfig, entityFieldDefs = [], negotiationFieldDefs = [] }) {
  const { workspaceId, user, effectiveRole } = useAuth()
  const canDelete = effectiveRole === 'owner'
  const canCreateProject = effectiveRole === 'owner' || effectiveRole === 'admin' || effectiveRole === 'editor'
  const canNote = effectiveRole !== 'viewer'
  const canTask = effectiveRole !== 'viewer'
  const [showEditModal, setShowEditModal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showAllNegs, setShowAllNegs] = useState(false)
  const [selectedNeg, setSelectedNeg] = useState(null)
  const [editingNeg, setEditingNeg] = useState(null)
  const [showNegModal, setShowNegModal] = useState(false)
  const [bgColor, textColor] = getAvatarColor(entity.name)
  const [activityRefresh, setActivityRefresh] = useState(0)
  const [rightTab, setRightTab] = useState('resumen')
  const [entityTasks, setEntityTasks] = useState([])
  const [members, setMembers] = useState([])
  const [fieldOrder, setFieldOrder] = useState(null)
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskAssignee, setNewTaskAssignee] = useState('')
  const [newTaskDue, setNewTaskDue] = useState('')
  const [savingTask, setSavingTask] = useState(false)
  const [scorecard, setScorecard] = useState({ pipeline: [], pendingProjectTasks: 0 })

  useEffect(() => { fetchEntityTasks(); fetchMembers(); fetchFieldOrder() }, [entity.id])

  useEffect(() => {
    const negIds = (entity.negotiation_entities || []).map(n => n.negotiation?.id).filter(Boolean)
    if (negIds.length === 0) { setScorecard({ pipeline: [], pendingProjectTasks: 0 }); return }
    Promise.all([
      supabase.from('negotiations').select('id, currency').in('id', negIds),
      supabase.from('deal_milestones').select('negotiation_id, amount').in('negotiation_id', negIds),
      supabase.from('tasks').select('id, status').in('negotiation_id', negIds),
    ]).then(([{ data: negCurrency }, { data: milestones }, { data: projectTasks }]) => {
      const currencyByNeg = {}
      for (const n of negCurrency || []) currencyByNeg[n.id] = n.currency || 'USD'
      const totals = {}
      for (const m of milestones || []) {
        const cur = currencyByNeg[m.negotiation_id] || 'USD'
        totals[cur] = (totals[cur] || 0) + Number(m.amount)
      }
      const pipeline = Object.entries(totals).map(([currency, total]) => ({ currency, total })).sort((a, b) => b.total - a.total)
      const pendingProjectTasks = (projectTasks || []).filter(t => t.status !== 'done').length
      setScorecard({ pipeline, pendingProjectTasks })
    })
  }, [entity.id])

  async function fetchEntityTasks() {
    const { data } = await supabase.from('tasks')
      .select('*, profile:assigned_to ( full_name )')
      .eq('entity_id', entity.id)
      .order('created_at', { ascending: false })
    if (data) setEntityTasks(data)
  }

  async function fetchMembers() {
    const { data } = await supabase.from('workspace_members')
      .select('user_id, profile:user_id ( full_name, email )')
      .eq('workspace_id', workspaceId)
    if (data) setMembers(data)
  }

  async function fetchFieldOrder() {
    const { data } = await supabase.from('workspaces').select('field_order').eq('id', workspaceId).single()
    setFieldOrder(data?.field_order || {})
  }

  async function handleAddEntityTask() {
    if (!newTaskTitle.trim()) return
    setSavingTask(true)
    const { data, error } = await supabase.from('tasks').insert({
      workspace_id: workspaceId,
      entity_id: entity.id,
      title: newTaskTitle.trim(),
      assigned_to: newTaskAssignee || null,
      due_date: newTaskDue || null,
      status: 'pending',
      priority: 'medium',
      created_by: user?.id,
    }).select('id, title').single()
    setSavingTask(false)
    if (error) return
    if (data) {
      await notifyTaskAssigned(supabase, { workspaceId, task: data, assignedTo: newTaskAssignee, actingUserId: user?.id })
      await logActivity(supabase, {
        workspaceId, entityId: entity.id, type: 'task_created',
        title: `Tarea creada: "${data.title}"`, actorId: user?.id,
      })
    }
    setNewTaskTitle('')
    setNewTaskAssignee('')
    setNewTaskDue('')
    setShowTaskForm(false)
    fetchEntityTasks()
    setActivityRefresh(v => v + 1)
  }

  async function handleCompleteEntityTask(task) {
    if (task.status === 'done') return
    await supabase.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', task.id)
    await logActivity(supabase, {
      workspaceId, entityId: entity.id, type: 'task_completed',
      title: `Tarea completada: "${task.title}"`, actorId: user?.id,
    })
    fetchEntityTasks()
    setActivityRefresh(v => v + 1)
  }

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
            <div className="entity-avatar" style={{ width: 38, height: 38, fontSize: 13, backgroundColor: bgColor, color: textColor, flexShrink: 0 }}>
              {getInitials(entity.name)}
            </div>
            <div style={{ minWidth: 0 }}>
              <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                {entity.country_code && <img src={getFlagUrl(entity.country_code)} alt="" style={{ width: 18, borderRadius: 2, flexShrink: 0 }} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{entity.name}</span>
              </h2>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
                {entity.country_code && getCountryName(entity.country_code)}
                {(() => {
                  const companyTypeDef = entityFieldDefs.find(d => d.key === 'company_type')
                  if (!companyTypeDef) return null
                  const text = renderCustomFieldDisplay(companyTypeDef, getCustomFieldValue(entity.custom_fields, companyTypeDef.key))
                  return text !== '—' ? ` · ${text}` : null
                })()}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <button className="btn-edit" onClick={() => setShowEditModal(true)}>✏️ Editar</button>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="entity-detail-body entity-detail-body--cols">

          {/* Columna izquierda — info + contactos */}
          <div className="entity-detail-col entity-detail-col--left">
            <div className="detail-section">
              <div className="detail-section-title">Información</div>
              {(fieldOrder === null ? entityFieldDefs.map(d => d.key) : computeFieldOrder('entity', fieldOrder, entityFieldDefs)).map(key => {
                const def = entityFieldDefs.find(d => d.key === key)
                if (!def || def.field_type === 'entity_type' || def.field_type === 'contacts') return null
                const value = def.storage_column ? entity[def.storage_column] : getCustomFieldValue(entity.custom_fields, def.key)
                if (value === undefined || value === null || value === '') return null
                return (
                  <div key={key} className="entity-info-row">
                    <span className="entity-info-label">{def.label}</span>
                    <span className="entity-info-val"><CustomFieldReadOnly def={def} value={value} members={members} /></span>
                  </div>
                )
              })}
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
                        {contact.whatsapp && (
                          <a href={`https://wa.me/${contact.whatsapp.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer" className="contact-detail">
                            <span className="contact-icon">💬</span>{contact.whatsapp}
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

          {/* Columna derecha — actividad / proyectos / notas / tareas, a pestañas */}
          <div className="entity-detail-col entity-detail-col--right">
            <div className="entity-tabs">
              {[
                { key: 'resumen', label: 'Resumen' },
                { key: 'actividad', label: 'Actividad' },
                { key: 'proyectos', label: `Proyectos (${negs.length})` },
                { key: 'notas', label: 'Notas' },
                { key: 'tareas', label: 'Tareas' },
                { key: 'documentos', label: 'Documentos' },
              ].map(tab => (
                <button
                  key={tab.key}
                  className={`entity-tab ${rightTab === tab.key ? 'active' : ''}`}
                  onClick={() => setRightTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {rightTab === 'resumen' && (
              <EntityScorecard
                entity={entity}
                negs={negs}
                counts={counts}
                getStateConfig={getStateConfig}
                scorecard={scorecard}
                entityTasksPending={entityTasks.filter(t => t.status !== 'done').length}
                entityTypeSingular={entityTypeSingular}
              />
            )}

            {rightTab === 'actividad' && (
              <ActivityTimeline entityId={entity.id} refreshKey={activityRefresh} />
            )}

            {rightTab === 'notas' && (
              <NotesPostIts
                entityId={entity.id}
                workspaceId={workspaceId}
                canEdit={canNote}
                onChanged={() => setActivityRefresh(v => v + 1)}
                contextLabel={entity.name}
              />
            )}

            {rightTab === 'documentos' && (
              <Documents
                entityId={entity.id}
                workspaceId={workspaceId}
                canEdit={canNote}
                onChanged={() => setActivityRefresh(v => v + 1)}
              />
            )}

            {rightTab === 'tareas' && (
              <div>
                {canTask && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                    <button className="entity-negs-new-btn" onClick={() => setShowTaskForm(v => !v)}>+ Nueva tarea</button>
                  </div>
                )}
                {showTaskForm && (
                  <div className="neg-note-add" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
                    <input
                      type="text"
                      className="neg-note-input"
                      placeholder="¿Qué hay que hacer?"
                      value={newTaskTitle}
                      onChange={e => setNewTaskTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleAddEntityTask() }}
                      autoFocus
                    />
                    <select value={newTaskAssignee} onChange={e => setNewTaskAssignee(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, border: '1px solid #e5e7eb', fontSize: 13 }}>
                      <option value="">Sin asignar</option>
                      {members.map(m => <option key={m.user_id} value={m.user_id}>{m.profile?.full_name || m.profile?.email || 'Usuario'}</option>)}
                    </select>
                    <input type="date" className="neg-note-date-input" value={newTaskDue} onChange={e => setNewTaskDue(e.target.value)} />
                    <button className="neg-add-task-btn" onClick={handleAddEntityTask} disabled={savingTask || !newTaskTitle.trim()}>
                      + Agregar
                    </button>
                  </div>
                )}
                {entityTasks.length === 0 ? (
                  <p className="detail-empty">Sin tareas todavía.</p>
                ) : (
                  <div className="neg-tasks-list">
                    {entityTasks.map(task => (
                      <div key={task.id} className={`neg-task-row ${task.status === 'done' ? 'done' : ''}`}>
                        <button
                          className={`neg-task-check ${task.status === 'done' ? 'checked' : ''}`}
                          onClick={() => canTask && handleCompleteEntityTask(task)}
                          disabled={!canTask || task.status === 'done'}
                        >
                          {task.status === 'done' ? '✓' : ''}
                        </button>
                        <div className="neg-task-body">
                          <span className="neg-task-title">
                            {task.profile?.full_name && <span style={{ color: '#1D4ED8', fontWeight: 600 }}>@{task.profile.full_name}: </span>}
                            {task.title}
                          </span>
                        </div>
                        {task.due_date && <span className="neg-task-date">{new Date(task.due_date).toLocaleDateString('es-AR')}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {rightTab === 'proyectos' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                  {canCreateProject && (
                    <button className="entity-negs-new-btn" onClick={() => { setEditingNeg(null); setShowNegModal(true) }}>+ Nuevo proyecto</button>
                  )}
                </div>

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
          customFieldDefs={entityFieldDefs}
        />
      )}

      {showNegModal && (
        <NegotiationModal
          initial={editingNeg}
          presetEntity={!editingNeg ? entity : undefined}
          entities={entities}
          members={members}
          customStates={customStates}
          customFieldDefs={negotiationFieldDefs}
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
          customFieldDefs={negotiationFieldDefs}
          members={members}
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

function relativeDaysLabel(date) {
  const days = Math.floor((Date.now() - date) / 86400000)
  if (days <= 0) return 'hoy'
  if (days === 1) return 'ayer'
  return `hace ${days} días`
}

function EntityScorecard({ entity, negs, counts, getStateConfig, scorecard, entityTasksPending, entityTypeSingular }) {
  const completedCount = negs.filter(n => n.status === 'Completado').length
  const pendingTasks = scorecard.pendingProjectTasks + entityTasksPending
  const maxCount = Math.max(1, ...Object.values(counts))

  const lastActivityDate = negs.reduce((max, n) => {
    if (!n.last_activity_at) return max
    const d = new Date(n.last_activity_at)
    return (!max || d > max) ? d : max
  }, null)
  const inactiveCount = negs.filter(n => n.activity_status === 'inactive').length
  const pausedCount = negs.filter(n => n.activity_status === 'paused').length

  if (negs.length === 0) {
    return <p className="detail-empty">Sin proyectos todavía — el resumen aparece cuando haya al menos uno.</p>
  }

  return (
    <div className="entity-scorecard">
      <div className="entity-proj-stats">
        <div className="entity-proj-stat">
          <div className="entity-proj-stat-n" style={{ color: '#0B1F3A' }}>{negs.length}</div>
          <div className="entity-proj-stat-lbl">Proyectos</div>
        </div>
        <div className="entity-proj-stat">
          <div className="entity-proj-stat-n" style={{ color: '#059669' }}>{completedCount}</div>
          <div className="entity-proj-stat-lbl">Completados</div>
        </div>
        <div className="entity-proj-stat">
          <div className="entity-proj-stat-n" style={{ color: '#D97706' }}>{negs.length - completedCount}</div>
          <div className="entity-proj-stat-lbl">En curso</div>
        </div>
        <div className="entity-proj-stat">
          <div className="entity-proj-stat-n" style={{ color: '#DC2626' }}>{pendingTasks}</div>
          <div className="entity-proj-stat-lbl">Tareas pend.</div>
        </div>
      </div>

      {scorecard.pipeline.length > 0 && (
        <div className="detail-section" style={{ marginTop: 18 }}>
          <div className="detail-section-title">Valor de pipeline</div>
          <div className="entity-info-val" style={{ fontSize: 16, fontWeight: 700, color: '#0B1F3A' }}>
            {scorecard.pipeline.map(p => `${formatAmount(p.total)} ${p.currency}`).join('   ·   ')}
          </div>
        </div>
      )}

      <div className="detail-section" style={{ marginTop: 18 }}>
        <div className="detail-section-title">Distribución por estado</div>
        <div className="scorecard-bars">
          {Object.entries(counts).map(([status, count]) => {
            const cfg = getStateConfig(status)
            return (
              <div key={status} className="scorecard-bar-row">
                <span className="scorecard-bar-label">{status}</span>
                <div className="scorecard-bar-track">
                  <div className="scorecard-bar-fill" style={{ width: `${(count / maxCount) * 100}%`, background: cfg.color }} />
                </div>
                <span className="scorecard-bar-count">{count}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="detail-section" style={{ marginTop: 18 }}>
        <div className="detail-section-title">Actividad</div>
        <div className="entity-info-row">
          <span className="entity-info-label">Última actividad</span>
          <span className="entity-info-val">{lastActivityDate ? relativeDaysLabel(lastActivityDate) : 'Sin registro'}</span>
        </div>
        {(inactiveCount > 0 || pausedCount > 0) && (
          <div className="entity-info-row">
            <span className="entity-info-label">Atención</span>
            <span className="entity-info-val">
              {[inactiveCount > 0 && `💤 ${inactiveCount} inactivo${inactiveCount > 1 ? 's' : ''}`, pausedCount > 0 && `⏸ ${pausedCount} pausado${pausedCount > 1 ? 's' : ''}`]
                .filter(Boolean).join('   ·   ')}
            </span>
          </div>
        )}
        {entity.created_at && (
          <div className="entity-info-row">
            <span className="entity-info-label">{entityTypeSingular || 'Entidad'} desde</span>
            <span className="entity-info-val">
              {new Date(entity.created_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </div>
        )}
      </div>

    </div>
  )
}
