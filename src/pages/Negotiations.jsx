import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Table2, LayoutGrid, Kanban } from 'lucide-react'
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
import { getCustomFieldValue, renderCustomFieldDisplay, mergeCustomFieldValue, mergeCustomFieldValues, computeFieldOrder, getMissingRequiredFields, isCustomFieldValueEmpty, isWideCustomField, resolveMemberName, resolveMemberNames, isFieldFilterable, matchesFieldFilter, filterChoicesFor, SPECIAL_FIELD_TYPES } from '../lib/customFields'
import { CustomFieldInput, CustomFieldReadOnly } from '../components/CustomFieldInput'
import { useColumnPrefs, ColumnEditor } from '../components/ColumnEditor'
import FiltersPanelButton from '../components/FiltersPanelButton'
import TableGrid from '../components/TableGrid'
import { CardGrid, CardTile } from '../components/CardGrid'
import { nextSortDir, sortRows, customFieldSortValue } from '../lib/tableSort'
import './Negotiations.css'

const CURRENCIES = ['USD','EUR','GBP','ARS','BRL','MXN','CHF']

// Columnas que NO son un campo custom configurable (calculadas o legacy) —
// product/entities/status/description/companies/participants viven en
// custom_field_definitions y su label sale de ahí, nunca de acá, para no
// duplicar la columna con un label viejo que ignore lo que se configuró en
// Settings (bug real: esta lista tenía esos 6 keys hardcodeados y `.find()`
// devolvía siempre esta entrada primero, tapando el label real).
const ALL_COLUMNS = [
  { key: 'target_date',      label: 'Fecha'                                  },
  { key: 'notes',            label: 'Notas'                                  },
  { key: 'observations',     label: 'Aclaraciones'                           },
  { key: 'activity_status',  label: 'Actividad'                              },
  { key: 'last_activity_at', label: 'Últ. actividad'                         },
]

const ACTIVITY_LABELS = { active: 'En curso', paused: 'Pausado', inactive: 'Inactivo' }

// Solo depende de `neg` (a diferencia de getEntityName/getEntityFlag, que
// necesitan la lista completa de entidades como fallback) — no hace falta
// pasarla como parámetro en ningún lado.
function getProductName(neg) {
  const primary = neg.primary_product || neg.negotiation_products?.map(np => np.product).filter(Boolean)[0] || null
  return primary?.name || '—'
}

// Entidades vinculadas a un proyecto de un tipo dado — reemplaza al viejo
// modelo "principal + secundarias" por uno de una columna por tipo (máx.
// una entidad por tipo, confirmado con el usuario).
function getEntitiesOfType(neg, typeId) {
  return (neg.negotiation_entities || []).filter(ne => ne.entity?.entity_type_id === typeId).map(ne => ne.entity)
}

// El filtro de Estado puede venir de la tarjeta de stats (valor único) o del
// checklist tipo Excel del encabezado de columna (array) — normaliza ambos.
function statusFilterIncludes(filterValue, name) {
  return Array.isArray(filterValue) ? filterValue.includes(name) : filterValue === name
}

// Valor de texto plano por columna para el export CSV — separado de
// renderCell/renderCardField porque esos devuelven JSX con badges/chips.
function getExportValue(key, neg, getEntityName, customFieldDefs, members) {
  if (key.startsWith('entity_type:')) return getEntitiesOfType(neg, key.slice('entity_type:'.length)).map(e => e.name).join(', ')
  switch (key) {
    case 'product': return neg.product || neg.title || ''
    case 'products': { const name = getProductName(neg); return name === '—' ? '' : name }
    case 'status': return neg.status || ''
    case 'description': return neg.description || ''
    case 'companies': return (neg.companies || []).join(', ')
    case 'target_date': return neg.target_date || ''
    case 'participants': return resolveMemberNames(members, neg.participants).join(', ')
    case 'notes': return (neg.notes_list || []).map(n => `${n.note_date}: ${n.content}`).join(' | ')
    case 'observations': return neg.observations || ''
    case 'activity_status': return ACTIVITY_LABELS[neg.activity_status] || ''
    case 'last_activity_at': return neg.last_activity_at ? neg.last_activity_at.slice(0, 10) : ''
    default: {
      const def = customFieldDefs?.find(d => d.key === key)
      if (!def) return ''
      const val = renderCustomFieldDisplay(def, getCustomFieldValue(neg.custom_fields, key), members)
      return val === '—' ? '' : val
    }
  }
}

// Valor comparable por columna para el click-para-ordenar del encabezado —
// null siempre ordena al final, ver sortRows en lib/tableSort.js.
function getNegSortValue(key, neg, getEntityName, customFieldDefs, members) {
  if (key.startsWith('entity_type:')) {
    const names = getEntitiesOfType(neg, key.slice('entity_type:'.length)).map(e => e.name)
    return names.length ? names.join(', ').toLowerCase() : null
  }
  switch (key) {
    case 'product': return (neg.product || neg.title || '').toLowerCase() || null
    case 'products': { const name = getProductName(neg); return name !== '—' ? name.toLowerCase() : null }
    case 'status': return neg.status?.toLowerCase() || null
    case 'description': return neg.description?.toLowerCase() || null
    case 'companies': return neg.companies?.length ? neg.companies.join(', ').toLowerCase() : null
    case 'target_date': { const t = neg.target_date ? new Date(neg.target_date).getTime() : NaN; return Number.isNaN(t) ? null : t }
    case 'participants': { const names = resolveMemberNames(members, neg.participants); return names.length ? names.join(', ').toLowerCase() : null }
    case 'notes': return neg.notes_list?.length || null
    case 'observations': return neg.observations?.toLowerCase() || null
    case 'activity_status': return neg.activity_status || null
    case 'last_activity_at': { const t = neg.last_activity_at ? new Date(neg.last_activity_at).getTime() : NaN; return Number.isNaN(t) ? null : t }
    default: return customFieldSortValue(customFieldDefs?.find(d => d.key === key), neg, members, getCustomFieldValue, renderCustomFieldDisplay)
  }
}

// Excel real (.xlsx) en vez de CSV: evita de raíz los problemas de
// delimitador (coma vs ";" según configuración regional) y de codificación
// de acentos que sí aparecen con texto plano tipo CSV.
// xlsx/jspdf se cargan bajo demanda (import dinámico) para no sumarlos al
// bundle inicial de /negotiations — son acciones ocasionales, no parte del
// flujo principal de la página.
async function exportNegotiationsXlsx(negotiations, cols, getEntityName, customFieldDefs, members, entityTypes = []) {
  const XLSX = await import('xlsx')
  const visibleCols = cols.filter(c => c.visible)
  const headers = visibleCols.map(c => {
    if (c.key.startsWith('entity_type:')) {
      const et = entityTypes.find(t => t.id === c.key.slice('entity_type:'.length))
      return et?.plural || et?.name || c.key
    }
    return customFieldDefs.find(d => d.key === c.key)?.label || ALL_COLUMNS.find(x => x.key === c.key)?.label || c.key
  })
  const rows = [
    headers,
    ...negotiations.map(neg => visibleCols.map(c => getExportValue(c.key, neg, getEntityName, customFieldDefs, members))),
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = visibleCols.map(() => ({ wch: 22 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Proyectos')
  XLSX.writeFile(wb, `nerva-proyectos-${new Date().toISOString().slice(0, 10)}.xlsx`)
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
  const [entityTypes, setEntityTypes] = useState([])
  const [products, setProducts] = useState([])
  const [members, setMembers] = useState([])
  const [customStates, setCustomStates] = useState([])
  const [customFieldDefs, setCustomFieldDefs] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState(() => (typeof window !== 'undefined' && window.innerWidth <= 860) ? 'cards' : 'table')
  const [customFilterValues, setCustomFilterValues] = useState({})
  const [entityTypeFilters, setEntityTypeFilters] = useState({})
  const [filterActivity, setFilterActivity] = useState('active')
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState(null)

  function handleSort(key) {
    const dir = nextSortDir(key, sortKey, sortDir)
    setSortDir(dir)
    setSortKey(dir ? key : null)
  }
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [selectedNeg, setSelectedNeg] = useState(null)
  const [editingNeg, setEditingNeg] = useState(null)
  const [showColEditor, setShowColEditor] = useState(false)
  // El campo `entities_link` ya no se muestra como una sola columna genérica:
  // se reemplaza por una columna virtual por cada tipo de entidad del
  // workspace (key `entity_type:<id>`), así la tabla/tarjetas muestran
  // "Cliente", "Proveedor", "Distribuidor"... según lo que exista en Entidades.
  const entitiesLinkDef = customFieldDefs.find(d => d.field_type === 'entities_link')
  const entityTypeColumnDefs = entitiesLinkDef ? entityTypes.map(et => ({ key: `entity_type:${et.id}`, label: et.plural || et.name })) : []
  const columnFieldDefs = [...customFieldDefs.filter(d => d.field_type !== 'entities_link'), ...entityTypeColumnDefs]
  const defaultVisible = ['product', ...entityTypeColumnDefs.map(d => d.key), 'status', 'companies', 'target_date']
  const [cols, saveCols] = useColumnPrefs({
    storageKey: `nerva_col_prefs_${user?.id}`,
    staticColumns: ALL_COLUMNS,
    defaultVisible,
    customFieldDefs: columnFieldDefs,
  })
  const allColumns = [...columnFieldDefs.map(d => ({ key: d.key, label: d.label, alwaysVisible: d.key === 'product' })), ...ALL_COLUMNS]
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
    const [negsRes, entitiesRes, entityTypesRes, productsRes, membersRes, statesRes, milestonesRes, customFieldsRes] = await Promise.all([
      supabase.from('negotiations').select('*, primary_entity:primary_entity_id(id, name, country_code), primary_product:primary_product_id(id, name)').order('created_at', { ascending: false }),
      supabase.from('entities').select('id, name, country_code, entity_type_id').order('name'),
      supabase.from('entity_types').select('id, name, plural').order('sort_order'),
      supabase.from('products').select('id, name').order('name'),
      supabase.from('workspace_members').select(`user_id, profile:user_id ( full_name )`).eq('workspace_id', workspaceId),
      supabase.from('custom_states').select('*').eq('object_type', 'negotiation').order('sort_order'),
      supabase.from('deal_milestones').select('negotiation_id, amount').eq('workspace_id', workspaceId),
      supabase.from('custom_field_definitions').select('*').eq('workspace_id', workspaceId).eq('object_type', 'negotiation').order('sort_order'),
    ])
    setCustomFieldDefs(customFieldsRes.data || [])

    if (negsRes.error) { setLoading(false); return }
    setMilestones(milestonesRes.data || [])

    const negIds = negsRes.data.map(n => n.id)
    const [{ data: negEntities }, { data: negProducts }, { data: negNotes }] = await Promise.all([
      supabase
        .from('negotiation_entities')
        .select('negotiation_id, entity_id, role, entity:entity_id(id, name, country_code, entity_type_id)')
        .in('negotiation_id', negIds),
      supabase
        .from('negotiation_products')
        .select('negotiation_id, product_id, product:product_id(id, name)')
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
      negotiation_products: (negProducts || []).filter(np => np.negotiation_id === neg.id),
      notes_list: (negNotes || []).filter(n => n.negotiation_id === neg.id),
    }))

    setNegotiations(combined)
    if (entitiesRes.data) setEntities(entitiesRes.data)
    if (entityTypesRes.data) setEntityTypes(entityTypesRes.data)
    if (productsRes.data) setProducts(productsRes.data)
    if (membersRes.data) setMembers(membersRes.data)
    if (statesRes.data) setCustomStates(statesRes.data)
    setLoading(false)
  }

  async function refetchSingleNeg(id) {
    const [{ data: neg }, { data: ents }, { data: prods }, { data: notesList }] = await Promise.all([
      supabase.from('negotiations').select('*, primary_entity:primary_entity_id(id, name, country_code), primary_product:primary_product_id(id, name)').eq('id', id).single(),
      supabase.from('negotiation_entities').select('negotiation_id, entity_id, entity:entity_id(id, name, country_code, entity_type_id)').eq('negotiation_id', id),
      supabase.from('negotiation_products').select('negotiation_id, product_id, product:product_id(id, name)').eq('negotiation_id', id),
      supabase.from('negotiation_notes').select('id, negotiation_id, content, note_date').eq('negotiation_id', id).order('note_date'),
    ])
    if (!neg) return null
    return { ...neg, negotiation_entities: ents || [], negotiation_products: prods || [], notes_list: notesList || [] }
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

  const filterableDefs = customFieldDefs.filter(isFieldFilterable)
  const statusDef = customFieldDefs.find(d => d.field_type === 'status')

  // Grupos del botón "Filtros" (Mosaico/Kanban no tienen encabezado de
  // columna) — Estado queda afuera porque ya tiene sus tarjetas propias,
  // siempre visibles en las 3 vistas.
  const filterPanelGroups = [
    ...entityTypeColumnDefs.map(et => ({
      key: et.key,
      label: et.label,
      options: entities.filter(en => en.entity_type_id === et.key.slice('entity_type:'.length)).map(en => ({ id: en.id, label: en.name })),
      selected: entityTypeFilters[et.key.slice('entity_type:'.length)] || [],
      onChange: v => setEntityTypeFilters(prev => ({ ...prev, [et.key.slice('entity_type:'.length)]: v })),
    })),
    ...filterableDefs.filter(d => d.field_type !== 'status').map(def => {
      const value = customFilterValues[def.key]
      return {
        key: def.key,
        label: def.label,
        options: filterChoicesFor(def, { customStates, members }),
        selected: Array.isArray(value) ? value : (value ? [value] : []),
        onChange: v => setCustomFilterValues(prev => ({ ...prev, [def.key]: v })),
      }
    }),
  ]

  const filtered = negotiations.filter(n => {
    if (!filterableDefs.every(def => matchesFieldFilter(def, n, customFilterValues[def.key]))) return false
    for (const [typeId, entityIds] of Object.entries(entityTypeFilters)) {
      if (!entityIds || entityIds.length === 0) continue
      const ids = (n.negotiation_entities || []).filter(ne => ne.entity?.entity_type_id === typeId).map(ne => ne.entity.id)
      if (!entityIds.some(id => ids.includes(id))) return false
    }
    if (filterActivity === 'active') { if (n.activity_status !== 'active') return false }
    if (filterActivity === 'paused') { if (n.activity_status !== 'paused') return false }
    if (filterActivity === 'inactive') { if (n.activity_status !== 'inactive') return false }
    if (filterActivity === 'low_activity') {
      if (!(n.activity_status === 'active' && n.status !== 'Completado' &&
            n.last_activity_at < day90ago && n.last_activity_at >= day120ago)) return false
    }
    if (search) {
      const q = search.toLowerCase()
      const matchesProject = n.title?.toLowerCase().includes(q) || n.product?.toLowerCase().includes(q)
      const linkedProduct = getProductName(n)
      const matchesProduct = linkedProduct !== '—' && linkedProduct.toLowerCase().includes(q)
      if (!matchesProject && !matchesProduct) return false
    }
    return true
  })

  // Orden por columna (click en el encabezado de Tabla, o el selector de
  // Tarjetas) — mismo estado para ambas vistas, así se mantienen en sync.
  const sorted = sortKey
    ? sortRows(filtered, n => getNegSortValue(sortKey, n, getEntityName, customFieldDefs, members), sortDir)
    : filtered

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
    exportNegotiationsXlsx(exportRows(), cols, getEntityName, customFieldDefs, members, entityTypes)
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
        members,
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
            className={`neg-stat-card ${statusDef && statusFilterIncludes(customFilterValues[statusDef.key], s.name) ? 'active' : ''}`}
            onClick={() => {
              if (!statusDef) return
              setCustomFilterValues(v => {
                const cur = v[statusDef.key]
                const arr = Array.isArray(cur) ? cur : (cur ? [cur] : [])
                return { ...v, [statusDef.key]: arr.includes(s.name) ? arr.filter(x => x !== s.name) : [...arr, s.name] }
              })
            }}
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
          <label className="filter-field-label">Actividad</label>
          <select className="neg-select" value={filterActivity} onChange={e => setFilterActivity(e.target.value)}>
            <option value="active">En curso</option>
            <option value="paused">Pausados</option>
            <option value="inactive">Inactivos</option>
            <option value="low_activity">Baja actividad</option>
            <option value="">Todos (activos e inactivos)</option>
          </select>
        </div>
        <FiltersPanelButton groups={filterPanelGroups} />
        <div className="neg-view-toggle">
          <button className={`neg-view-btn ${view === 'table' ? 'active' : ''}`} onClick={() => setView('table')} title="Vista tabla"><Table2 size={15} /></button>
          <button className={`neg-view-btn ${view === 'cards' ? 'active' : ''}`} onClick={() => setView('cards')} title="Vista cards"><LayoutGrid size={15} /></button>
          <button className={`neg-view-btn ${view === 'kanban' ? 'active' : ''}`} onClick={() => setView('kanban')} title="Vista kanban"><Kanban size={15} /></button>
        </div>
        {view === 'cards' && (
          <div className="neg-sort-select">
            <select
              value={sortKey || ''}
              onChange={e => { const k = e.target.value; setSortKey(k || null); setSortDir(k ? (sortDir || 'asc') : null) }}
            >
              <option value="">Ordenar por...</option>
              {allColumns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            {sortKey && (
              <button type="button" className="neg-col-btn" onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')} title="Cambiar dirección">
                {sortDir === 'desc' ? '▼' : '▲'}
              </button>
            )}
          </div>
        )}
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
          negotiationFieldDefs={customFieldDefs}
          onClose={() => setShowImportModal(false)}
          onImported={fetchAll}
        />
      )}

      {loading ? (
        <div className="neg-loading">Cargando proyectos...</div>
      ) : filtered.length === 0 ? (
        <div className="neg-empty">No hay proyectos todavía.</div>
      ) : view === 'table' ? (
        <TableView negotiations={sorted} getStateConfig={getStateConfig} getEntityName={getEntityName} getEntityFlag={getEntityFlag} onSelect={setSelectedNeg} cols={cols} allColumns={allColumns} customFieldDefs={customFieldDefs} members={members}
          selectedIds={selectedIds} onToggleSelect={toggleSelect} allVisibleSelected={allVisibleSelected} onToggleSelectAll={toggleSelectAllVisible}
          sortKey={sortKey} sortDir={sortDir} onSort={handleSort}
          customStates={customStates} customFilterValues={customFilterValues} onFilterChange={(key, v) => setCustomFilterValues(prev => ({ ...prev, [key]: v }))}
          entities={entities} entityTypeFilters={entityTypeFilters} onEntityTypeFilterChange={(typeId, v) => setEntityTypeFilters(prev => ({ ...prev, [typeId]: v }))}
          onColResize={(key, width) => saveCols(cols.map(c => c.key === key ? { ...c, width } : c))} />
      ) : view === 'cards' ? (
        <CardsView negotiations={sorted} getStateConfig={getStateConfig} getEntityName={getEntityName} getEntityFlag={getEntityFlag} onSelect={setSelectedNeg} cols={cols} customFieldDefs={customFieldDefs} members={members}
          selectedIds={selectedIds} onToggleSelect={toggleSelect} />
      ) : (
        <KanbanView negotiations={filtered} customStates={customStates} getStateConfig={getStateConfig} getEntityName={getEntityName} getEntityFlag={getEntityFlag} cols={cols} customFieldDefs={customFieldDefs} members={members}
          onSelect={setSelectedNeg} canEdit={canCreateProject} onMove={handleKanbanMove} />
      )}

      {showModal && (
        <NegotiationModal
          initial={editingNeg}
          entities={entities}
          entityTypes={entityTypes}
          products={products}
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
          entityTypes={entityTypes}
          customStates={customStates}
          customFieldDefs={customFieldDefs}
          members={members}
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
// Render de una celda según el key de columna
function renderCell(key, neg, getStateConfig, getEntityName, getEntityFlag, customFieldDefs, members) {
  const cfg = getStateConfig(neg.status)

  if (key.startsWith('entity_type:')) {
    const ents = getEntitiesOfType(neg, key.slice('entity_type:'.length))
    if (ents.length === 0) return <td key={key}>—</td>
    return (
      <td key={key} className="neg-td-entity">
        <span className="neg-entity-name">
          {ents[0].country_code && <img src={`https://flagcdn.com/w20/${ents[0].country_code.toLowerCase()}.png`} alt="" className="neg-flag" />}
          {ents.map(e => e.name).join(', ')}
        </span>
      </td>
    )
  }

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
    case 'products':
      return <td key={key}>{getProductName(neg)}</td>
    case 'status':
      return <td key={key}><span className="neg-status-badge" style={{ backgroundColor: cfg.bg_color, color: cfg.color }}>{neg.status}</span></td>
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
    case 'participants': {
      const names = resolveMemberNames(members, neg.participants)
      return (
        <td key={key}>
          <div className="neg-chips">
            {names.slice(0, 2).map(n => <span key={n} className="neg-chip neg-chip-blue">{n}</span>)}
            {names.length > 2 && <span className="neg-chip neg-chip-gray">+{names.length - 2}</span>}
          </div>
        </td>
      )
    }
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
      return <td key={key} className="neg-td-text">{renderCustomFieldDisplay(def, getCustomFieldValue(neg.custom_fields, key), members)}</td>
    }
  }
}

function TableView({ negotiations, getStateConfig, getEntityName, getEntityFlag, onSelect, cols, allColumns, customFieldDefs, members, selectedIds, onToggleSelect, allVisibleSelected, onToggleSelectAll, sortKey, sortDir, onSort, customStates, customFilterValues, onFilterChange, entities, entityTypeFilters, onEntityTypeFilterChange, onColResize }) {
  function getColumnFilter(key) {
    if (key.startsWith('entity_type:')) {
      const typeId = key.slice('entity_type:'.length)
      return {
        options: entities.filter(en => en.entity_type_id === typeId).map(en => ({ id: en.id, label: en.name })),
        selected: entityTypeFilters?.[typeId] || [],
        onChange: v => onEntityTypeFilterChange(typeId, v),
      }
    }
    const fieldDef = customFieldDefs.find(d => d.key === key)
    if (!fieldDef || !isFieldFilterable(fieldDef)) return null
    const filterValue = customFilterValues?.[key]
    return {
      options: filterChoicesFor(fieldDef, { customStates, members }),
      selected: Array.isArray(filterValue) ? filterValue : (filterValue ? [filterValue] : []),
      onChange: v => onFilterChange(key, v),
    }
  }

  return (
    <TableGrid
      rows={negotiations}
      rowKey={neg => neg.id}
      cols={cols}
      allColumns={allColumns}
      renderCell={(key, neg) => renderCell(key, neg, getStateConfig, getEntityName, getEntityFlag, customFieldDefs, members)}
      getColumnFilter={getColumnFilter}
      sortKey={sortKey}
      sortDir={sortDir}
      onSort={onSort}
      onColResize={onColResize}
      showCheckbox
      selectedIds={selectedIds}
      onToggleSelect={onToggleSelect}
      allVisibleSelected={allVisibleSelected}
      onToggleSelectAll={onToggleSelectAll}
      onSelectRow={onSelect}
      rowClassName={neg => neg.activity_status === 'paused' ? 'neg-row-paused' : neg.activity_status === 'inactive' ? 'neg-row-inactive' : ''}
    />
  )
}

function renderCardField(key, neg, getStateConfig, getEntityName, getEntityFlag, customFieldDefs, members) {
  if (key.startsWith('entity_type:')) {
    const ents = getEntitiesOfType(neg, key.slice('entity_type:'.length))
    if (ents.length === 0) return null
    return (
      <div key={key} className="neg-card-entity">
        {ents[0].country_code && <img src={`https://flagcdn.com/w20/${ents[0].country_code.toLowerCase()}.png`} alt="" className="neg-flag" />}
        {ents.map(e => e.name).join(', ')}
      </div>
    )
  }
  switch (key) {
    case 'products': {
      const name = getProductName(neg)
      if (name === '—') return null
      return <div key={key} className="neg-card-entity">{name}</div>
    }
    case 'companies':
      if (!neg.companies?.length) return null
      return (
        <div key={key} className="neg-chips neg-card-field">
          {neg.companies.slice(0, 2).map(c => <span key={c} className="neg-chip neg-chip-purple">{c}</span>)}
          {neg.companies.length > 2 && <span className="neg-chip neg-chip-gray">+{neg.companies.length - 2}</span>}
        </div>
      )
    case 'participants': {
      const names = resolveMemberNames(members, neg.participants)
      if (!names.length) return null
      return (
        <div key={key} className="neg-chips neg-card-field">
          {names.slice(0, 2).map(n => <span key={n} className="neg-chip neg-chip-blue">{n}</span>)}
          {names.length > 2 && <span className="neg-chip neg-chip-gray">+{names.length - 2}</span>}
        </div>
      )
    }
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
      const rendered = renderCustomFieldDisplay(def, getCustomFieldValue(neg.custom_fields, key), members)
      if (rendered === '—') return null
      return <div key={key} className="neg-card-text neg-card-field">{rendered}</div>
    }
  }
}

function CardsView({ negotiations, getStateConfig, getEntityName, getEntityFlag, onSelect, cols, customFieldDefs, members, selectedIds, onToggleSelect }) {
  // Columnas visibles excluyendo product y status (que van hardcodeados en el header)
  const visibleFields = cols.filter(c => c.visible && c.key !== 'product' && c.key !== 'status')

  return (
    <CardGrid>
      {negotiations.map(neg => {
        const cfg = getStateConfig(neg.status)
        const actIcon = neg.activity_status === 'inactive' ? '💤' : neg.activity_status === 'paused' ? '⏸' : null
        const cardClass = neg.activity_status === 'paused' ? 'card-tile-paused' : neg.activity_status === 'inactive' ? 'card-tile-inactive' : ''
        const title = neg.product || neg.title
        const fields = visibleFields.map(c => renderCardField(c.key, neg, getStateConfig, getEntityName, getEntityFlag, customFieldDefs, members)).filter(Boolean)
        return (
          <CardTile
            key={neg.id}
            avatarLabel={title}
            title={title}
            titlePrefix={actIcon && <span className={`neg-paused-icon ${neg.activity_status === 'inactive' ? 'neg-icon-inactive' : 'neg-icon-paused'}`}>{actIcon}</span>}
            headerRight={<span className="neg-status-badge" style={{ backgroundColor: cfg.bg_color, color: cfg.color }}>{neg.status}</span>}
            footer={fields.length > 0 ? fields : null}
            selected={selectedIds.has(neg.id)}
            showCheckbox
            onToggleSelect={() => onToggleSelect(neg.id)}
            onClick={() => onSelect(neg)}
            className={cardClass}
          />
        )
      })}
    </CardGrid>
  )
}

function KanbanView({ negotiations, customStates, getStateConfig, getEntityName, getEntityFlag, onSelect, canEdit, onMove, cols, customFieldDefs, members }) {
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
                    {visibleFields.map(c => renderCardField(c.key, neg, getStateConfig, getEntityName, getEntityFlag, customFieldDefs, members))}
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

// NOTA: el combobox con buscador + chips que vivía acá (usado antes por
// Participantes/Empresas/Territorios como campos fijos) se sacó por no
// tener más call sites — Participantes y Clientes/Potenciales clientes
// ahora son campos custom genéricos (tipo Usuario múltiple / selección
// múltiple). Si en el futuro se rediseña el widget de selección múltiple
// para que no muestre todas las opciones como checkboxes (pendiente
// explícito, ver PENDIENTES.md), este es el patrón a reusar — buscar en
// el historial de git este archivo si hace falta el código exacto.

export function NegotiationModal({ initial, presetEntity, entities, entityTypes = [], products = [], members, customStates, customFieldDefs = [], onClose, onCancel, onSaved, workspaceId, userId }) {
  const gridDefs = customFieldDefs.filter(d => d.field_type !== 'financial')
  const financialDef = customFieldDefs.find(d => d.field_type === 'financial')

  const empty = {
    title: '', product: '', status: customStates[0]?.name || 'Contactado',
    target_date: '', description: '', observations: '',
    companies: [], participants: [],
    entity_by_type: presetEntity?.entity_type_id ? { [presetEntity.entity_type_id]: presetEntity.id } : {}, // { [entityTypeId]: entityId }
    product_ids: [], // [{ id }]
    tasks: [],
    currency: 'USD', milestones: [], custom_fields: {}
  }
  const [form, setForm] = useState(initial ? {
    ...empty, ...initial,
    entity_by_type: (() => {
      const byType = {}
      for (const ne of initial.negotiation_entities || []) {
        if (ne.entity?.id && ne.entity?.entity_type_id) byType[ne.entity.entity_type_id] = ne.entity.id
      }
      return byType
    })(),
    product_ids: (() => {
      const ids = initial.negotiation_products?.map(np => ({ id: np.product?.id })).filter(p => p.id) || []
      const primaryIdx = ids.findIndex(p => p.id === initial.primary_product_id)
      return primaryIdx > 0 ? [ids[primaryIdx], ...ids.filter((_, i) => i !== primaryIdx)] : ids
    })(),
    tasks: [],
    currency: initial.currency || 'USD', milestones: [],
    custom_fields: Object.fromEntries(Object.entries(initial.custom_fields || {}).map(([k, v]) => [k, v?.value])),
  } : empty)
  const [productSearch, setProductSearch] = useState('')
  const [productDropdownOpen, setProductDropdownOpen] = useState(false)
  const productRef = useRef(null)
  const [newTask, setNewTask] = useState('')
  const [newTaskAssignee, setNewTaskAssignee] = useState('')
  const [newMilestoneName, setNewMilestoneName] = useState('')
  const [newMilestoneAmount, setNewMilestoneAmount] = useState('')
  const [newMilestoneDate, setNewMilestoneDate] = useState('')
  const [newMilestoneTiming, setNewMilestoneTiming] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [fieldOrder, setFieldOrder] = useState(null)

  useEffect(() => {
    supabase.from('workspaces').select('field_order').eq('id', workspaceId).single()
      .then(({ data }) => setFieldOrder(data?.field_order || {}))
  }, [workspaceId])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  // Para "obligatorio": un array vacío cuenta como vacío (ver isCustomFieldValueEmpty
  // en customFields.js) — entity_by_type es un objeto {tipoId: entityId}, así que para
  // la validación se aplana a la lista de ids realmente asignados.
  function fieldValue(def) {
    if (def.field_type === 'entities_link') return Object.values(form.entity_by_type).filter(Boolean)
    if (def.field_type === 'products_link') return form.product_ids
    return def.storage_column ? form[def.storage_column] : form.custom_fields[def.key]
  }

  function primaryEntityId() {
    for (const et of entityTypes) {
      if (form.entity_by_type[et.id]) return form.entity_by_type[et.id]
    }
    return null
  }

  function setFieldValue(def, v) {
    if (def.storage_column) set(def.storage_column, v)
    else set('custom_fields', { ...form.custom_fields, [def.key]: v })
  }

  async function handleSave() {
    const validationValues = Object.fromEntries(gridDefs.map(def => [def.key, fieldValue(def)]))
    const missing = getMissingRequiredFields(gridDefs, validationValues)
    if (missing.length > 0) { setError(`Faltan completar campos obligatorios: ${missing.join(', ')}`); return }
    setSaving(true)
    const row = {
      workspace_id: workspaceId,
      created_by: userId,
      observations: form.observations,
      primary_entity_id: primaryEntityId(),
      primary_product_id: form.product_ids[0]?.id || null,
    }
    if (financialDef) row.currency = form.currency
    const jsonbValues = {}
    for (const def of gridDefs) {
      if (def.field_type === 'entities_link' || def.field_type === 'products_link') continue
      if (def.storage_column) row[def.storage_column] = form[def.storage_column]
      else jsonbValues[def.key] = form.custom_fields[def.key]
    }
    row.title = (row.product || form.title || '').toString().trim()
    row.custom_fields = mergeCustomFieldValues(initial?.custom_fields, jsonbValues)
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
      const entityRows = Object.values(form.entity_by_type).filter(Boolean).map(id => ({ negotiation_id: negId, entity_id: id }))
      if (entityRows.length > 0) {
        await supabase.from('negotiation_entities').insert(entityRows)
      }
      await supabase.from('negotiation_products').delete().eq('negotiation_id', negId)
      if (form.product_ids.length > 0) {
        await supabase.from('negotiation_products').insert(
          form.product_ids.map(p => ({ negotiation_id: negId, product_id: p.id }))
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

  function renderField(def) {
    const wide = isWideCustomField(def)
    if (def.field_type === 'entities_link') {
      return (
        <div key={def.key} className="form-group form-group--wide">
          <label>{def.label}{def.required ? ' *' : ''}</label>
          <div className="entity-fields-grid">
            {entityTypes.map(et => (
              <div key={et.id} className="form-group">
                <label>{et.name}</label>
                <select
                  value={form.entity_by_type[et.id] || ''}
                  onChange={e => set('entity_by_type', { ...form.entity_by_type, [et.id]: e.target.value })}
                >
                  <option value="">Sin asignar</option>
                  {entities.filter(en => en.entity_type_id === et.id).map(en => (
                    <option key={en.id} value={en.id}>{en.name}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )
    }
    if (def.field_type === 'products_link') {
      return (
        <div key={def.key} className="form-group form-group--wide" ref={productRef}>
          <label>{def.label}{def.required ? ' *' : ''}</label>
          <div className="entity-combobox">
            <input
              type="text"
              className="entity-search-input"
              placeholder="Buscar y agregar producto..."
              value={productSearch}
              autoComplete="off"
              onChange={e => { setProductSearch(e.target.value); setProductDropdownOpen(true) }}
              onFocus={() => setProductDropdownOpen(true)}
              onBlur={() => setTimeout(() => setProductDropdownOpen(false), 150)}
            />
            {productDropdownOpen && (
              <div className="entity-dropdown">
                {products
                  .filter(p =>
                    !form.product_ids.find(x => x.id === p.id) &&
                    p.name.toLowerCase().includes(productSearch.toLowerCase())
                  )
                  .slice(0, 6)
                  .map(p => (
                    <div
                      key={p.id}
                      className="entity-dropdown-option"
                      onMouseDown={() => {
                        set('product_ids', [...form.product_ids, { id: p.id }])
                        setProductSearch('')
                      }}
                    >
                      {p.name}
                    </div>
                  ))
                }
                {products.filter(p =>
                  !form.product_ids.find(x => x.id === p.id) &&
                  p.name.toLowerCase().includes(productSearch.toLowerCase())
                ).length === 0 && (
                  <div className="entity-dropdown-empty">Sin resultados</div>
                )}
              </div>
            )}
          </div>

          {form.product_ids.length > 0 && (
            <div className="entity-selected-list">
              {form.product_ids.map((p, idx) => {
                const prod = products.find(x => x.id === p.id)
                const isPrimary = idx === 0
                return (
                  <div key={p.id} className={`entity-selected-row ${isPrimary ? 'entity-selected-row--primary' : ''}`}>
                    {isPrimary ? (
                      <span className="entity-primary-badge" title="Se muestra en tabla y mosaico">★ Principal</span>
                    ) : (
                      <button
                        type="button"
                        className="entity-make-primary-btn"
                        title="Marcar como principal"
                        onClick={() => set('product_ids', [p, ...form.product_ids.filter(x => x.id !== p.id)])}
                      >☆</button>
                    )}
                    <span className="entity-selected-name">{prod?.name}</span>
                    <button
                      type="button"
                      className="entity-remove-btn"
                      onClick={() => set('product_ids', form.product_ids.filter(x => x.id !== p.id))}
                    >×</button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )
    }
    if (def.field_type === 'status') {
      return (
        <div key={def.key} className="form-group">
          <label>{def.label}{def.required ? ' *' : ''}</label>
          <select value={form.status} onChange={e => set('status', e.target.value)}>
            {customStates.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </div>
      )
    }
    return (
      <div key={def.key} className={`form-group ${wide ? 'form-group--wide' : ''}`}>
        <label>{def.label}{def.required ? ' *' : ''}</label>
        <CustomFieldInput def={def} value={fieldValue(def)} onChange={v => setFieldValue(def, v)} />
      </div>
    )
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
          <div className="entity-fields-grid">
            {(fieldOrder === null ? gridDefs.map(d => d.key) : computeFieldOrder('negotiation', fieldOrder, gridDefs)).map(key => {
              const def = gridDefs.find(d => d.key === key)
              if (!def) return null
              return renderField(def)
            })}
          </div>
          <div className="form-group">
            <label>OBSERVACIONES INTERNAS</label>
            <textarea value={form.observations} onChange={e => set('observations', e.target.value)} rows={3} placeholder="Notas internas del equipo..." />
          </div>
          {financialDef && (
            <div className="form-group">
              <label>{financialDef.label}{financialDef.required ? ' *' : ''}</label>
              <div className="form-group" style={{ maxWidth: 160, marginBottom: 10 }}>
                <label>MONEDA</label>
                <select value={form.currency} onChange={e => set('currency', e.target.value)}>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
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
          )}
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
        </div>
      </div>
    </div>
  )
}

export function NegotiationDetail({ neg, entities, entityTypes = [], customStates, customFieldDefs = [], members = [], getStateConfig, getEntityFlag, highlightTaskId, onClose, onEdit, onDeleted, onActivityChanged, onNotesChanged }) {
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
  const [inlineObs, setInlineObs] = useState(neg.observations || '')
  const [inlineCurrency, setInlineCurrency] = useState(neg.currency || 'USD')
  const [customFieldValues, setCustomFieldValues] = useState(neg.custom_fields || {})
  const [columnValues, setColumnValues] = useState(() => {
    const init = {}
    for (const def of customFieldDefs) {
      if (def.storage_column) init[def.key] = neg[def.storage_column]
    }
    return init
  })
  const [customFieldError, setCustomFieldError] = useState(null)
  const cfg = getStateConfig(neg.status)
  const flag = getEntityFlag(neg)
  const primaryEntity = neg.primary_entity || neg.negotiation_entities?.map(ne => ne.entity).filter(Boolean)[0] || null
  const entityNames = primaryEntity?.name || '—'
  const primaryProduct = neg.primary_product || neg.negotiation_products?.map(np => np.product).filter(Boolean)[0] || null
  const secondaryProducts = (neg.negotiation_products || []).filter(np => np.product?.id && np.product.id !== primaryProduct?.id)
  const gridDefs = customFieldDefs.filter(d => d.field_type !== 'financial')
  const financialDef = customFieldDefs.find(d => d.field_type === 'financial')
  const entitiesLinkDef = customFieldDefs.find(d => d.field_type === 'entities_link')
  const productsLinkDef = customFieldDefs.find(d => d.field_type === 'products_link')
  const inlineDetailDefs = gridDefs.filter(d => d.field_type !== 'status' && d.field_type !== 'entities_link' && d.field_type !== 'products_link' && d.key !== 'product')

  function fieldValue(def) {
    return def.storage_column ? columnValues[def.key] : getCustomFieldValue(customFieldValues, def.key)
  }

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

  async function saveField(def, value) {
    if (def.required && isCustomFieldValueEmpty(value)) {
      setCustomFieldError(`"${def.label}" es obligatorio`)
      return
    }
    setCustomFieldError(null)
    if (def.storage_column) {
      setColumnValues(v => ({ ...v, [def.key]: value }))
      await saveInlineField(def.storage_column, value)
    } else {
      await saveCustomField(def.key, value)
    }
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
          {customFieldError && <p className="form-error">{customFieldError}</p>}
          {inlineDetailDefs.map(def => (
            <div key={def.key} className="neg-detail-section">
              <div className="detail-section-title">{def.label}{def.required ? ' *' : ''}</div>
              {canEditInline ? (
                <CustomFieldInput def={def} value={fieldValue(def)} onChange={v => saveField(def, v)} />
              ) : (
                <p className="detail-empty"><CustomFieldReadOnly def={def} value={fieldValue(def)} members={members} /></p>
              )}
            </div>
          ))}
          {entitiesLinkDef && entityTypes.some(et => getEntitiesOfType(neg, et.id).length > 0) && (
            <div className="neg-detail-section">
              <div className="detail-section-title">{entitiesLinkDef.label}</div>
              <div className="neg-secondary-entities">
                {entityTypes.map(et => {
                  const ents = getEntitiesOfType(neg, et.id)
                  if (ents.length === 0) return null
                  return (
                    <div key={et.id} className="neg-secondary-entity-row">
                      {ents[0].country_code && (
                        <img src={`https://flagcdn.com/w20/${ents[0].country_code.toLowerCase()}.png`} alt="" className="neg-flag" />
                      )}
                      <span className="neg-secondary-entity-name">{ents.map(e => e.name).join(', ')}</span>
                      <span className="neg-secondary-entity-role">{et.name}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {productsLinkDef && (primaryProduct || secondaryProducts.length > 0) && (
            <div className="neg-detail-section">
              <div className="detail-section-title">{productsLinkDef.label}</div>
              <div className="neg-secondary-entities">
                {primaryProduct && (
                  <div key={primaryProduct.id} className="neg-secondary-entity-row">
                    <span className="neg-secondary-entity-name">{primaryProduct.name}</span>
                    <span className="neg-secondary-entity-role">★ Principal</span>
                  </div>
                )}
                {secondaryProducts.map(np => (
                  <div key={np.product.id} className="neg-secondary-entity-row">
                    <span className="neg-secondary-entity-name">{np.product.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {financialDef && (
            <div className="neg-detail-section">
              <div className="neg-tasks-header">
                <div className="detail-section-title">{financialDef.label}</div>
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
          )}
          <div className="neg-detail-section">
            <div className="detail-section-title">DOCUMENTOS</div>
            <Documents
              negotiationId={neg.id}
              workspaceId={neg.workspace_id || workspaceId}
              canEdit={canNote}
              onChanged={() => setActivityRefresh(v => v + 1)}
            />
          </div>
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