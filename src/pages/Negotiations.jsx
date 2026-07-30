import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useCloseOnOutsideOrEscape } from '../lib/useCloseOnOutsideOrEscape'
import DeleteConfirmModal from '../components/DeleteConfirmModal'
import ImportNegotiationsModal from '../components/ImportNegotiationsModal'
import NotesPostIts from '../components/NotesPostIts'
import ActivityTimeline from '../components/ActivityTimeline'
import DealMilestones, { formatAmount } from '../components/DealMilestones'
import Documents from '../components/Documents'
import { isTaskBlocked, wouldCreateCycle, notifySuccessors, notifyTaskAssigned, dismissNotificationsForTask } from '../lib/tasks'
import { notifyNegotiationStatusChanged } from '../lib/notifications'
import { logActivity } from '../lib/activity'
import { getCustomFieldValue, renderCustomFieldDisplay, mergeCustomFieldValue, mergeCustomFieldValues } from '../lib/customFields'
import { CustomFieldInput, CustomFieldsFormSection } from '../components/CustomFieldInput'
import './Negotiations.css'

const TERRITORIES = ['ARG','BOL','BRA','CEAM','CHI','COL','ECU','MEX','PAR','PER','URU','VEN']
const COMPANIES = ['Ethical Nutrition','Millet','Roemmers','Siegfried','Sidus','Tuteur', 'Ceoderma']
const NDA_STATES = ['—','Enviado','En Revisión','Firmado']
const CURRENCIES = ['USD','EUR','GBP','ARS','BRL','MXN','CHF']

// Todas las columnas disponibles para la tabla
const ALL_COLUMNS = [
  { key: 'product',          label: 'Producto',         alwaysVisible: true  },
  { key: 'entities',         label: 'Proveedor'                              },
  { key: 'status',           label: 'Estado'                                 },
  { key: 'description',      label: 'Descripción'                            },
  { key: 'nda',              label: 'NDA'                                    },
  { key: 'territories',      label: 'Territorios'                            },
  { key: 'companies',        label: 'Empresas'                               },
  { key: 'target_date',      label: 'Fecha'                                  },
  { key: 'participants',     label: 'Participantes'                          },
  { key: 'notes',            label: 'Notas'                                  },
  { key: 'observations',     label: 'Aclaraciones'                           },
  { key: 'activity_status',  label: 'Actividad'                              },
  { key: 'last_activity_at', label: 'Últ. actividad'                         },
]

const DEFAULT_VISIBLE = ['product','entities','status','nda','territories','companies','target_date']

const ACTIVITY_LABELS = { active: 'En curso', paused: 'Pausado', inactive: 'Inactivo' }

// Valor de texto plano por columna para el export CSV — separado de
// renderCell/renderCardField porque esos devuelven JSX con badges/chips.
function getExportValue(key, neg, getEntityName, customFieldDefs) {
  switch (key) {
    case 'product': return neg.product || neg.title || ''
    case 'entities': return getEntityName(neg)
    case 'status': return neg.status || ''
    case 'description': return neg.description || ''
    case 'nda': return neg.nda || ''
    case 'territories': return (neg.territories || []).join(', ')
    case 'companies': return (neg.companies || []).join(', ')
    case 'target_date': return neg.target_date || ''
    case 'participants': return (neg.participants || []).join(', ')
    case 'notes': return (neg.notes_list || []).map(n => `${n.note_date}: ${n.content}`).join(' | ')
    case 'observations': return neg.observations || ''
    case 'activity_status': return ACTIVITY_LABELS[neg.activity_status] || ''
    case 'last_activity_at': return neg.last_activity_at ? neg.last_activity_at.slice(0, 10) : ''
    default: {
      const def = customFieldDefs?.find(d => d.key === key)
      if (!def) return ''
      const val = renderCustomFieldDisplay(def, getCustomFieldValue(neg.custom_fields, key))
      return val === '—' ? '' : val
    }
  }
}

// Excel real (.xlsx) en vez de CSV: evita de raíz los problemas de
// delimitador (coma vs ";" según configuración regional) y de codificación
// de acentos que sí aparecen con texto plano tipo CSV.
// xlsx/jspdf se cargan bajo demanda (import dinámico) para no sumarlos al
// bundle inicial de /negotiations — son acciones ocasionales, no parte del
// flujo principal de la página.
async function exportNegotiationsXlsx(negotiations, cols, getEntityName, customFieldDefs) {
  const XLSX = await import('xlsx')
  const visibleCols = cols.filter(c => c.visible)
  const headers = visibleCols.map(c => ALL_COLUMNS.find(x => x.key === c.key)?.label || customFieldDefs.find(d => d.key === c.key)?.label || c.key)
  const rows = [
    headers,
    ...negotiations.map(neg => visibleCols.map(c => getExportValue(c.key, neg, getEntityName, customFieldDefs))),
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = visibleCols.map(() => ({ wch: 22 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Proyectos')
  XLSX.writeFile(wb, `nerva-proyectos-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

function useColumnPrefs(userId, customFieldDefs) {
  const key = `nerva_col_prefs_${userId}`
  const [cols, setCols] = useState(() => {
    try {
      const saved = localStorage.getItem(key)
      if (saved) return JSON.parse(saved)
    } catch {}
    return ALL_COLUMNS.map(c => ({ key: c.key, visible: DEFAULT_VISIBLE.includes(c.key) }))
  })

  // Mergea cualquier columna que falte en las prefs guardadas — tanto las
  // estáticas de ALL_COLUMNS como los campos custom fetcheados del
  // workspace (que llegan async, después del primer render) — como oculta
  // por defecto.
  useEffect(() => {
    const allKnown = [...ALL_COLUMNS, ...customFieldDefs.map(d => ({ key: d.key }))]
    setCols(prev => {
      const known = new Set(prev.map(c => c.key))
      const missing = allKnown.filter(c => !known.has(c.key)).map(c => ({ key: c.key, visible: false }))
      return missing.length > 0 ? [...prev, ...missing] : prev
    })
  }, [customFieldDefs])

  function saveCols(newCols) {
    setCols(newCols)
    localStorage.setItem(key, JSON.stringify(newCols))
  }

  return [cols, saveCols]
}

export default function Negotiations() {
  const { user, workspaceId, effectiveRole, activeWorkspace } = useAuth()
  const canCreateProject = effectiveRole === 'owner' || effectiveRole === 'admin' || effectiveRole === 'editor'
  const canBulkDelete = effectiveRole === 'owner'
  const location = useLocation()
  const navigate = useNavigate()
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const exportMenuRef = useRef(null)
  const [negotiations, setNegotiations] = useState([])
  const [entities, setEntities] = useState([])
  const [members, setMembers] = useState([])
  const [customStates, setCustomStates] = useState([])
  const [customFieldDefs, setCustomFieldDefs] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState(() => (typeof window !== 'undefined' && window.innerWidth <= 860) ? 'cards' : 'table')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterEntity, setFilterEntity] = useState('')
  const [filterActivity, setFilterActivity] = useState('active')
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [selectedNeg, setSelectedNeg] = useState(null)
  const [editingNeg, setEditingNeg] = useState(null)
  const [showColEditor, setShowColEditor] = useState(false)
  const [cols, saveCols] = useColumnPrefs(user?.id, customFieldDefs)
  const allColumns = [...ALL_COLUMNS, ...customFieldDefs.map(d => ({ key: d.key, label: d.label }))]
  const [highlightTaskId, setHighlightTaskId] = useState(null)
  const [milestones, setMilestones] = useState([])
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false)
  const [bulkWorking, setBulkWorking] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)

  // Si viene del banner del dashboard, pre-filtra por baja actividad
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('filter') === 'low_activity') setFilterActivity('low_activity')
  }, [location.search])

  // Si viene de una notificación, abre directo el proyecto (y resalta la tarea)
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const openNeg = params.get('openNeg')
    if (!openNeg || negotiations.length === 0) return
    const found = negotiations.find(n => n.id === openNeg)
    if (found) {
      setSelectedNeg(found)
      setHighlightTaskId(params.get('openTask') || null)
      navigate('/negotiations', { replace: true })
    }
  }, [location.search, negotiations])

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [negsRes, entitiesRes, membersRes, statesRes, milestonesRes, customFieldsRes] = await Promise.all([
      supabase.from('negotiations').select('*, primary_entity:primary_entity_id(id, name, country_code)').order('created_at', { ascending: false }),
      supabase.from('entities').select('id, name, country_code').order('name'),
      supabase.from('workspace_members').select(`user_id, profile:user_id ( full_name )`).eq('workspace_id', workspaceId),
      supabase.from('custom_states').select('*').eq('object_type', 'negotiation').order('sort_order'),
      supabase.from('deal_milestones').select('negotiation_id, amount').eq('workspace_id', workspaceId),
      supabase.from('custom_field_definitions').select('*').eq('workspace_id', workspaceId).eq('object_type', 'negotiation').order('sort_order'),
    ])
    setCustomFieldDefs(customFieldsRes.data || [])

    if (negsRes.error) { setLoading(false); return }
    setMilestones(milestonesRes.data || [])

    const negIds = negsRes.data.map(n => n.id)
    const [{ data: negEntities }, { data: negNotes }] = await Promise.all([
      supabase
        .from('negotiation_entities')
        .select('negotiation_id, entity_id, role, entity:entity_id(id, name, country_code)')
        .in('negotiation_id', negIds),
      supabase
        .from('negotiation_notes')
        .select('id, negotiation_id, content, note_date')
        .in('negotiation_id', negIds)
        .order('note_date', { ascending: true }),
    ])

    const combined = negsRes.data.map(neg => ({
      ...neg,
      negotiation_entities: (negEntities || []).filter(ne => ne.negotiation_id === neg.id),
      notes_list: (negNotes || []).filter(n => n.negotiation_id === neg.id),
    }))

    setNegotiations(combined)
    if (entitiesRes.data) setEntities(entitiesRes.data)
    if (membersRes.data) setMembers(membersRes.data)
    if (statesRes.data) setCustomStates(statesRes.data)
    setLoading(false)
  }

  async function refetchSingleNeg(id) {
    const [{ data: neg }, { data: ents }, { data: notesList }] = await Promise.all([
      supabase.from('negotiations').select('*, primary_entity:primary_entity_id(id, name, country_code)').eq('id', id).single(),
      supabase.from('negotiation_entities').select('negotiation_id, entity_id, entity:entity_id(id, name, country_code)').eq('negotiation_id', id),
      supabase.from('negotiation_notes').select('id, negotiation_id, content, note_date').eq('negotiation_id', id).order('note_date'),
    ])
    if (!neg) return null
    return { ...neg, negotiation_entities: ents || [], notes_list: notesList || [] }
  }

  function getStateConfig(status) {
    const found = customStates.find(s => s.name === status)
    return found || { color: '#64748B', bg_color: '#F1F5F9' }
  }

  // Muestra solo la entidad principal en tabla/mosaico. Si el proyecto es viejo
  // y no tiene primary_entity_id asignado todavía, usa la primera vinculada.
  function getPrimaryEntity(neg) {
    if (neg.primary_entity) return neg.primary_entity
    return neg.negotiation_entities?.map(ne => ne.entity).filter(Boolean)[0] || null
  }

  function getEntityName(neg) {
    return getPrimaryEntity(neg)?.name || '—'
  }

  function getEntityFlag(neg) {
    const primary = getPrimaryEntity(neg)
    if (!primary?.country_code) return null
    return `https://flagcdn.com/w20/${primary.country_code.toLowerCase()}.png`
  }

  const activeNegs = negotiations.filter(n => n.activity_status === 'active' && n.status !== 'Completado')
  const completedState = customStates.find(s => s.name === 'Completado')
  const completedCount = negotiations.filter(n => n.status === 'Completado').length
  const stateCounts = [
    ...customStates
      .filter(s => s.name !== 'Completado')
      .map(s => ({
        name: s.name,
        color: s.color || '#64748B',
        bg_color: s.bg_color || '#F1F5F9',
        count: activeNegs.filter(n => n.status === s.name).length,
        total: activeNegs.length,
      })),
    {
      name: 'Completado',
      color: completedState?.color || '#059669',
      bg_color: completedState?.bg_color || '#ECFDF5',
      count: completedCount,
      total: negotiations.length,
    },
  ]

  const day90ago = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const day120ago = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString()

  const filtered = negotiations.filter(n => {
    if (filterStatus && n.status !== filterStatus) return false
    if (filterEntity) {
      const ids = n.negotiation_entities?.map(ne => ne.entity?.id) || []
      if (!ids.includes(filterEntity)) return false
    }
    if (filterActivity === 'active') { if (n.activity_status !== 'active') return false }
    if (filterActivity === 'paused') { if (n.activity_status !== 'paused') return false }
    if (filterActivity === 'inactive') { if (n.activity_status !== 'inactive') return false }
    if (filterActivity === 'low_activity') {
      if (!(n.activity_status === 'active' && n.status !== 'Completado' &&
            n.last_activity_at < day90ago && n.last_activity_at >= day120ago)) return false
    }
    if (search && !n.title?.toLowerCase().includes(search.toLowerCase()) && !n.product?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // Suma los hitos de pago de un set de proyectos, agrupados por moneda (sin conversión)
  function pipelineByCurrency(negIds) {
    const idSet = new Set(negIds)
    const currencyByNegId = Object.fromEntries(negotiations.map(n => [n.id, n.currency || 'USD']))
    const totals = {}
    for (const m of milestones) {
      if (!idSet.has(m.negotiation_id)) continue
      const cur = currencyByNegId[m.negotiation_id] || 'USD'
      totals[cur] = (totals[cur] || 0) + Number(m.amount)
    }
    return Object.entries(totals).map(([currency, total]) => ({ currency, total })).sort((a, b) => b.total - a.total)
  }

  const totalPipeline = pipelineByCurrency(filtered.map(n => n.id))
  const selectedPipeline = selectedIds.size > 0 ? pipelineByCurrency([...selectedIds]) : []
  const allVisibleSelected = filtered.length > 0 && filtered.every(n => selectedIds.has(n.id))

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSelectAllVisible() {
    setSelectedIds(prev => {
      if (filtered.every(n => prev.has(n.id))) return new Set()
      return new Set(filtered.map(n => n.id))
    })
  }

  useCloseOnOutsideOrEscape(exportMenuRef, showExportMenu, () => setShowExportMenu(false))

  function exportRows() {
    return selectedIds.size > 0 ? filtered.filter(n => selectedIds.has(n.id)) : filtered
  }

  function handleExportExcel() {
    setShowExportMenu(false)
    exportNegotiationsXlsx(exportRows(), cols, getEntityName, customFieldDefs)
  }

  async function handleExportPdf() {
    setShowExportMenu(false)
    setExportingPdf(true)
    const rows = exportRows()
    try {
      const { exportNegotiationsPdf } = await import('../lib/exportPdf')
      await exportNegotiationsPdf({
        negotiations: rows,
        customStates,
        getPrimaryEntity,
        getEntityName,
        pipeline: selectedIds.size > 0 ? selectedPipeline : totalPipeline,
        workspaceName: activeWorkspace?.name,
      })
    } finally {
      setExportingPdf(false)
    }
  }

  async function handleKanbanMove(negId, newStatus) {
    const neg = negotiations.find(n => n.id === negId)
    if (!neg || neg.status === newStatus) return
    const prevStatus = neg.status
    setNegotiations(prev => prev.map(n => n.id === negId ? { ...n, status: newStatus } : n))
    await supabase.from('negotiations').update({ status: newStatus }).eq('id', negId)
    const { data: negTasks } = await supabase.from('tasks').select('assigned_to').eq('negotiation_id', negId)
    await notifyNegotiationStatusChanged(supabase, {
      workspaceId: neg.workspace_id || workspaceId,
      negotiationId: negId,
      negotiationTitle: neg.product || neg.title,
      newStatus,
      recipients: (negTasks || []).map(t => t.assigned_to),
      actingUserId: user?.id,
    })
    await logActivity(supabase, {
      workspaceId: neg.workspace_id || workspaceId, negotiationId: negId, type: 'status_changed',
      title: `Estado cambió de "${prevStatus}" a "${newStatus}"`, actorId: user?.id,
    })
  }

  // Mismo efecto secundario que un cambio de estado individual
  // (notifyNegotiationStatusChanged + logActivity), aplicado a cada
  // proyecto seleccionado.
  async function handleBulkStatusChange(newStatus) {
    if (!newStatus || selectedIds.size === 0) return
    const ids = [...selectedIds]
    const targets = negotiations.filter(n => ids.includes(n.id) && n.status !== newStatus)
    if (targets.length === 0) return
    setBulkWorking(true)
    setNegotiations(prev => prev.map(n => ids.includes(n.id) ? { ...n, status: newStatus } : n))
    await supabase.from('negotiations').update({ status: newStatus }).in('id', targets.map(n => n.id))
    await Promise.all(targets.map(async (neg) => {
      const { data: negTasks } = await supabase.from('tasks').select('assigned_to').eq('negotiation_id', neg.id)
      await notifyNegotiationStatusChanged(supabase, {
        workspaceId: neg.workspace_id || workspaceId,
        negotiationId: neg.id,
        negotiationTitle: neg.product || neg.title,
        newStatus,
        recipients: (negTasks || []).map(t => t.assigned_to),
        actingUserId: user?.id,
      })
      await logActivity(supabase, {
        workspaceId: neg.workspace_id || workspaceId, negotiationId: neg.id, type: 'status_changed',
        title: `Estado cambió de "${neg.status}" a "${newStatus}"`, actorId: user?.id,
      })
    }))
    setBulkWorking(false)
  }

  async function handleBulkDelete() {
    setBulkWorking(true)
    await supabase.from('negotiations').delete().in('id', [...selectedIds])
    setSelectedIds(new Set())
    setShowBulkDeleteConfirm(false)
    setBulkWorking(false)
    fetchAll()
  }

  return (
    <div className="neg-container">
      <div className="neg-header">
        <div>
          <h1 className="neg-title">Proyectos</h1>
        </div>
        {canCreateProject && (
          <button className="neg-btn-primary" onClick={() => { setEditingNeg(null); setShowModal(true) }}>
            + Nuevo proyecto
          </button>
        )}
      </div>

      <div className="neg-stats">
        {stateCounts.map(s => (
          <div
            key={s.name}
            className={`neg-stat-card ${filterStatus === s.name ? 'active' : ''}`}
            onClick={() => setFilterStatus(filterStatus === s.name ? '' : s.name)}
            style={{ cursor: 'pointer' }}
          >
            <div className="neg-stat-label">{s.name}</div>
            <div className="neg-stat-count" style={{ color: s.color }}>{s.count}</div>
            <div className="neg-stat-bar">
              <div className="neg-stat-bar-fill" style={{ width: s.total ? `${(s.count / s.total) * 100}%` : '0%', backgroundColor: s.color }} />
            </div>
          </div>
        ))}
        <div className="neg-stat-card neg-stat-card--pipeline">
          <div className="neg-stat-label">Valor de pipeline ({filtered.length})</div>
          <div className="neg-pipeline-row">
            {totalPipeline.length === 0 ? (
              <span className="neg-pipeline-empty">Sin hitos cargados</span>
            ) : totalPipeline.map(p => (
              <span key={p.currency} className={`neg-pipeline-chip ${p.total < 0 ? 'neg-pipeline-chip--negative' : ''}`}>
                {formatAmount(p.total)} <span className="neg-pipeline-currency">{p.currency}</span>
              </span>
            ))}
          </div>
        </div>
        {selectedIds.size > 0 && (
          <div className="neg-stat-card neg-stat-card--pipeline">
            <div className="neg-stat-label">
              Seleccionados ({selectedIds.size})
              <button className="neg-pipeline-clear" onClick={() => setSelectedIds(new Set())}>Deseleccionar</button>
            </div>
            <div className="neg-pipeline-row">
              {selectedPipeline.length === 0 ? (
                <span className="neg-pipeline-empty">Sin hitos cargados</span>
              ) : selectedPipeline.map(p => (
                <span key={p.currency} className={`neg-pipeline-chip ${p.total < 0 ? 'neg-pipeline-chip--negative' : ''}`}>
                  {formatAmount(p.total)} <span className="neg-pipeline-currency">{p.currency}</span>
                </span>
              ))}
            </div>
            {(canCreateProject || canBulkDelete) && (
              <div className="neg-bulk-actions">
                {canCreateProject && (
                  <select
                    className="neg-bulk-status-select"
                    value=""
                    disabled={bulkWorking}
                    onChange={e => { const v = e.target.value; if (v) handleBulkStatusChange(v) }}
                  >
                    <option value="" disabled>Cambiar estado a...</option>
                    {customStates.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                  </select>
                )}
                {canBulkDelete && (
                  <button className="neg-bulk-delete-btn" disabled={bulkWorking} onClick={() => setShowBulkDeleteConfirm(true)}>
                    🗑 Eliminar ({selectedIds.size})
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {showBulkDeleteConfirm && (
        <DeleteConfirmModal
          itemName="ELIMINAR"
          itemType={`${selectedIds.size} proyecto${selectedIds.size !== 1 ? 's' : ''} seleccionado${selectedIds.size !== 1 ? 's' : ''}`}
          onConfirm={handleBulkDelete}
          onCancel={() => setShowBulkDeleteConfirm(false)}
        />
      )}

      <div className="neg-toolbar">
        <div className="filter-field">
          <label className="filter-field-label">Buscar</label>
          <input className="neg-search" type="text" placeholder="🔍 Proyecto o producto..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="filter-field">
          <label className="filter-field-label">Proveedor</label>
          <select className="neg-select" value={filterEntity} onChange={e => setFilterEntity(e.target.value)}>
            <option value="">Todos los proveedores</option>
            {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label className="filter-field-label">Estado</label>
          <select className="neg-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">Todos los estados</option>
            {customStates.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </div>
        <div className="filter-field">
          <label className="filter-field-label">Actividad</label>
          <select className="neg-select" value={filterActivity} onChange={e => setFilterActivity(e.target.value)}>
            <option value="active">En curso</option>
            <option value="paused">Pausados</option>
            <option value="inactive">Inactivos</option>
            <option value="low_activity">Baja actividad</option>
            <option value="">Todos (activos e inactivos)</option>
          </select>
        </div>
        <div className="neg-view-toggle">
          <button className={`neg-view-btn ${view === 'table' ? 'active' : ''}`} onClick={() => setView('table')} title="Vista tabla">☰</button>
          <button className={`neg-view-btn ${view === 'cards' ? 'active' : ''}`} onClick={() => setView('cards')} title="Vista cards">⊞</button>
          <button className={`neg-view-btn ${view === 'kanban' ? 'active' : ''}`} onClick={() => setView('kanban')} title="Vista kanban">▦</button>
        </div>
        <button
          className={`neg-col-btn ${showColEditor ? 'active' : ''}`}
          onClick={() => setShowColEditor(v => !v)}
          title="Elegir qué campos mostrar (aplica a las 3 vistas)"
        >
          ⚙ Vista
        </button>
        {canCreateProject && (
          <button className="neg-col-btn" onClick={() => setShowImportModal(true)} title="Importar proyectos desde Excel/CSV">
            ⬆ Importar
          </button>
        )}
        <div className="neg-export-menu" ref={exportMenuRef}>
          <button
            className="neg-col-btn"
            onClick={() => setShowExportMenu(v => !v)}
            disabled={exportingPdf}
            title={selectedIds.size > 0 ? `Exportar los ${selectedIds.size} seleccionados` : 'Exportar los proyectos filtrados'}
          >
            {exportingPdf ? 'Generando PDF…' : '⬇ Exportar'}
          </button>
          {showExportMenu && (
            <div className="neg-export-dropdown">
              <button className="neg-export-option" onClick={handleExportExcel}>
                <span className="neg-export-option-icon">📊</span>
                <span>
                  <span className="neg-export-option-title">Excel (.xlsx)</span>
                  <span className="neg-export-option-sub">Para analizar en planilla</span>
                </span>
              </button>
              <button className="neg-export-option" onClick={handleExportPdf}>
                <span className="neg-export-option-icon">📄</span>
                <span>
                  <span className="neg-export-option-title">PDF</span>
                  <span className="neg-export-option-sub">Presentación completa, lista para compartir</span>
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      {showColEditor && (
        <ColumnEditor cols={cols} allColumns={allColumns} onChange={saveCols} onClose={() => setShowColEditor(false)} />
      )}

      {showImportModal && (
        <ImportNegotiationsModal
          workspaceId={workspaceId}
          entities={entities}
          customStates={customStates}
          onClose={() => setShowImportModal(false)}
          onImported={fetchAll}
        />
      )}

      {loading ? (
        <div className="neg-loading">Cargando proyectos...</div>
      ) : filtered.length === 0 ? (
        <div className="neg-empty">No hay proyectos todavía.</div>
      ) : view === 'table' ? (
        <TableView negotiations={filtered} getStateConfig={getStateConfig} getEntityName={getEntityName} getEntityFlag={getEntityFlag} onSelect={setSelectedNeg} cols={cols} allColumns={allColumns} customFieldDefs={customFieldDefs}
          selectedIds={selectedIds} onToggleSelect={toggleSelect} allVisibleSelected={allVisibleSelected} onToggleSelectAll={toggleSelectAllVisible} />
      ) : view === 'cards' ? (
        <CardsView negotiations={filtered} getStateConfig={getStateConfig} getEntityName={getEntityName} getEntityFlag={getEntityFlag} onSelect={setSelectedNeg} cols={cols} customFieldDefs={customFieldDefs}
          selectedIds={selectedIds} onToggleSelect={toggleSelect} />
      ) : (
        <KanbanView negotiations={filtered} customStates={customStates} getStateConfig={getStateConfig} getEntityName={getEntityName} getEntityFlag={getEntityFlag} cols={cols} customFieldDefs={customFieldDefs}
          onSelect={setSelectedNeg} canEdit={canCreateProject} onMove={handleKanbanMove} />
      )}

      {showModal && (
        <NegotiationModal
          initial={editingNeg}
          entities={entities}
          members={members}
          customStates={customStates}
          customFieldDefs={customFieldDefs}
          onClose={() => { setShowModal(false); setSelectedNeg(null) }}
          onCancel={() => {
            if (editingNeg) setSelectedNeg(editingNeg)
            setShowModal(false)
          }}
          onSaved={async () => {
            if (editingNeg) {
              const updated = await refetchSingleNeg(editingNeg.id)
              setSelectedNeg(updated || editingNeg)
            }
            setShowModal(false)
            fetchAll()
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
          customFieldDefs={customFieldDefs}
          getStateConfig={getStateConfig}
          getEntityFlag={getEntityFlag}
          highlightTaskId={highlightTaskId}
          onClose={() => { setSelectedNeg(null); setHighlightTaskId(null) }}
          onEdit={() => { setEditingNeg(selectedNeg); setSelectedNeg(null); setShowModal(true) }}
          onNotesChanged={fetchAll}
          onDeleted={() => { fetchAll(); setSelectedNeg(null) }}
          onActivityChanged={fetchAll}
        />
      )}
    </div>
  )
}

// Editor de columnas — drag & drop para reordenar, toggle para mostrar/ocultar
function ColumnEditor({ cols, allColumns, onChange, onClose }) {
  const [dragSrc, setDragSrc] = useState(null)
  const [dragOver, setDragOver] = useState(null)

  function toggleVisible(key) {
    const col = allColumns.find(c => c.key === key)
    if (col?.alwaysVisible) return
    onChange(cols.map(c => c.key === key ? { ...c, visible: !c.visible } : c))
  }

  function handleDragStart(e, idx) {
    setDragSrc(idx)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e, idx) {
    e.preventDefault()
    setDragOver(idx)
  }

  function handleDrop(idx) {
    if (dragSrc === null || dragSrc === idx) { setDragSrc(null); setDragOver(null); return }
    const next = [...cols]
    const [moved] = next.splice(dragSrc, 1)
    next.splice(idx, 0, moved)
    onChange(next)
    setDragSrc(null)
    setDragOver(null)
  }

  return (
    <div className="col-editor">
      <div className="col-editor-header">
        <span className="col-editor-title">Campos visibles</span>
        <span className="col-editor-hint">Arrastrá para reordenar · Clic para mostrar/ocultar · Aplica a las 3 vistas</span>
        <button className="col-editor-close" onClick={onClose}>✕</button>
      </div>
      <div className="col-editor-list">
        {cols.map((c, idx) => {
          const def = allColumns.find(x => x.key === c.key)
          if (!def) return null
          return (
            <div
              key={c.key}
              className={`col-editor-item ${dragOver === idx ? 'drag-over' : ''} ${!c.visible ? 'hidden' : ''}`}
              draggable
              onDragStart={e => handleDragStart(e, idx)}
              onDragOver={e => handleDragOver(e, idx)}
              onDrop={() => handleDrop(idx)}
              onDragEnd={() => { setDragSrc(null); setDragOver(null) }}
            >
              <span className="col-drag-handle">⠿</span>
              <input
                type="checkbox"
                checked={c.visible}
                onChange={() => toggleVisible(c.key)}
                disabled={def.alwaysVisible}
              />
              <span className="col-editor-label">{def.label}</span>
              {def.alwaysVisible && <span className="col-always">siempre</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Render de una celda según el key de columna
function renderCell(key, neg, getStateConfig, getEntityName, getEntityFlag, customFieldDefs) {
  const cfg = getStateConfig(neg.status)
  const flag = getEntityFlag(neg)

  switch (key) {
    case 'product': {
      const actIcon = neg.activity_status === 'inactive' ? '💤' : neg.activity_status === 'paused' ? '⏸' : null
      return (
        <td key={key} className="neg-td-product">
          {actIcon && <span className={`neg-paused-icon ${neg.activity_status === 'inactive' ? 'neg-icon-inactive' : 'neg-icon-paused'}`}>{actIcon}</span>}
          {neg.product || neg.title}
        </td>
      )
    }
    case 'entities':
      return (
        <td key={key} className="neg-td-entity">
          <span className="neg-entity-name">
            {flag && <img src={flag} alt="" className="neg-flag" />}
            {getEntityName(neg)}
          </span>
        </td>
      )
    case 'status':
      return <td key={key}><span className="neg-status-badge" style={{ backgroundColor: cfg.bg_color, color: cfg.color }}>{neg.status}</span></td>
    case 'nda':
      return <td key={key}><span className="neg-nda-badge">{neg.nda || '—'}</span></td>
    case 'territories':
      return (
        <td key={key}>
          <div className="neg-chips">
            {neg.territories?.slice(0, 4).map(t => <span key={t} className="neg-chip neg-chip-green">{t}</span>)}
            {neg.territories?.length > 4 && <span className="neg-chip neg-chip-gray">+{neg.territories.length - 4}</span>}
          </div>
        </td>
      )
    case 'companies':
      return (
        <td key={key}>
          <div className="neg-chips">
            {neg.companies?.slice(0, 2).map(c => <span key={c} className="neg-chip neg-chip-purple">{c}</span>)}
            {neg.companies?.length > 2 && <span className="neg-chip neg-chip-gray">+{neg.companies.length - 2}</span>}
          </div>
        </td>
      )
    case 'target_date':
      return <td key={key} className="neg-td-date">{neg.target_date || '—'}</td>
    case 'participants':
      return (
        <td key={key}>
          <div className="neg-chips">
            {neg.participants?.slice(0, 2).map(p => <span key={p} className="neg-chip neg-chip-blue">{p}</span>)}
            {neg.participants?.length > 2 && <span className="neg-chip neg-chip-gray">+{neg.participants.length - 2}</span>}
          </div>
        </td>
      )
    case 'notes': {
      const list = neg.notes_list || []
      if (!list.length) return <td key={key} className="neg-td-text" style={{ color: '#d1d5db' }}>Sin notas</td>
      const preview = list.map(n => `${new Date(n.note_date + 'T00:00:00').toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit' })}: ${n.content}`).join(' · ')
      return <td key={key} className="neg-td-text">{preview}</td>
    }
    case 'description':
      return <td key={key} className="neg-td-text">{neg.description ? neg.description : '—'}</td>
    case 'observations':
      return <td key={key} className="neg-td-text">{neg.observations ? neg.observations : '—'}</td>
    case 'activity_status': {
      const map = { active: 'En curso', paused: '⏸ Pausado', inactive: '💤 Inactivo' }
      return <td key={key}><span className="neg-nda-badge">{map[neg.activity_status] || '—'}</span></td>
    }
    case 'last_activity_at': {
      if (!neg.last_activity_at) return <td key={key}>—</td>
      const days = Math.floor((Date.now() - new Date(neg.last_activity_at)) / 86400000)
      const label = days === 0 ? 'hoy' : days === 1 ? 'ayer' : `hace ${days}d`
      return <td key={key} className="neg-td-date">{label}</td>
    }
    default: {
      const def = customFieldDefs?.find(d => d.key === key)
      if (!def) return <td key={key}>—</td>
      return <td key={key} className="neg-td-text">{renderCustomFieldDisplay(def, getCustomFieldValue(neg.custom_fields, key))}</td>
    }
  }
}

function TableView({ negotiations, getStateConfig, getEntityName, getEntityFlag, onSelect, cols, allColumns, customFieldDefs, selectedIds, onToggleSelect, allVisibleSelected, onToggleSelectAll }) {
  const visibleCols = cols.filter(c => c.visible)

  return (
    <div className="neg-table-wrapper">
      <table className="neg-table">
        <thead>
          <tr>
            <th className="neg-th-check">
              <input type="checkbox" checked={allVisibleSelected} onChange={onToggleSelectAll} title="Seleccionar todos los visibles" />
            </th>
            {visibleCols.map(c => {
              const def = allColumns.find(x => x.key === c.key)
              return <th key={c.key}>{def?.label}</th>
            })}
          </tr>
        </thead>
        <tbody>
          {negotiations.map(neg => {
            const rowClass = neg.activity_status === 'paused' ? 'neg-row-paused' : neg.activity_status === 'inactive' ? 'neg-row-inactive' : ''
            return (
              <tr key={neg.id} onClick={() => onSelect(neg)} className={`neg-table-row ${rowClass}`}>
                <td className="neg-td-check" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selectedIds.has(neg.id)} onChange={() => onToggleSelect(neg.id)} />
                </td>
                {visibleCols.map(c => renderCell(c.key, neg, getStateConfig, getEntityName, getEntityFlag, customFieldDefs))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function renderCardField(key, neg, getStateConfig, getEntityName, getEntityFlag, customFieldDefs) {
  const flag = getEntityFlag(neg)
  switch (key) {
    case 'entities': {
      const name = getEntityName(neg)
      if (!name || name === '—') return null
      return (
        <div key={key} className="neg-card-entity">
          {flag && <img src={flag} alt="" className="neg-flag" />}
          {name}
        </div>
      )
    }
    case 'territories':
      if (!neg.territories?.length) return null
      return (
        <div key={key} className="neg-chips neg-card-field">
          {neg.territories.slice(0, 4).map(t => <span key={t} className="neg-chip neg-chip-green">{t}</span>)}
          {neg.territories.length > 4 && <span className="neg-chip neg-chip-gray">+{neg.territories.length - 4}</span>}
        </div>
      )
    case 'companies':
      if (!neg.companies?.length) return null
      return (
        <div key={key} className="neg-chips neg-card-field">
          {neg.companies.slice(0, 2).map(c => <span key={c} className="neg-chip neg-chip-purple">{c}</span>)}
          {neg.companies.length > 2 && <span className="neg-chip neg-chip-gray">+{neg.companies.length - 2}</span>}
        </div>
      )
    case 'participants':
      if (!neg.participants?.length) return null
      return (
        <div key={key} className="neg-chips neg-card-field">
          {neg.participants.slice(0, 2).map(p => <span key={p} className="neg-chip neg-chip-blue">{p}</span>)}
          {neg.participants.length > 2 && <span className="neg-chip neg-chip-gray">+{neg.participants.length - 2}</span>}
        </div>
      )
    case 'nda':
      if (!neg.nda || neg.nda === '—') return null
      return <div key={key} className="neg-card-field"><span className="neg-nda-badge">{neg.nda}</span></div>
    case 'target_date':
      if (!neg.target_date) return null
      return <div key={key} className="neg-card-date neg-card-field">{neg.target_date}</div>
    case 'notes': {
      const list = neg.notes_list || []
      if (!list.length) return null
      const preview = list.map(n => `${new Date(n.note_date + 'T00:00:00').toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit' })}: ${n.content}`).join(' · ')
      return <div key={key} className="neg-card-text neg-card-field">{preview}</div>
    }
    case 'description':
      if (!neg.description) return null
      return <div key={key} className="neg-card-text neg-card-field">{neg.description}</div>
    case 'observations':
      if (!neg.observations) return null
      return <div key={key} className="neg-card-text neg-card-field">{neg.observations}</div>
    case 'activity_status': {
      const map = { active: 'En curso', paused: '⏸ Pausado', inactive: '💤 Inactivo' }
      return <div key={key} className="neg-card-field"><span className="neg-nda-badge">{map[neg.activity_status] || '—'}</span></div>
    }
    case 'last_activity_at': {
      if (!neg.last_activity_at) return null
      const days = Math.floor((Date.now() - new Date(neg.last_activity_at)) / 86400000)
      const label = days === 0 ? 'hoy' : days === 1 ? 'ayer' : `hace ${days}d`
      return <div key={key} className="neg-card-date neg-card-field">{label}</div>
    }
    default: {
      const def = customFieldDefs?.find(d => d.key === key)
      if (!def) return null
      const rendered = renderCustomFieldDisplay(def, getCustomFieldValue(neg.custom_fields, key))
      if (rendered === '—') return null
      return <div key={key} className="neg-card-text neg-card-field">{rendered}</div>
    }
  }
}

function CardsView({ negotiations, getStateConfig, getEntityName, getEntityFlag, onSelect, cols, customFieldDefs, selectedIds, onToggleSelect }) {
  // Columnas visibles excluyendo product y status (que van hardcodeados en el header)
  const visibleFields = cols.filter(c => c.visible && c.key !== 'product' && c.key !== 'status')

  return (
    <div className="neg-cards-grid">
      {negotiations.map(neg => {
        const cfg = getStateConfig(neg.status)
        const actIcon = neg.activity_status === 'inactive' ? '💤' : neg.activity_status === 'paused' ? '⏸' : null
        const cardClass = neg.activity_status === 'paused' ? 'neg-card-paused' : neg.activity_status === 'inactive' ? 'neg-card-inactive' : ''
        return (
          <div key={neg.id} className={`neg-card ${cardClass}`} onClick={() => onSelect(neg)}>
            <div className="neg-card-select-strip" onClick={e => e.stopPropagation()}>
              <input
                type="checkbox"
                className="neg-card-checkbox"
                checked={selectedIds.has(neg.id)}
                onChange={() => onToggleSelect(neg.id)}
              />
            </div>
            <div className="neg-card-body">
              <div className="neg-card-header">
                <div className="neg-card-title">
                  {actIcon && <span className={`neg-paused-icon ${neg.activity_status === 'inactive' ? 'neg-icon-inactive' : 'neg-icon-paused'}`}>{actIcon}</span>}
                  {neg.product || neg.title}
                </div>
                <span className="neg-status-badge" style={{ backgroundColor: cfg.bg_color, color: cfg.color }}>{neg.status}</span>
              </div>
              {visibleFields.map(c => renderCardField(c.key, neg, getStateConfig, getEntityName, getEntityFlag, customFieldDefs))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function KanbanView({ negotiations, customStates, getStateConfig, getEntityName, getEntityFlag, onSelect, canEdit, onMove, cols, customFieldDefs }) {
  const [dragOverCol, setDragOverCol] = useState(null)
  // Mismos campos configurables que Tabla/Cards ("⚙ Vista"), product y status
  // van hardcodeados en el título de la card / la columna en la que cae.
  const visibleFields = cols.filter(c => c.visible && c.key !== 'product' && c.key !== 'status')

  return (
    <div className="neg-kanban-board">
      {customStates.map((state, colIdx) => {
        const colNegs = negotiations.filter(n => n.status === state.name)
        return (
          <div
            key={state.name}
            className={`neg-kanban-col ${dragOverCol === state.name ? 'drag-over' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOverCol(state.name) }}
            onDragLeave={() => setDragOverCol(null)}
            onDrop={e => {
              e.preventDefault()
              setDragOverCol(null)
              const negId = e.dataTransfer.getData('text/plain')
              if (negId) onMove(negId, state.name)
            }}
          >
            <div className="neg-kanban-col-header">
              <span className="neg-kanban-col-dot" style={{ backgroundColor: state.color || '#64748B' }} />
              {state.name}
              <span className="neg-kanban-col-count">{colNegs.length}</span>
            </div>
            <div className="neg-kanban-col-body">
              {colNegs.map(neg => {
                const actIcon = neg.activity_status === 'inactive' ? '💤' : neg.activity_status === 'paused' ? '⏸' : null
                return (
                  <div
                    key={neg.id}
                    className="neg-kanban-card"
                    draggable={canEdit}
                    onDragStart={e => e.dataTransfer.setData('text/plain', neg.id)}
                    onClick={() => onSelect(neg)}
                  >
                    <div className="neg-kanban-card-title">
                      {actIcon && <span className="neg-kanban-card-icon">{actIcon}</span>}
                      {neg.product || neg.title}
                    </div>
                    {visibleFields.map(c => renderCardField(c.key, neg, getStateConfig, getEntityName, getEntityFlag, customFieldDefs))}
                    {canEdit && (
                      <div className="neg-kanban-card-actions" onClick={e => e.stopPropagation()}>
                        {colIdx > 0 && (
                          <button title="Mover a la izquierda" onClick={() => onMove(neg.id, customStates[colIdx - 1].name)}>‹</button>
                        )}
                        {colIdx < customStates.length - 1 && (
                          <button title="Mover a la derecha" onClick={() => onMove(neg.id, customStates[colIdx + 1].name)}>›</button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              {colNegs.length === 0 && <p className="neg-kanban-empty">Sin proyectos.</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Combobox con buscador + chips para campos de selección múltiple (participantes, empresas, territorios).
// Evita mostrar la lista completa siempre abierta cuando hay muchas opciones.
function ChipsCombobox({ options, selected, onChange, placeholder, allowSelectAll }) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)

  const available = options.filter(o => !selected.includes(o))
  const filtered = available.filter(o => o.toLowerCase().includes(search.toLowerCase())).slice(0, 6)
  const allSelected = options.length > 0 && selected.length === options.length

  function add(o) {
    onChange([...selected, o])
    setSearch('')
  }
  function remove(o) {
    onChange(selected.filter(x => x !== o))
  }
  function toggleAll() {
    onChange(allSelected ? [] : [...options])
  }

  return (
    <div className="entity-combobox">
      <input
        type="text"
        className="entity-search-input"
        placeholder={placeholder}
        value={search}
        autoComplete="off"
        onChange={e => { setSearch(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="entity-dropdown">
          {allowSelectAll && options.length > 0 && (
            <div className="entity-dropdown-option entity-dropdown-option--all" onMouseDown={toggleAll}>
              {allSelected ? '✕ Quitar todos' : '✓ Seleccionar todos'}
            </div>
          )}
          {filtered.map(o => (
            <div key={o} className="entity-dropdown-option" onMouseDown={() => add(o)}>{o}</div>
          ))}
          {filtered.length === 0 && (
            <div className="entity-dropdown-empty">{available.length === 0 ? 'No hay más opciones' : 'Sin resultados'}</div>
          )}
        </div>
      )}
      {selected.length > 0 && (
        <div className="chips-selected-list">
          {selected.map(o => (
            <span key={o} className="chips-selected-pill">
              {o}
              <button type="button" className="chips-selected-remove" onClick={() => remove(o)}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function NegotiationModal({ initial, presetEntity, entities, members, customStates, customFieldDefs = [], onClose, onCancel, onSaved, workspaceId, userId }) {
  const empty = {
    title: '', product: '', status: customStates[0]?.name || 'Contactado',
    nda: '—', target_date: '', description: '', observations: '',
    territories: [], companies: [], participants: [],
    entity_ids: presetEntity ? [{ id: presetEntity.id, role: '' }] : [], // [{ id, role }]
    tasks: [],
    currency: 'USD', milestones: [], custom_fields: {}
  }
  const [form, setForm] = useState(initial ? {
    ...empty, ...initial,
    entity_ids: (() => {
      const ids = initial.negotiation_entities?.map(ne => ({ id: ne.entity?.id, role: ne.role || '' })).filter(e => e.id) || []
      const primaryIdx = ids.findIndex(e => e.id === initial.primary_entity_id)
      return primaryIdx > 0 ? [ids[primaryIdx], ...ids.filter((_, i) => i !== primaryIdx)] : ids
    })(),
    tasks: [],
    currency: initial.currency || 'USD', milestones: [],
    custom_fields: Object.fromEntries(Object.entries(initial.custom_fields || {}).map(([k, v]) => [k, v?.value])),
  } : empty)
  const [entitySearch, setEntitySearch] = useState('')
  const [entityDropdownOpen, setEntityDropdownOpen] = useState(false)
  const entityRef = useRef(null)
  const [newTask, setNewTask] = useState('')
  const [newTaskAssignee, setNewTaskAssignee] = useState('')
  const [newMilestoneName, setNewMilestoneName] = useState('')
  const [newMilestoneAmount, setNewMilestoneAmount] = useState('')
  const [newMilestoneDate, setNewMilestoneDate] = useState('')
  const [newMilestoneTiming, setNewMilestoneTiming] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function handleSave() {
    if (!form.product?.trim() && !form.title?.trim()) { setError('El producto es obligatorio'); return }
    setSaving(true)
    const row = {
      workspace_id: workspaceId,
      title: form.product?.trim() || form.title?.trim(),
      product: form.product?.trim(),
      status: form.status, nda: form.nda,
      target_date: form.target_date || null,
      description: form.description, observations: form.observations,
      territories: form.territories, companies: form.companies,
      participants: form.participants, created_by: userId,
      primary_entity_id: form.entity_ids[0]?.id || null,
      currency: form.currency,
      custom_fields: mergeCustomFieldValues(initial?.custom_fields, form.custom_fields),
    }
    let negId = initial?.id
    if (initial?.id) {
      await supabase.from('negotiations').update(row).eq('id', initial.id)
      if (initial.status !== form.status) {
        const { data: existingTasks } = await supabase.from('tasks').select('assigned_to').eq('negotiation_id', initial.id)
        await notifyNegotiationStatusChanged(supabase, {
          workspaceId,
          negotiationId: initial.id,
          negotiationTitle: row.product || row.title,
          newStatus: form.status,
          recipients: (existingTasks || []).map(t => t.assigned_to),
          actingUserId: userId,
        })
        await logActivity(supabase, {
          workspaceId, negotiationId: initial.id, type: 'status_changed',
          title: `Estado cambió de "${initial.status}" a "${form.status}"`, actorId: userId,
        })
      }
    } else {
      const { data } = await supabase.from('negotiations').insert(row).select().single()
      negId = data?.id
      if (negId) {
        await logActivity(supabase, {
          workspaceId, negotiationId: negId, type: 'project_created',
          title: `Proyecto "${row.product || row.title}" creado`, actorId: userId,
        })
      }
    }
    if (negId) {
      await supabase.from('negotiation_entities').delete().eq('negotiation_id', negId)
      if (form.entity_ids.length > 0) {
        await supabase.from('negotiation_entities').insert(
          form.entity_ids.map(e => ({ negotiation_id: negId, entity_id: e.id, role: e.role || null }))
        )
      }
      if (form.tasks.length > 0) {
        const { data: insertedTasks } = await supabase.from('tasks').insert(form.tasks.map(t => ({
          workspace_id: workspaceId, negotiation_id: negId,
          title: t.text, assigned_to: t.assignee || null,
          status: 'pending', priority: 'medium', created_by: userId,
        }))).select('id, title, assigned_to')
        for (const t of insertedTasks || []) {
          await notifyTaskAssigned(supabase, { workspaceId, task: t, assignedTo: t.assigned_to, actingUserId: userId })
          await logActivity(supabase, {
            workspaceId, negotiationId: negId, type: 'task_created',
            title: `Tarea creada: "${t.title}"`, actorId: userId,
          })
        }
      }
      if (form.milestones.length > 0) {
        const { data: insertedMilestones } = await supabase.from('deal_milestones').insert(form.milestones.map((m, idx) => ({
          workspace_id: workspaceId, negotiation_id: negId,
          name: m.name, amount: m.amount, estimated_date: m.estimated_date || null, timing_note: m.timing_note || null, sort_order: idx,
        }))).select('id, name, amount')
        for (const m of insertedMilestones || []) {
          await logActivity(supabase, {
            workspaceId, negotiationId: negId, type: 'milestone_added',
            title: `Hito agregado: "${m.name}" (${Number(m.amount).toLocaleString('es-AR')}${form.currency ? ' ' + form.currency : ''})`,
            actorId: userId,
          })
        }
      }
    }
    setSaving(false)
    onSaved()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="neg-modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header modal-header--sticky">
          <h2 className="modal-title">{initial ? 'Editar proyecto' : 'Nuevo proyecto'}</h2>
          <div className="modal-header-actions">
            {error && <span className="form-error" style={{ marginRight: 8 }}>{error}</span>}
            <button type="button" className="btn-secondary" onClick={onCancel || onClose}>Cancelar</button>
            <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="neg-modal-body">
          <div className="form-row">
            <div className="form-group">
              <label>PRODUCTO / LÍNEA *</label>
              <input type="text" value={form.product} onChange={e => set('product', e.target.value)} placeholder="Ej: Ibuprofeno 400mg" />
            </div>
          </div>
          <div className="form-group">
            <label>DESCRIPCIÓN</label>
            <textarea
              value={form.description}
              onChange={e => set('description', e.target.value)}
              rows={3}
              placeholder="De qué se trata este proyecto: contexto, alcance, términos generales..."
            />
          </div>

          {/* Selector de entidades — combobox + lista de seleccionadas */}
          <div className="form-group" ref={entityRef}>
            <label>ENTIDADES VINCULADAS</label>
            <div className="entity-combobox">
              <input
                type="text"
                className="entity-search-input"
                placeholder="Buscar y agregar entidad..."
                value={entitySearch}
                autoComplete="off"
                onChange={e => { setEntitySearch(e.target.value); setEntityDropdownOpen(true) }}
                onFocus={() => setEntityDropdownOpen(true)}
                onBlur={() => setTimeout(() => setEntityDropdownOpen(false), 150)}
              />
              {entityDropdownOpen && (
                <div className="entity-dropdown">
                  {entities
                    .filter(e =>
                      !form.entity_ids.find(x => x.id === e.id) &&
                      e.name.toLowerCase().includes(entitySearch.toLowerCase())
                    )
                    .slice(0, 6)
                    .map(e => (
                      <div
                        key={e.id}
                        className="entity-dropdown-option"
                        onMouseDown={() => {
                          set('entity_ids', [...form.entity_ids, { id: e.id, role: '' }])
                          setEntitySearch('')
                        }}
                      >
                        {e.name}
                      </div>
                    ))
                  }
                  {entities.filter(e =>
                    !form.entity_ids.find(x => x.id === e.id) &&
                    e.name.toLowerCase().includes(entitySearch.toLowerCase())
                  ).length === 0 && (
                    <div className="entity-dropdown-empty">Sin resultados</div>
                  )}
                </div>
              )}
            </div>

            {/* Lista de entidades seleccionadas con campo de rol — la primera es la principal */}
            {form.entity_ids.length > 0 && (
              <div className="entity-selected-list">
                {form.entity_ids.map((e, idx) => {
                  const ent = entities.find(x => x.id === e.id)
                  const isPrimary = idx === 0
                  return (
                    <div key={e.id} className={`entity-selected-row ${isPrimary ? 'entity-selected-row--primary' : ''}`}>
                      {isPrimary ? (
                        <span className="entity-primary-badge" title="Se muestra en tabla y mosaico">★ Principal</span>
                      ) : (
                        <button
                          type="button"
                          className="entity-make-primary-btn"
                          title="Marcar como principal"
                          onClick={() => set('entity_ids', [e, ...form.entity_ids.filter(x => x.id !== e.id)])}
                        >☆</button>
                      )}
                      <span className="entity-selected-name">{ent?.name}</span>
                      <input
                        type="text"
                        className="entity-role-input"
                        placeholder="Rol (opcional)"
                        value={e.role}
                        onChange={ev => set('entity_ids', form.entity_ids.map(x => x.id === e.id ? { ...x, role: ev.target.value } : x))}
                      />
                      <button
                        type="button"
                        className="entity-remove-btn"
                        onClick={() => set('entity_ids', form.entity_ids.filter(x => x.id !== e.id))}
                      >×</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>ESTADO</label>
              <select value={form.status} onChange={e => set('status', e.target.value)}>
                {customStates.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>FECHA</label>
              <input type="date" value={form.target_date} onChange={e => set('target_date', e.target.value)} />
            </div>
            <div className="form-group">
              <label>NDA</label>
              <select value={form.nda} onChange={e => set('nda', e.target.value)}>
                {NDA_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>MONEDA</label>
              <select value={form.currency} onChange={e => set('currency', e.target.value)}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>PARTICIPANTES</label>
            <ChipsCombobox
              options={members.map(m => m.profile?.full_name || m.profile?.email || 'Usuario')}
              selected={form.participants}
              onChange={v => set('participants', v)}
              placeholder="Buscar y agregar participante..."
              allowSelectAll
            />
          </div>
          <div className="form-group">
            <label>EMPRESAS INTERESADAS</label>
            <ChipsCombobox
              options={COMPANIES}
              selected={form.companies}
              onChange={v => set('companies', v)}
              placeholder="Buscar y agregar empresa..."
              allowSelectAll
            />
          </div>
          <div className="form-group">
            <label>TERRITORIOS</label>
            <ChipsCombobox
              options={TERRITORIES}
              selected={form.territories}
              onChange={v => set('territories', v)}
              placeholder="Buscar y agregar territorio..."
              allowSelectAll
            />
          </div>
          <CustomFieldsFormSection
            defs={customFieldDefs}
            values={form.custom_fields}
            onChange={(key, v) => set('custom_fields', { ...form.custom_fields, [key]: v })}
          />
          <div className="form-group">
            <label>OBSERVACIONES INTERNAS</label>
            <textarea value={form.observations} onChange={e => set('observations', e.target.value)} rows={3} placeholder="Notas internas del equipo..." />
          </div>
          <div className="form-group">
            <label>TAREAS INICIALES</label>
            <div className="neg-newtask-row">
              <input type="text" value={newTask} onChange={e => setNewTask(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && newTask.trim()) { set('tasks', [...form.tasks, { id: Date.now(), text: newTask.trim(), assignee: newTaskAssignee }]); setNewTask(''); setNewTaskAssignee('') }}}
                placeholder="Describí la tarea y presioná Enter..." style={{ flex: 1, minWidth: 0 }} />
              <select className="neg-newtask-select" value={newTaskAssignee} onChange={e => setNewTaskAssignee(e.target.value)}>
                <option value="">Sin asignar</option>
                {members.map(m => <option key={m.user_id} value={m.user_id}>{m.profile?.full_name || m.profile?.email || 'Usuario'}</option>)}
              </select>
              <button type="button" className="btn-secondary"
                onClick={() => { if (!newTask.trim()) return; set('tasks', [...form.tasks, { id: Date.now(), text: newTask.trim(), assignee: newTaskAssignee }]); setNewTask(''); setNewTaskAssignee('') }}>
                + Agregar
              </button>
            </div>
            {form.tasks.map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#f9fafb', borderRadius: 7, border: '1px solid #e5e7eb', marginBottom: 6 }}>
                <span style={{ flex: 1, fontSize: 13, color: '#374151' }}>{t.text}</span>
                {t.assignee && <span style={{ fontSize: 11, background: '#EFF6FF', color: '#1D4ED8', padding: '2px 8px', borderRadius: 99 }}>{members.find(m => m.user_id === t.assignee)?.profile?.full_name || 'Usuario'}</span>}
                <button type="button" onClick={() => set('tasks', form.tasks.filter(x => x.id !== t.id))} style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: 16 }}>×</button>
              </div>
            ))}
          </div>
          <div className="form-group">
            <label>HITOS DE PAGO {initial ? '' : 'INICIALES'}</label>
            <div className="neg-milestone-add" style={{ marginTop: 0 }}>
              <input type="text" className="neg-note-input neg-milestone-name-input" value={newMilestoneName} onChange={e => setNewMilestoneName(e.target.value)}
                placeholder="Ej: Upfront, Milestone Fase 2, Royalties Año 1..." />
              <input type="number" className="neg-note-date-input neg-milestone-amount-input" value={newMilestoneAmount} onChange={e => setNewMilestoneAmount(e.target.value)}
                placeholder="Monto (negativo = pago a hacer)" step="0.01" />
              <input type="date" className="neg-note-date-input neg-milestone-date-input" value={newMilestoneDate} onChange={e => setNewMilestoneDate(e.target.value)} />
              <input type="text" className="neg-note-input neg-milestone-timing-input" value={newMilestoneTiming} onChange={e => setNewMilestoneTiming(e.target.value)}
                placeholder="Momento (si no hay fecha exacta, ej: al lanzamiento)" />
              <button type="button" className="btn-secondary" onClick={() => {
                const amount = parseFloat(newMilestoneAmount)
                if (!newMilestoneName.trim() || Number.isNaN(amount) || amount === 0) return
                set('milestones', [...form.milestones, { id: Date.now(), name: newMilestoneName.trim(), amount, estimated_date: newMilestoneDate, timing_note: newMilestoneTiming.trim() }])
                setNewMilestoneName(''); setNewMilestoneAmount(''); setNewMilestoneDate(''); setNewMilestoneTiming('')
              }}>
                + Agregar
              </button>
            </div>
            {form.milestones.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#f9fafb', borderRadius: 7, border: '1px solid #e5e7eb', marginTop: 6 }}>
                <span style={{ flex: 1, fontSize: 13, color: '#374151' }}>{m.name}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: Number(m.amount) < 0 ? '#DC2626' : '#059669' }}>{Number(m.amount).toLocaleString('es-AR')} {form.currency}</span>
                {(m.estimated_date || m.timing_note) && (
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>
                    {[m.estimated_date ? new Date(m.estimated_date + 'T00:00:00').toLocaleDateString('es-AR') : null, m.timing_note].filter(Boolean).join(' · ')}
                  </span>
                )}
                <button type="button" onClick={() => set('milestones', form.milestones.filter(x => x.id !== m.id))} style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: 16 }}>×</button>
              </div>
            ))}
            {initial && (
              <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>Los hitos ya existentes se editan desde la vista de detalle del proyecto.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function NegotiationDetail({ neg, entities, customStates, customFieldDefs = [], getStateConfig, getEntityFlag, highlightTaskId, onClose, onEdit, onDeleted, onActivityChanged, onNotesChanged }) {
  const { effectiveRole, role, user, isStaff, workspaceId } = useAuth()
  const canDelete = effectiveRole === 'owner'
  const canPause = effectiveRole === 'owner' || effectiveRole === 'admin'
  const canEdit = effectiveRole === 'owner' || effectiveRole === 'admin' || effectiveRole === 'editor'
  const canEditInline = effectiveRole === 'owner' || effectiveRole === 'admin' || effectiveRole === 'editor'
  const canNote = effectiveRole !== 'viewer'
  const canTask = effectiveRole !== 'viewer'
  const isPrivileged = effectiveRole === 'owner' || effectiveRole === 'admin'
  // Al impersonar un rol inferior, simulamos ser un usuario sin ID conocido
  const myUserId = user?.id

  function canCompleteTask(task) {
    if (task.status === 'done') return false
    if (isTaskBlocked(task)) return false
    if (isPrivileged) return true
    if (!task.assigned_to) return effectiveRole !== 'viewer'
    return task.assigned_to === myUserId && effectiveRole !== 'viewer'
  }
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [tasks, setTasks] = useState([])
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [activityRefresh, setActivityRefresh] = useState(0)
  const [activityStatus, setActivityStatus] = useState(neg.activity_status || 'active')
  const [inlineStatus, setInlineStatus] = useState(neg.status || '')
  const [inlineNda, setInlineNda] = useState(neg.nda || '—')
  const [inlineObs, setInlineObs] = useState(neg.observations || '')
  const [inlineDescription, setInlineDescription] = useState(neg.description || '')
  const [inlineCurrency, setInlineCurrency] = useState(neg.currency || 'USD')
  const [customFieldValues, setCustomFieldValues] = useState(neg.custom_fields || {})
  const cfg = getStateConfig(neg.status)
  const flag = getEntityFlag(neg)
  const primaryEntity = neg.primary_entity || neg.negotiation_entities?.map(ne => ne.entity).filter(Boolean)[0] || null
  const entityNames = primaryEntity?.name || '—'
  const secondaryEntities = (neg.negotiation_entities || []).filter(ne => ne.entity?.id && ne.entity.id !== primaryEntity?.id)

  useEffect(() => { fetchTasks() }, [])

  async function fetchTasks() {
    const { data } = await supabase.from('tasks')
      .select(`*, profile:assigned_to ( full_name ), predecessor:predecessor_task_id ( id, title, status, profile:assigned_to ( full_name ) )`)
      .eq('negotiation_id', neg.id)
      .order('created_at', { ascending: false })
    if (data) setTasks(data)
  }

  async function saveCustomField(key, value) {
    const merged = mergeCustomFieldValue(customFieldValues, key, value)
    setCustomFieldValues(merged)
    await supabase.from('negotiations').update({ custom_fields: merged }).eq('id', neg.id)
  }

  async function saveInlineField(field, value) {
    const prevValue = neg[field]
    await supabase.from('negotiations').update({ [field]: value }).eq('id', neg.id)
    if (field === 'status') {
      await notifyNegotiationStatusChanged(supabase, {
        workspaceId: neg.workspace_id || workspaceId,
        negotiationId: neg.id,
        negotiationTitle: neg.product || neg.title,
        newStatus: value,
        recipients: tasks.map(t => t.assigned_to),
        actingUserId: user?.id,
      })
      await logActivity(supabase, {
        workspaceId: neg.workspace_id || workspaceId, negotiationId: neg.id, type: 'status_changed',
        title: `Estado cambió de "${prevValue}" a "${value}"`, actorId: user?.id,
      })
      setActivityRefresh(v => v + 1)
    }
    if (field === 'currency' && prevValue !== value) {
      await logActivity(supabase, {
        workspaceId: neg.workspace_id || workspaceId, negotiationId: neg.id, type: 'deal_value_updated',
        title: `Moneda del deal cambiada a "${value}"`, actorId: user?.id,
      })
      setActivityRefresh(v => v + 1)
    }
    onActivityChanged?.()
  }

  async function handleToggleActivity() {
    const next = activityStatus === 'paused' ? 'active' : 'paused'
    await supabase.from('negotiations').update({ activity_status: next }).eq('id', neg.id)
    setActivityStatus(next)
    onActivityChanged?.()
  }

  async function handleDelete() {
    await supabase.from('negotiations').delete().eq('id', neg.id)
    onDeleted()
    onClose()
  }

  async function handleToggleTask(task) {
    if (task.status === 'done' || isTaskBlocked(task)) return
    await supabase.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', task.id)
    await notifySuccessors(supabase, task, neg.workspace_id || workspaceId)
    await dismissNotificationsForTask(supabase, task.id)
    await logActivity(supabase, {
      workspaceId: neg.workspace_id || workspaceId, negotiationId: neg.id, type: 'task_completed',
      title: `Tarea completada: "${task.title}"`, actorId: user?.id,
    })
    fetchTasks()
    setActivityRefresh(v => v + 1)
  }

  function statusLabel(status) {
    const map = { pending: 'Pendiente', in_progress: 'En progreso', done: 'Hecho' }
    return map[status] || status
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="neg-detail-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header modal-header--sticky">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 className="modal-title">{neg.product || neg.title}</h2>
            {activityStatus === 'paused' && (
              <span className="neg-activity-badge paused">⏸ Pausado</span>
            )}
            {activityStatus === 'inactive' && (
              <span className="neg-activity-badge inactive">💤 Inactivo</span>
            )}
          </div>
          <div className="modal-header-actions">
            {canEdit && <button className="btn-edit" onClick={onEdit}>✏️ Editar</button>}
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="neg-detail-body">
          <div className="neg-detail-hero">
            <div className="neg-detail-entity">
              {flag && <img src={flag} alt="" className="neg-flag-large" />}
              <span className="neg-detail-entity-name">{entityNames}</span>
            </div>
            {canEditInline ? (
              <select
                className="neg-inline-select"
                value={inlineStatus}
                style={{ backgroundColor: cfg.bg_color, color: cfg.color }}
                onChange={e => { setInlineStatus(e.target.value); saveInlineField('status', e.target.value) }}
              >
                {customStates.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            ) : (
              <span className="neg-status-badge" style={{ backgroundColor: cfg.bg_color, color: cfg.color }}>{inlineStatus}</span>
            )}
          </div>
          <div className="neg-detail-section">
            <div className="detail-section-title">DESCRIPCIÓN</div>
            {canEditInline ? (
              <textarea
                className="neg-inline-obs"
                value={inlineDescription}
                onChange={e => setInlineDescription(e.target.value)}
                onBlur={() => saveInlineField('description', inlineDescription)}
                placeholder="De qué se trata este proyecto: contexto, alcance, términos generales..."
                rows={3}
              />
            ) : (
              <p className="detail-empty" style={{ whiteSpace: 'pre-wrap' }}>{inlineDescription || 'Sin descripción todavía.'}</p>
            )}
          </div>
          {secondaryEntities.length > 0 && (
            <div className="neg-detail-section">
              <div className="detail-section-title">ENTIDADES VINCULADAS</div>
              <div className="neg-secondary-entities">
                {secondaryEntities.map(ne => (
                  <div key={ne.entity.id} className="neg-secondary-entity-row">
                    {ne.entity.country_code && (
                      <img src={`https://flagcdn.com/w20/${ne.entity.country_code.toLowerCase()}.png`} alt="" className="neg-flag" />
                    )}
                    <span className="neg-secondary-entity-name">{ne.entity.name}</span>
                    {ne.role && <span className="neg-secondary-entity-role">{ne.role}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="neg-detail-grid">
            <div className="neg-detail-field">
              <div className="detail-section-title">FECHA</div>
              <div className="neg-detail-value">{neg.target_date || '—'}</div>
            </div>
            <div className="neg-detail-field">
              <div className="detail-section-title">NDA</div>
              {canEditInline ? (
                <select
                  className="neg-inline-select neg-inline-select--small"
                  value={inlineNda}
                  onChange={e => { setInlineNda(e.target.value); saveInlineField('nda', e.target.value) }}
                >
                  {NDA_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <div className="neg-detail-value">{inlineNda}</div>
              )}
            </div>
          </div>
          <div className="neg-detail-section">
            <div className="neg-tasks-header">
              <div className="detail-section-title">VALOR DEL DEAL</div>
              {canEditInline ? (
                <select
                  className="neg-inline-select neg-inline-select--small"
                  value={inlineCurrency}
                  onChange={e => { setInlineCurrency(e.target.value); saveInlineField('currency', e.target.value) }}
                >
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              ) : (
                <span className="neg-detail-value">{inlineCurrency}</span>
              )}
            </div>
            <DealMilestones
              negotiationId={neg.id}
              workspaceId={neg.workspace_id || workspaceId}
              currency={inlineCurrency}
              canEdit={canNote}
              onChanged={() => { setActivityRefresh(v => v + 1); onActivityChanged?.() }}
            />
          </div>
          <div className="neg-detail-section">
            <div className="detail-section-title">DOCUMENTOS</div>
            <Documents
              negotiationId={neg.id}
              workspaceId={neg.workspace_id || workspaceId}
              canEdit={canNote}
              onChanged={() => setActivityRefresh(v => v + 1)}
            />
          </div>
          {neg.participants?.length > 0 && (
            <div className="neg-detail-section">
              <div className="detail-section-title">PARTICIPANTES</div>
              <div className="neg-chips">{neg.participants.map(p => <span key={p} className="neg-chip neg-chip-blue">{p}</span>)}</div>
            </div>
          )}
          {neg.companies?.length > 0 && (
            <div className="neg-detail-section">
              <div className="detail-section-title">EMPRESAS INTERESADAS</div>
              <div className="neg-chips">{neg.companies.map(c => <span key={c} className="neg-chip neg-chip-purple">{c}</span>)}</div>
            </div>
          )}
          {neg.territories?.length > 0 && (
            <div className="neg-detail-section">
              <div className="detail-section-title">TERRITORIOS</div>
              <div className="neg-chips">{neg.territories.map(t => <span key={t} className="neg-chip neg-chip-green">{t}</span>)}</div>
            </div>
          )}
          {customFieldDefs.length > 0 && (
            <div className="neg-detail-section">
              <div className="detail-section-title">CAMPOS PERSONALIZADOS</div>
              <div className="cf-form-fields">
                {customFieldDefs.map(def => (
                  <div key={def.key} className="cf-form-field">
                    <label className="cf-form-field-label">{def.label}</label>
                    {canEditInline ? (
                      <CustomFieldInput def={def} value={getCustomFieldValue(customFieldValues, def.key)} onChange={v => saveCustomField(def.key, v)} />
                    ) : (
                      <p className="detail-empty">{renderCustomFieldDisplay(def, getCustomFieldValue(customFieldValues, def.key))}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="neg-detail-section">
            <div className="detail-section-title">NOTAS</div>
            <NotesPostIts
              negotiationId={neg.id}
              workspaceId={neg.workspace_id || workspaceId}
              canEdit={canNote}
              onChanged={() => { setActivityRefresh(v => v + 1); onNotesChanged?.() }}
              contextLabel={neg.product || neg.title}
            />
          </div>
          <div className="neg-detail-section">
            <div className="detail-section-title">OBSERVACIONES INTERNAS</div>
            {canEditInline ? (
              <textarea
                className="neg-inline-obs"
                value={inlineObs}
                onChange={e => setInlineObs(e.target.value)}
                onBlur={() => saveInlineField('observations', inlineObs)}
                placeholder="Sin observaciones todavía."
                rows={3}
              />
            ) : (
              <p className="detail-empty" style={{ whiteSpace: 'pre-wrap' }}>{inlineObs || 'Sin observaciones todavía.'}</p>
            )}
          </div>
          <div className="neg-detail-section">
            <div className="neg-tasks-header">
              <div className="detail-section-title">TAREAS ({tasks.length})</div>
              {canTask && <button className="neg-add-task-btn" onClick={() => setShowTaskModal(true)}>+ Nueva tarea</button>}
            </div>
            {tasks.length === 0 ? (
              <p className="detail-empty">Sin tareas todavía.</p>
            ) : (() => {
              const myTasks = tasks.filter(t => !t.assigned_to || t.assigned_to === myUserId)
              const otherTasks = tasks.filter(t => t.assigned_to && t.assigned_to !== myUserId)
              const visibleTasks = effectiveRole === 'viewer' ? myTasks : tasks

              return (
                <div className="neg-tasks-list">
                  {visibleTasks.map(task => {
                    const isOther = task.assigned_to && task.assigned_to !== myUserId
                    const showAssignee = isPrivileged || !isOther
                    const blocked = isTaskBlocked(task)
                    const isHighlighted = task.id === highlightTaskId
                    return (
                      <div
                        key={task.id}
                        ref={isHighlighted ? (el) => el?.scrollIntoView({ block: 'center' }) : undefined}
                        className={`neg-task-row ${task.status === 'done' ? 'done' : ''} ${isOther && !isPrivileged ? 'neg-task-row--other' : ''} ${isHighlighted ? 'neg-task-row--highlight' : ''}`}
                      >
                        <button
                          className={`neg-task-check ${task.status === 'done' ? 'checked' : ''}`}
                          onClick={() => canCompleteTask(task) && handleToggleTask(task)}
                          disabled={!canCompleteTask(task)}
                          title={
                            blocked ? 'Esta tarea depende de otra que todavía no se completó'
                            : !canCompleteTask(task) && isOther ? 'Solo el asignado puede completar esta tarea'
                            : undefined
                          }
                        >
                          {task.status === 'done' ? '✓' : blocked ? '🔒' : ''}
                        </button>
                        <div className="neg-task-body">
                          <span className="neg-task-title">
                            {showAssignee && task.profile
                              ? <span style={{ color: '#1D4ED8', fontWeight: 600 }}>@{task.profile.full_name.charAt(0).toUpperCase() + task.profile.full_name.slice(1)}: </span>
                              : isOther ? <span style={{ color: '#9ca3af', fontWeight: 500 }}>Asignado a otro miembro: </span>
                              : null
                            }
                            {task.title}
                          </span>
                          {blocked && (
                            <span className="neg-task-blocked-note">
                              {isPrivileged
                                ? `🔒 Bloqueada por "${task.predecessor.title}" (${task.predecessor.profile?.full_name || 'sin asignar'} · ${statusLabel(task.predecessor.status)})`
                                : '🔒 Pendiente de aprobación previa'}
                            </span>
                          )}
                        </div>
                        <span className={`neg-task-status badge-${task.status}`}>{statusLabel(task.status)}</span>
                        {task.due_date && <span className="neg-task-date">{new Date(task.due_date).toLocaleDateString('es-AR')}</span>}
                      </div>
                    )
                  })}
                  {effectiveRole === 'viewer' && otherTasks.length > 0 && (
                    <div className="neg-task-row neg-task-row--hidden-hint">
                      <span style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}>
                        + {otherTasks.length} tarea{otherTasks.length !== 1 ? 's' : ''} asignada{otherTasks.length !== 1 ? 's' : ''} a otros miembros
                      </span>
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
          <div className="neg-detail-section">
            <div className="detail-section-title">ACTIVIDAD</div>
            <ActivityTimeline negotiationId={neg.id} refreshKey={activityRefresh} />
          </div>
        </div>
        <div className="detail-footer">
          {canPause && (
            <button
              className={`btn-activity ${activityStatus === 'paused' ? 'btn-activity--resume' : 'btn-activity--pause'}`}
              onClick={handleToggleActivity}
              disabled={activityStatus === 'inactive'}
              title={activityStatus === 'inactive' ? 'Este proyecto fue marcado como inactivo automáticamente' : ''}
            >
              {activityStatus === 'paused' ? '▶ Reanudar' : '⏸ Pausar'}
            </button>
          )}
          {canDelete && (
            <button className="btn-delete" onClick={() => setConfirmDelete(true)}>
              Eliminar proyecto
            </button>
          )}
        </div>
      </div>
      {confirmDelete && (
        <DeleteConfirmModal
          itemName={neg.product || neg.title}
          itemType="proyecto"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
      {showTaskModal && (
        <TaskModalInline negotiationId={neg.id} existingTasks={tasks} onClose={() => setShowTaskModal(false)} onCreated={() => { fetchTasks(); setActivityRefresh(v => v + 1) }} />
      )}
    </div>
  )
}

function TaskModalInline({ negotiationId, existingTasks, onClose, onCreated }) {
  const { workspaceId, user } = useAuth()
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState('medium')
  const [dueDate, setDueDate] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [predecessorId, setPredecessorId] = useState('')
  const [members, setMembers] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('workspace_members')
      .select(`user_id, profile:user_id ( full_name, email )`)
      .eq('workspace_id', workspaceId)
      .then(({ data }) => { if (data) setMembers(data) })
  }, [workspaceId])

  async function handleSave() {
    if (!title.trim()) return
    setSaving(true)
    const { data } = await supabase.from('tasks').insert({
      workspace_id: workspaceId,
      title: title.trim(), priority,
      due_date: dueDate || null, assigned_to: assignedTo || null,
      negotiation_id: negotiationId, predecessor_task_id: predecessorId || null,
      status: 'pending',
    }).select('id, title').single()
    setSaving(false)
    if (data) {
      await notifyTaskAssigned(supabase, { workspaceId, task: data, assignedTo, actingUserId: user?.id })
      await logActivity(supabase, {
        workspaceId, negotiationId, type: 'task_created',
        title: `Tarea creada: "${data.title}"`, actorId: user?.id,
      })
    }
    onCreated()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Nueva tarea</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '20px 28px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-group">
            <label>TÍTULO *</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="¿Qué hay que hacer?" autoFocus />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>PRIORIDAD</label>
              <select value={priority} onChange={e => setPriority(e.target.value)}>
                <option value="low">Baja</option>
                <option value="medium">Media</option>
                <option value="high">Alta</option>
                <option value="urgent">Urgente</option>
              </select>
            </div>
            <div className="form-group">
              <label>FECHA LÍMITE</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label>ASIGNAR A</label>
            <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
              <option value="">Sin asignar</option>
              {members.map(m => <option key={m.user_id} value={m.user_id}>{m.profile?.full_name || m.profile?.email || 'Usuario'}</option>)}
            </select>
          </div>
          {existingTasks?.length > 0 && (
            <div className="form-group">
              <label>DEPENDE DE (opcional)</label>
              <select value={predecessorId} onChange={e => setPredecessorId(e.target.value)}>
                <option value="">Ninguna</option>
                {existingTasks.map(t => (
                  <option key={t.id} value={t.id}>{t.title}{t.status === 'done' ? ' (hecha)' : ''}</option>
                ))}
              </select>
            </div>
          )}
          <div className="modal-actions">
            <button className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Guardando...' : 'Crear tarea'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}