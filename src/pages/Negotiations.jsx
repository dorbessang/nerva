import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Table2, LayoutGrid, Kanban } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useCloseOnOutsideOrEscape } from '../lib/useCloseOnOutsideOrEscape'
import { useEscapeToClose } from '../lib/useEscapeToClose'
import DeleteConfirmModal from '../components/DeleteConfirmModal'
import ImportNegotiationsModal from '../components/ImportNegotiationsModal'
import NotesPostIts from '../components/NotesPostIts'
import ActivityTimeline from '../components/ActivityTimeline'
import DealMilestones, { formatAmount } from '../components/DealMilestones'
import PriceHistory from '../components/PriceHistory'
import Field from '../components/FieldLabel'
import Documents from '../components/Documents'
import { isTaskBlocked, notifySuccessors, notifyTaskAssigned, dismissNotificationsForTask, createTask, fetchPredecessorCandidates } from '../lib/tasks'
import { notifyNegotiationStatusChanged } from '../lib/notifications'
import { logActivity } from '../lib/activity'
import { requestNegotiationCloseApproval, isApprover as isApproverFor } from '../lib/approvals'
import { getCustomFieldValue, renderCustomFieldDisplay, mergeCustomFieldValue, mergeCustomFieldValues, computeFieldOrder, getMissingRequiredFields, isCustomFieldValueEmpty, isWideCustomField, resolveMemberName, resolveMemberNames, isFieldFilterable, matchesAllFieldFilters, filterChoicesFor, describeFieldFilters, SPECIAL_FIELD_TYPES } from '../lib/customFields'
import { CustomFieldInput, CustomFieldReadOnly } from '../components/CustomFieldInput'
import { useColumnPrefs, ColumnEditor } from '../components/ColumnEditor'
import FiltersPanelButton from '../components/FiltersPanelButton'
import TableGrid from '../components/TableGrid'
import TotalStatCard from '../components/StatCards'
import { CardGrid, CardTile } from '../components/CardGrid'
import { nextSortDir, sortRows, customFieldSortValue, naturalSortByName } from '../lib/tableSort'
import { entityHasType } from '../lib/entityTypes'
import { resolveFinancialConfig } from '../lib/financialConfig'
import { matchEntity } from '../lib/entityMatching'
import { fetchFullNegotiation } from '../lib/negotiations'
import { resolveStateConfig, terminalStatusNames } from '../lib/customStates'
import { lowActivityWindow, isLowActivityAlert } from '../lib/lowActivity'
import { sumMilestonesByCurrency } from '../lib/pipeline'
import { isOwner, canEditContent, isPrivileged as isPrivilegedRole } from '../lib/roles'
import { withOwnerApproval } from '../lib/staffActions'
import { applyPlaybook } from '../lib/playbooks'
import LogMeetingModal from '../components/LogMeetingModal'
import './Negotiations.css'

const CURRENCIES = ['USD','EUR','GBP','ARS','BRL','MXN','CHF']

// "1 de sept. 2026" -- mismo helper que PriceHistory.jsx, a mano porque
// toLocaleDateString varía el formato (cero adelante, punto en el mes)
// según el motor.
const QUOTE_MONTHS_ABBR = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sept.', 'oct.', 'nov.', 'dic.']
function formatQuoteDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getDate()} de ${QUOTE_MONTHS_ABBR[d.getMonth()]} ${d.getFullYear()}`
}

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

// Entidades vinculadas a un proyecto de un tipo (rol) dado — una columna por
// tipo, máx. una entidad por tipo (confirmado con el usuario). El rol de cada
// vínculo se guarda en negotiation_entities.role (el dropdown en el que se
// eligió la entidad al armar el proyecto) — no se infiere del entity_type_id
// propio de la entidad, porque una entidad puede tener tipo primario Y
// secundario (ver EntityModal.jsx) y esa ambigüedad no diría en qué rol
// quedó para ESTE proyecto puntual. El fallback a entity_type_id es solo
// por si algún vínculo viejo quedó sin `role` (backfill de la migración).
function getEntitiesOfType(neg, typeId) {
  return (neg.negotiation_entities || [])
    .filter(ne => (ne.role || ne.entity?.entity_type_id) === typeId)
    .map(ne => ne.entity)
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
  const { user, workspaceId, effectiveRole, activeWorkspace, isStaff, role } = useAuth()
  const canCreateProject = canEditContent(effectiveRole)
  const canBulkDelete = isOwner(effectiveRole)
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
  const [fieldOrder, setFieldOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState(() => (typeof window !== 'undefined' && window.innerWidth <= 860) ? 'cards' : 'table')
  const [customFilterValues, setCustomFilterValues] = useState({})
  const [entityTypeFilters, setEntityTypeFilters] = useState({})
  const [filterActivity, setFilterActivity] = useState('active')
  const [filterPendingTasks, setFilterPendingTasks] = useState(false)
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState(null)

  function handleSort(key) {
    const dir = nextSortDir(key, sortKey, sortDir)
    setSortDir(dir)
    setSortKey(dir ? key : null)
  }
  const [search, setSearch] = useState('')
  const hasActiveFilters = search.trim() !== '' || filterActivity !== 'active' || filterPendingTasks
    || Object.values(customFilterValues).some(v => Array.isArray(v) ? v.length > 0 : !!v)
    || Object.values(entityTypeFilters).some(v => Array.isArray(v) ? v.length > 0 : !!v)
  function clearAllFilters() {
    setSearch('')
    setFilterActivity('active')
    setFilterPendingTasks(false)
    setCustomFilterValues({})
    setEntityTypeFilters({})
  }
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
  // Orden preset de columnas (antes de que cada usuario lo reordene a mano)
  // sigue el orden ya armado en Configuración → Campos, no el de creación.
  const plainFieldDefs = customFieldDefs.filter(d => d.field_type !== 'entities_link')
  const orderedFieldDefs = fieldOrder === null
    ? plainFieldDefs
    : computeFieldOrder('negotiation', fieldOrder, plainFieldDefs).map(key => plainFieldDefs.find(d => d.key === key)).filter(Boolean)
  const columnFieldDefs = [...orderedFieldDefs, ...entityTypeColumnDefs]
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
  const [bulkRequestNotice, setBulkRequestNotice] = useState(null)
  const [showImportModal, setShowImportModal] = useState(false)

  // Si viene de uno de los banners globales, pre-filtra por baja actividad
  // o por inactivos
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const filter = params.get('filter')
    if (filter === 'low_activity' || filter === 'inactive') setFilterActivity(filter)
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

  useEffect(() => { if (workspaceId) fetchAll() }, [workspaceId])

  useEffect(() => {
    supabase.from('workspaces').select('field_order').eq('id', workspaceId).single()
      .then(({ data }) => setFieldOrder(data?.field_order || {}))
  }, [workspaceId])

  async function fetchAll() {
    setLoading(true)
    const [negsRes, entitiesRes, entityTypesRes, productsRes, membersRes, statesRes, milestonesRes, customFieldsRes] = await Promise.all([
      supabase.from('negotiations').select('*, primary_entity:primary_entity_id(id, name, country_code), primary_product:primary_product_id(id, name)').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
      supabase.from('entities').select('id, name, country_code, entity_type_id, secondary_entity_type_id').eq('workspace_id', workspaceId).order('name'),
      supabase.from('entity_types').select('id, name, plural').eq('workspace_id', workspaceId).order('sort_order'),
      supabase.from('products').select('id, name, entity:entity_id(name)').eq('workspace_id', workspaceId).order('name'),
      supabase.from('workspace_members').select(`user_id, profile:user_id ( full_name )`).eq('workspace_id', workspaceId).eq('status', 'active'),
      supabase.from('custom_states').select('*').eq('workspace_id', workspaceId).eq('object_type', 'negotiation').order('sort_order'),
      supabase.from('deal_milestones').select('negotiation_id, amount').eq('workspace_id', workspaceId),
      supabase.from('custom_field_definitions').select('*').eq('workspace_id', workspaceId).eq('object_type', 'negotiation').order('sort_order'),
    ])
    setCustomFieldDefs(customFieldsRes.data || [])

    if (negsRes.error) { setLoading(false); return }
    setMilestones(milestonesRes.data || [])

    const negIds = negsRes.data.map(n => n.id)
    const [{ data: negEntities }, { data: negProducts }, { data: negNotes }, { data: pendingTasks }, { data: statusChanges }] = await Promise.all([
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
      // Para el filtro "Con tareas pendientes" — alcanza con saber qué
      // proyectos tienen al menos una, no hace falta traer las tareas enteras.
      supabase
        .from('tasks')
        .select('negotiation_id')
        .in('negotiation_id', negIds)
        .in('status', ['pending', 'in_progress']),
      // Para el contador "días en este estado" — mismo criterio que el
      // Dashboard (última vez que cambió de estado, o desde que se creó si
      // nunca cambió), pero acá por proyecto en vez de promediado.
      supabase
        .from('activity_log')
        .select('negotiation_id, created_at')
        .eq('workspace_id', workspaceId)
        .eq('type', 'status_changed')
        .in('negotiation_id', negIds),
    ])
    const negIdsWithPendingTasks = new Set((pendingTasks || []).map(t => t.negotiation_id))
    const lastStatusChangeByNeg = {}
    for (const row of statusChanges || []) {
      const prev = lastStatusChangeByNeg[row.negotiation_id]
      if (!prev || row.created_at > prev) lastStatusChangeByNeg[row.negotiation_id] = row.created_at
    }

    const combined = negsRes.data.map(neg => ({
      ...neg,
      negotiation_entities: (negEntities || []).filter(ne => ne.negotiation_id === neg.id),
      negotiation_products: (negProducts || []).filter(np => np.negotiation_id === neg.id),
      notes_list: (negNotes || []).filter(n => n.negotiation_id === neg.id),
      has_pending_tasks: negIdsWithPendingTasks.has(neg.id),
      status_since: lastStatusChangeByNeg[neg.id] || neg.created_at,
    }))

    setNegotiations(combined)
    if (entitiesRes.data) setEntities(naturalSortByName(entitiesRes.data))
    if (entityTypesRes.data) setEntityTypes(entityTypesRes.data)
    if (productsRes.data) setProducts(naturalSortByName(productsRes.data))
    if (membersRes.data) setMembers(membersRes.data)
    if (statesRes.data) setCustomStates(statesRes.data)
    setLoading(false)
  }

  async function refetchSingleNeg(id) {
    return fetchFullNegotiation(supabase, id)
  }

  function getStateConfig(status) {
    return resolveStateConfig(customStates, status)
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

  const terminalNames = terminalStatusNames(customStates)
  const activeNegs = negotiations.filter(n => n.activity_status === 'active' && !terminalNames.has(n.status))
  // Cada estado final se muestra por separado — pueden significar cosas
  // distintas (Ganado, Perdido, etc.), agruparlos bajo uno solo escondería
  // esa diferencia.
  const stateCounts = [
    ...customStates
      .filter(s => !s.is_terminal)
      .map(s => ({
        name: s.name,
        color: s.color || '#64748B',
        bg_color: s.bg_color || '#F1F5F9',
        count: activeNegs.filter(n => n.status === s.name).length,
        total: activeNegs.length,
      })),
    ...customStates
      .filter(s => s.is_terminal)
      .map(s => ({
        name: s.name,
        color: s.color || '#059669',
        bg_color: s.bg_color || '#ECFDF5',
        count: negotiations.filter(n => n.status === s.name).length,
        total: negotiations.length,
      })),
  ]

  const lowActivityWindowBounds = lowActivityWindow(
    new Date(),
    activeWorkspace?.low_activity_alert_days,
    activeWorkspace?.low_activity_inactive_days
  )

  const filterableDefs = customFieldDefs.filter(isFieldFilterable)
  const statusDef = customFieldDefs.find(d => d.field_type === 'status')

  // Todo lo que matchea excepto (opcionalmente) el filtro de un campo
  // puntual — así el checklist de cada filtro se arma solo con lo que
  // realmente puede aparecer dado todo lo demás ya elegido (facetado,
  // estilo Excel: filtrar por Cliente=Acme recorta qué países quedan
  // disponibles en el filtro de País), en vez de un catálogo entero.
  function matchesAllNegFilters(n, { excludeDefKey } = {}) {
    if (!matchesAllFieldFilters(filterableDefs, n, customFilterValues, excludeDefKey)) return false
    for (const [typeId, entityIds] of Object.entries(entityTypeFilters)) {
      if (!entityIds || entityIds.length === 0) continue
      const ids = (n.negotiation_entities || []).filter(ne => (ne.role || ne.entity?.entity_type_id) === typeId).map(ne => ne.entity.id)
      if (!entityIds.some(id => ids.includes(id))) return false
    }
    if (filterActivity === 'active') { if (n.activity_status !== 'active') return false }
    if (filterActivity === 'paused') { if (n.activity_status !== 'paused') return false }
    if (filterActivity === 'inactive') { if (n.activity_status !== 'inactive') return false }
    if (filterActivity === 'low_activity') {
      if (!isLowActivityAlert(n, lowActivityWindowBounds, terminalNames)) return false
    }
    if (filterPendingTasks && !n.has_pending_tasks) return false
    if (search) {
      const q = search.toLowerCase()
      const matchesProject = n.title?.toLowerCase().includes(q) || n.product?.toLowerCase().includes(q)
      const linkedProduct = getProductName(n)
      const matchesProduct = linkedProduct !== '—' && linkedProduct.toLowerCase().includes(q)
      if (!matchesProject && !matchesProduct) return false
    }
    return true
  }
  function negFacetRows(excludeDefKey) {
    return negotiations.filter(n => matchesAllNegFilters(n, { excludeDefKey }))
  }

  // Grupos del botón "Filtros" (Mosaico/Kanban no tienen encabezado de
  // columna) — Estado queda afuera porque ya tiene sus tarjetas propias,
  // siempre visibles en las 3 vistas.
  const filterPanelGroups = [
    ...entityTypeColumnDefs.map(et => ({
      key: et.key,
      label: et.label,
      options: entities.filter(en => entityHasType(en, et.key.slice('entity_type:'.length))).map(en => ({ id: en.id, label: en.name })),
      selected: entityTypeFilters[et.key.slice('entity_type:'.length)] || [],
      onChange: v => setEntityTypeFilters(prev => ({ ...prev, [et.key.slice('entity_type:'.length)]: v })),
    })),
    ...filterableDefs.filter(d => d.field_type !== 'status').map(def => {
      const value = customFilterValues[def.key]
      return {
        key: def.key,
        label: def.label,
        options: filterChoicesFor(def, { customStates, members, rows: negFacetRows(def.key) }),
        selected: Array.isArray(value) ? value : (value ? [value] : []),
        onChange: v => setCustomFilterValues(prev => ({ ...prev, [def.key]: v })),
      }
    }),
  ]

  const filtered = negotiations.filter(n => matchesAllNegFilters(n))

  // Aclaración de la tarjeta de subtotal ("N proyectos: Cliente, Activo") —
  // solo nombra lo que el usuario activó a mano, el modo "activos" por
  // defecto de `filterActivity` no cuenta como un filtro puesto adrede.
  const activityFilterLabels = { all: 'Todos', paused: 'Pausados', inactive: 'Inactivos', low_activity: 'Baja actividad' }
  const totalFilterParts = [
    ...describeFieldFilters(filterableDefs, customFilterValues, { customStates, members }),
    ...entityTypeColumnDefs.map(et => {
      const typeId = et.key.slice('entity_type:'.length)
      const ids = entityTypeFilters[typeId]
      if (!ids || ids.length === 0) return null
      return ids.map(id => entities.find(e => e.id === id)?.name || id).join(', ')
    }).filter(Boolean),
    search ? `"${search}"` : null,
    filterActivity !== 'active' ? activityFilterLabels[filterActivity] : null,
  ]

  // Orden por columna (click en el encabezado de Tabla, o el selector de
  // Tarjetas) — mismo estado para ambas vistas, así se mantienen en sync.
  const sorted = sortKey
    ? sortRows(filtered, n => getNegSortValue(sortKey, n, getEntityName, customFieldDefs, members), sortDir)
    : filtered

  // Suma los hitos de pago de un set de proyectos, agrupados por moneda (sin conversión)
  function pipelineByCurrency(negIds) {
    const idSet = new Set(negIds)
    const currencyByNegId = Object.fromEntries(negotiations.map(n => [n.id, n.currency || 'USD']))
    return sumMilestonesByCurrency(milestones.filter(m => idSet.has(m.negotiation_id)), currencyByNegId)
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
    await requestNegotiationCloseApproval(supabase, {
      workspace: activeWorkspace, workspaceId: neg.workspace_id || workspaceId, negotiation: neg,
      prevStatus, newStatus, terminalNames, actorId: user?.id,
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
      await requestNegotiationCloseApproval(supabase, {
        workspace: activeWorkspace, workspaceId: neg.workspace_id || workspaceId, negotiation: neg,
        prevStatus: neg.status, newStatus, terminalNames, actorId: user?.id,
      })
    }))
    setBulkWorking(false)
  }

  async function handleBulkDelete() {
    setBulkWorking(true)
    const ids = [...selectedIds]
    const { requested } = await withOwnerApproval(supabase, {
      isStaff, role, workspaceId, actionType: 'bulk_delete_negotiations',
      payload: { ids, description: `Eliminar ${ids.length} proyecto${ids.length !== 1 ? 's' : ''}` },
    }, async () => {
      await supabase.from('negotiations').delete().in('id', ids)
    })
    setSelectedIds(new Set())
    setShowBulkDeleteConfirm(false)
    setBulkWorking(false)
    if (requested) {
      setBulkRequestNotice('Se mandó la solicitud al owner del workspace para que la apruebe.')
      setTimeout(() => setBulkRequestNotice(null), 4000)
      return
    }
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
        <TotalStatCard label="Total proyectos" plural="proyectos" total={negotiations.length} filteredCount={filtered.length} filterParts={totalFilterParts} />
        {stateCounts.map(s => {
          const pct = s.total ? Math.round((s.count / s.total) * 100) : 0
          return (
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
              <div className="neg-stat-count" style={{ color: s.color }}>{s.count}<span className="neg-stat-pct">{pct}%</span></div>
              <div className="neg-stat-bar">
                <div className="neg-stat-bar-fill" style={{ width: `${pct}%`, backgroundColor: s.color }} />
              </div>
            </div>
          )
        })}
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
                {bulkRequestNotice && <span className="neg-bulk-request-notice">{bulkRequestNotice}</span>}
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
        <button
          type="button"
          className={`pending-tasks-toggle-btn ${filterPendingTasks ? 'active' : ''}`}
          onClick={() => setFilterPendingTasks(v => !v)}
          title="Mostrar solo proyectos con tareas pendientes"
        >
          📋 Con tareas pendientes
        </button>
        {hasActiveFilters && (
          <button type="button" className="clear-filters-btn" onClick={clearAllFilters}>✕ Limpiar filtros</button>
        )}
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
          entityTypes={entityTypes}
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
        <TableView negotiations={sorted} allRows={negotiations} getFacetRows={negFacetRows} getStateConfig={getStateConfig} getEntityName={getEntityName} getEntityFlag={getEntityFlag} onSelect={setSelectedNeg} cols={cols} allColumns={allColumns} customFieldDefs={customFieldDefs} members={members}
          selectedIds={selectedIds} onToggleSelect={toggleSelect} allVisibleSelected={allVisibleSelected} onToggleSelectAll={toggleSelectAllVisible}
          sortKey={sortKey} sortDir={sortDir} onSort={handleSort}
          customStates={customStates} customFilterValues={customFilterValues} onFilterChange={(key, v) => setCustomFilterValues(prev => ({ ...prev, [key]: v }))}
          entities={entities} entityTypeFilters={entityTypeFilters} onEntityTypeFilterChange={(typeId, v) => setEntityTypeFilters(prev => ({ ...prev, [typeId]: v }))}
          onColResize={(key, width) => saveCols(cols.map(c => c.key === key ? { ...c, width } : c))} />
      ) : view === 'cards' ? (
        <CardsView negotiations={sorted} getStateConfig={getStateConfig} getEntityName={getEntityName} getEntityFlag={getEntityFlag} onSelect={setSelectedNeg} cols={cols} customFieldDefs={customFieldDefs} members={members}
          selectedIds={selectedIds} onToggleSelect={toggleSelect} entityTypes={entityTypes} />
      ) : (
        <KanbanView negotiations={filtered} customStates={customStates} getStateConfig={getStateConfig} getEntityName={getEntityName} getEntityFlag={getEntityFlag} cols={cols} customFieldDefs={customFieldDefs} members={members}
          onSelect={setSelectedNeg} canEdit={canCreateProject} onMove={handleKanbanMove} entityTypes={entityTypes} />
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

// Días en el estado actual — última vez que cambió de estado
// (`neg.status_since`, calculado en fetchAll) o desde que se creó si nunca
// cambió. `null` si todavía no llegó ese dato (fetch en curso).
function daysInState(neg) {
  if (!neg.status_since) return null
  return Math.floor((Date.now() - new Date(neg.status_since).getTime()) / (1000 * 60 * 60 * 24))
}

function StatusDaysBadge({ neg }) {
  const days = daysInState(neg)
  if (days === null) return null
  return <span className="neg-status-days" title="Días en este estado">{days === 0 ? 'hoy' : `${days}d`}</span>
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
      return <td key={key}><span className="neg-status-badge" style={{ backgroundColor: cfg.bg_color, color: cfg.color }}>{neg.status}</span> <StatusDaysBadge neg={neg} /></td>
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

function TableView({ negotiations, allRows, getFacetRows, getStateConfig, getEntityName, getEntityFlag, onSelect, cols, allColumns, customFieldDefs, members, selectedIds, onToggleSelect, allVisibleSelected, onToggleSelectAll, sortKey, sortDir, onSort, customStates, customFilterValues, onFilterChange, entities, entityTypeFilters, onEntityTypeFilterChange, onColResize }) {
  function getColumnFilter(key) {
    if (key.startsWith('entity_type:')) {
      const typeId = key.slice('entity_type:'.length)
      return {
        options: entities.filter(en => entityHasType(en, typeId)).map(en => ({ id: en.id, label: en.name })),
        selected: entityTypeFilters?.[typeId] || [],
        onChange: v => onEntityTypeFilterChange(typeId, v),
      }
    }
    const fieldDef = customFieldDefs.find(d => d.key === key)
    if (!fieldDef || !isFieldFilterable(fieldDef)) return null
    const filterValue = customFilterValues?.[key]
    return {
      options: filterChoicesFor(fieldDef, { customStates, members, rows: getFacetRows ? getFacetRows(key) : (allRows || negotiations) }),
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
      getNumber={neg => neg.display_number}
    />
  )
}

function renderCardField(key, neg, getStateConfig, getEntityName, getEntityFlag, customFieldDefs, members, entityTypes) {
  if (key.startsWith('entity_type:')) {
    const typeId = key.slice('entity_type:'.length)
    const ents = getEntitiesOfType(neg, typeId)
    if (ents.length === 0) return null
    const typeLabel = entityTypes?.find(et => et.id === typeId)?.name
    return (
      <div key={key} className="neg-card-entity">
        {typeLabel && <span className="neg-card-entity-type">{typeLabel}:</span>}
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

function CardsView({ negotiations, getStateConfig, getEntityName, getEntityFlag, onSelect, cols, customFieldDefs, members, selectedIds, onToggleSelect, entityTypes }) {
  // Columnas visibles excluyendo product y status (que van hardcodeados en el header)
  const visibleFields = cols.filter(c => c.visible && c.key !== 'product' && c.key !== 'status')

  return (
    <CardGrid>
      {negotiations.map(neg => {
        const cfg = getStateConfig(neg.status)
        const actIcon = neg.activity_status === 'inactive' ? '💤' : neg.activity_status === 'paused' ? '⏸' : null
        const cardClass = neg.activity_status === 'paused' ? 'card-tile-paused' : neg.activity_status === 'inactive' ? 'card-tile-inactive' : ''
        const title = neg.product || neg.title
        const fields = visibleFields.map(c => renderCardField(c.key, neg, getStateConfig, getEntityName, getEntityFlag, customFieldDefs, members, entityTypes)).filter(Boolean)
        return (
          <CardTile
            key={neg.id}
            avatarLabel={title}
            title={title}
            titlePrefix={<>
              <span className="card-tile-number">#{neg.display_number}</span>
              {actIcon && <span className={`neg-paused-icon ${neg.activity_status === 'inactive' ? 'neg-icon-inactive' : 'neg-icon-paused'}`}>{actIcon}</span>}
            </>}
            headerRight={<>
              <span className="neg-status-badge" style={{ backgroundColor: cfg.bg_color, color: cfg.color }}>{neg.status}</span>
              <StatusDaysBadge neg={neg} />
            </>}
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

function KanbanView({ negotiations, customStates, getStateConfig, getEntityName, getEntityFlag, onSelect, canEdit, onMove, cols, customFieldDefs, members, entityTypes }) {
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
                      <span className="card-tile-number">#{neg.display_number}</span>
                      {actIcon && <span className="neg-kanban-card-icon">{actIcon}</span>}
                      {neg.product || neg.title}
                    </div>
                    {visibleFields.map(c => renderCardField(c.key, neg, getStateConfig, getEntityName, getEntityFlag, customFieldDefs, members, entityTypes))}
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

// Buscador + "crear al vuelo" para un tipo de entidad puntual (Cliente/
// Proveedor/Distribuidor...) dentro de un proyecto. Antes de crear una
// entidad nueva, matchea el nombre contra TODAS las entidades del workspace
// (no solo las de este tipo) — si aparece algo parecido con otro tipo (ej.
// "FQM" ya existe como Distribuidor y ahora hace falta como Proveedor), deja
// elegir entre usar la existente sumándole este tipo como secundario, usarla
// tal cual, o crear una entidad nueva de todos modos.
function EntityTypeCombobox({ entityType, allEntities, workspaceId, value, onSelect, onEntityUpserted }) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [resolving, setResolving] = useState(null) // { name, exact, fuzzy }
  const [saving, setSaving] = useState(false)

  const selected = allEntities.find(e => e.id === value)
  const optionsOfType = allEntities.filter(e => entityHasType(e, entityType.id) && e.id !== value)
  const matching = optionsOfType.filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
  const hasExactMatch = optionsOfType.some(e => e.name.toLowerCase() === search.trim().toLowerCase())

  async function createNew(name) {
    setSaving(true)
    const { data, error } = await supabase.from('entities')
      .insert({ workspace_id: workspaceId, name: name.trim(), entity_type_id: entityType.id, status: 'active', needs_review: true })
      .select('*').single()
    setSaving(false)
    if (error) { console.error('createEntityQuick error:', error.message); return }
    onEntityUpserted(data)
    onSelect(data.id)
    setSearch('')
    setOpen(false)
    setResolving(null)
  }

  async function selectExistingEntity(entity, addAsSecondary) {
    if (addAsSecondary && !entity.secondary_entity_type_id && entity.entity_type_id !== entityType.id) {
      const { error } = await supabase.from('entities').update({ secondary_entity_type_id: entityType.id }).eq('id', entity.id)
      if (!error) onEntityUpserted({ ...entity, secondary_entity_type_id: entityType.id })
    }
    onSelect(entity.id)
    setSearch('')
    setOpen(false)
    setResolving(null)
  }

  function startCreate(name) {
    const { exact, fuzzy } = matchEntity(name, allEntities, e => e.name)
    if (exact || fuzzy.length > 0) { setResolving({ name, exact, fuzzy }); return }
    createNew(name)
  }

  return (
    <div className="entity-combobox">
      {selected && (
        <div className="entity-combobox-selected">
          <span className="entity-combobox-selected-name">✓ {selected.name}</span>
          <button type="button" className="entity-combobox-clear" onMouseDown={() => onSelect('')} title="Quitar">✕</button>
        </div>
      )}
      <input
        type="text"
        className="entity-search-input"
        placeholder={selected ? 'Cambiar...' : 'Buscar o crear...'}
        value={search}
        autoComplete="off"
        onChange={e => setSearch(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="entity-dropdown">
          <div className="entity-dropdown-option" onMouseDown={() => { onSelect(''); setSearch(''); setOpen(false) }}>Sin asignar</div>
          {matching.slice(0, 6).map(e => (
            <div key={e.id} className="entity-dropdown-option" onMouseDown={() => { onSelect(e.id); setSearch(''); setOpen(false) }}>
              {e.name}
            </div>
          ))}
          {matching.length === 0 && !search && (
            <div className="entity-dropdown-empty">Sin más opciones de este tipo</div>
          )}
          {search.trim() && !hasExactMatch && (
            <div className="entity-dropdown-option entity-dropdown-option--create" onMouseDown={() => startCreate(search.trim())}>
              + Crear "{search.trim()}"
            </div>
          )}
        </div>
      )}
      {resolving && (
        <div className="quick-create-resolver">
          <p className="quick-create-resolver-title">
            {resolving.exact ? `Ya existe "${resolving.exact.name}"` : 'Encontramos algo parecido:'}
          </p>
          {[...(resolving.exact ? [resolving.exact] : []), ...resolving.fuzzy.map(f => f.candidate)].map(candidate => (
            <button key={candidate.id} type="button" className="quick-create-resolver-option" onClick={() => selectExistingEntity(candidate, candidate.entity_type_id !== entityType.id)}>
              {candidate.entity_type_id === entityType.id
                ? `Usar "${candidate.name}"`
                : `Usar "${candidate.name}" + agregarle ${entityType.name} como tipo secundario`}
            </button>
          ))}
          <button type="button" className="quick-create-resolver-option" onClick={() => createNew(resolving.name)} disabled={saving}>
            Crear "{resolving.name}" de todos modos
          </button>
          <button type="button" className="quick-create-resolver-cancel" onClick={() => setResolving(null)}>Cancelar</button>
        </div>
      )}
    </div>
  )
}

export function NegotiationModal({ initial, presetEntity, entities, entityTypes = [], products = [], members, customStates, customFieldDefs = [], onClose, onCancel, onSaved, workspaceId, userId }) {
  const { activeWorkspace } = useAuth()
  useEscapeToClose(onCancel || onClose)
  const gridDefs = customFieldDefs.filter(d => d.field_type !== 'financial')
  const terminalNames = terminalStatusNames(customStates)

  const empty = {
    title: '', product: '', status: customStates[0]?.name || 'Contactado',
    target_date: '', description: '', observations: '',
    companies: [], participants: [],
    entity_by_type: presetEntity?.entity_type_id ? { [presetEntity.entity_type_id]: presetEntity.id } : {}, // { [entityTypeId]: entityId }
    product_ids: [], // [{ id }]
    tasks: [],
    currency: 'USD', milestones: [], custom_fields: {},
    unit_of_measure: '', payment_terms: '',
    deal_start_date: '', deal_duration_years: '', deal_target_value: '',
  }
  const [form, setForm] = useState(initial ? {
    ...empty, ...initial,
    entity_by_type: (() => {
      const byType = {}
      // El rol de cada vínculo es el que se guardó en negotiation_entities.role
      // (qué dropdown se usó para elegir la entidad en ESTE proyecto) — no el
      // entity_type_id propio de la entidad, que puede matchear más de un rol
      // si tiene tipo secundario. Fallback al tipo propio solo para vínculos
      // viejos sin `role` (antes de la migración que lo backfillea).
      for (const ne of initial.negotiation_entities || []) {
        const roleId = ne.role || ne.entity?.entity_type_id
        if (ne.entity?.id && roleId) byType[roleId] = ne.entity.id
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
  // Copias locales de entidades/productos — cuando se crea uno nuevo al vuelo
  // desde el buscador (o se le agrega un tipo secundario a uno existente),
  // se refleja acá al toque sin esperar el refetch del padre (que sí pasa
  // al guardar/cancelar el modal, así que la lista canónica se termina de
  // sincronizar sola).
  const [localEntities, setLocalEntities] = useState(entities)
  const [localProducts, setLocalProducts] = useState(products)
  const [productSearch, setProductSearch] = useState('')
  const [productDropdownOpen, setProductDropdownOpen] = useState(false)
  const [productResolving, setProductResolving] = useState(null) // { name, exact, fuzzy }
  const [creatingProduct, setCreatingProduct] = useState(false)
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
  const [financialConfig, setFinancialConfig] = useState(resolveFinancialConfig(null))
  const [playbooks, setPlaybooks] = useState([])
  const [playbookId, setPlaybookId] = useState('')

  useEffect(() => {
    supabase.from('workspaces').select('field_order, financial_config').eq('id', workspaceId).single()
      .then(({ data }) => {
        setFieldOrder(data?.field_order || {})
        setFinancialConfig(resolveFinancialConfig(data?.financial_config))
      })
    // El playbook solo tiene sentido al crear (un proyecto ya existente lo
    // aplica desde su pestaña de Tareas, no re-entrando a este modal).
    if (!initial) {
      supabase.from('task_playbooks').select('id, name').eq('workspace_id', workspaceId).order('sort_order')
        .then(({ data }) => setPlaybooks(data || []))
    }
  }, [workspaceId])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  // Producto "creado al vuelo" desde el buscador — todavía no tiene tipo
  // asignado (obligatorio en el alta normal), así que se cuelga de un tipo
  // "Sin categorizar" (se crea una sola vez por workspace, se reusa después).
  async function ensureUncategorizedProductType() {
    const { data: existing } = await supabase.from('product_types')
      .select('id').eq('workspace_id', workspaceId).ilike('name', 'Sin categorizar').maybeSingle()
    if (existing) return existing.id
    const { data: created, error } = await supabase.from('product_types')
      .insert({ workspace_id: workspaceId, name: 'Sin categorizar', sort_order: 999 })
      .select('id').single()
    if (error) { console.error('ensureUncategorizedProductType error:', error.message); return null }
    return created.id
  }

  async function createProductQuick(name) {
    setCreatingProduct(true)
    const productTypeId = await ensureUncategorizedProductType()
    const { data, error } = await supabase.from('products')
      .insert({ workspace_id: workspaceId, name: name.trim(), product_type_id: productTypeId, needs_review: true })
      .select('id, name').single()
    setCreatingProduct(false)
    if (error) { console.error('createProductQuick error:', error.message); return }
    setLocalProducts(prev => [...prev, data])
    set('product_ids', [...form.product_ids, { id: data.id }])
    setProductSearch('')
    setProductResolving(null)
  }

  function startProductCreate(name) {
    const { exact, fuzzy } = matchEntity(name, localProducts, p => p.name)
    if (exact || fuzzy.length > 0) { setProductResolving({ name, exact, fuzzy }); return }
    createProductQuick(name)
  }

  function selectExistingProduct(product) {
    set('product_ids', [...form.product_ids, { id: product.id }])
    setProductSearch('')
    setProductResolving(null)
  }

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
      currency: form.currency,
      unit_of_measure: form.unit_of_measure || null,
      payment_terms: form.payment_terms || null,
      deal_start_date: form.deal_start_date || null,
      deal_duration_years: form.deal_duration_years ? parseInt(form.deal_duration_years, 10) : null,
      deal_target_value: form.deal_target_value ? parseFloat(form.deal_target_value) : null,
    }
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
      const { error: saveError } = await supabase.from('negotiations').update(row).eq('id', initial.id)
      if (saveError) { console.error('update negotiation error:', saveError.message); setError('No se pudo guardar el proyecto'); setSaving(false); return }
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
        await requestNegotiationCloseApproval(supabase, {
          workspace: activeWorkspace, workspaceId, negotiation: { id: initial.id, product: row.product, title: row.title },
          prevStatus: initial.status, newStatus: form.status, terminalNames, actorId: userId,
        })
      }
    } else {
      const { data, error: saveError } = await supabase.from('negotiations').insert(row).select().single()
      if (saveError) { console.error('insert negotiation error:', saveError.message); setError('No se pudo crear el proyecto'); setSaving(false); return }
      negId = data?.id
      if (negId) {
        await logActivity(supabase, {
          workspaceId, negotiationId: negId, type: 'project_created',
          title: `Proyecto "${row.product || row.title}" creado`, actorId: userId,
        })
        if (playbookId) {
          const playbookName = playbooks.find(p => p.id === playbookId)?.name
          await applyPlaybook(supabase, { playbookId, workspaceId, negotiationId: negId, userId })
          await logActivity(supabase, {
            workspaceId, negotiationId: negId, type: 'playbook_applied',
            title: `Playbook aplicado: "${playbookName || ''}"`, actorId: userId,
          })
        }
      }
    }
    if (negId) {
      await supabase.from('negotiation_entities').delete().eq('negotiation_id', negId)
      // role = el tipo (rol) del dropdown en el que se eligió cada entidad —
      // se necesita explícito para no ambiguar cuando la entidad tiene tipo
      // secundario (ver getEntitiesOfType más arriba).
      const entityRows = Object.entries(form.entity_by_type)
        .filter(([, id]) => id)
        .map(([typeId, id]) => ({ negotiation_id: negId, entity_id: id, role: typeId }))
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
                <EntityTypeCombobox
                  entityType={et}
                  allEntities={localEntities}
                  workspaceId={workspaceId}
                  value={form.entity_by_type[et.id] || ''}
                  onSelect={id => set('entity_by_type', { ...form.entity_by_type, [et.id]: id })}
                  onEntityUpserted={entity => setLocalEntities(prev => {
                    const exists = prev.some(e => e.id === entity.id)
                    return exists ? prev.map(e => e.id === entity.id ? entity : e) : [...prev, entity]
                  })}
                />
              </div>
            ))}
          </div>
        </div>
      )
    }
    if (def.field_type === 'products_link') {
      const matchingProducts = localProducts.filter(p =>
        !form.product_ids.find(x => x.id === p.id) &&
        p.name.toLowerCase().includes(productSearch.toLowerCase())
      )
      const hasExactMatch = localProducts.some(p => p.name.toLowerCase() === productSearch.trim().toLowerCase())
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
                {matchingProducts.slice(0, 6).map(p => (
                  <div
                    key={p.id}
                    className="entity-dropdown-option"
                    onMouseDown={() => {
                      set('product_ids', [...form.product_ids, { id: p.id }])
                      setProductSearch('')
                    }}
                  >
                    {p.name}
                    {p.entity?.name && <span className="entity-dropdown-option-entity"> · {p.entity.name}</span>}
                  </div>
                ))}
                {matchingProducts.length === 0 && (
                  <div className="entity-dropdown-empty">Sin resultados</div>
                )}
                {productSearch.trim() && !hasExactMatch && (
                  <div
                    className="entity-dropdown-option entity-dropdown-option--create"
                    onMouseDown={() => startProductCreate(productSearch.trim())}
                  >
                    + Crear "{productSearch.trim()}"
                  </div>
                )}
              </div>
            )}
          </div>

          {productResolving && (
            <div className="quick-create-resolver">
              <p className="quick-create-resolver-title">
                {productResolving.exact ? `Ya existe "${productResolving.exact.name}"` : `¿Puede ser alguno de estos?`}
              </p>
              {[...(productResolving.exact ? [{ candidate: productResolving.exact }] : []), ...productResolving.fuzzy].map(({ candidate }) => (
                <button key={candidate.id} type="button" className="quick-create-resolver-option" onClick={() => selectExistingProduct(candidate)}>
                  Usar "{candidate.name}"{candidate.entity?.name ? ` (${candidate.entity.name})` : ''}
                </button>
              ))}
              <button type="button" className="quick-create-resolver-option" onClick={() => createProductQuick(productResolving.name)} disabled={creatingProduct}>
                Crear "{productResolving.name}" de todos modos
              </button>
              <button type="button" className="quick-create-resolver-cancel" onClick={() => setProductResolving(null)}>Cancelar</button>
            </div>
          )}

          {form.product_ids.length > 0 && (
            <div className="entity-selected-list">
              {form.product_ids.map((p, idx) => {
                const prod = localProducts.find(x => x.id === p.id)
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
                    <span className="entity-selected-name">
                      {prod?.name}
                      {prod?.entity?.name && <span className="entity-dropdown-option-entity"> · {prod.entity.name}</span>}
                    </span>
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
          <div className="form-group form-group--wide">
            <label>FINANCIERO</label>
            <div className="entity-fields-grid">
              <div className="form-group">
                <label>MONEDA</label>
                <select value={form.currency} onChange={e => set('currency', e.target.value)}>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {financialConfig.historial_precio && financialConfig.volumen && (
                <div className="form-group">
                  <label>UNIDAD</label>
                  <input type="text" value={form.unit_of_measure} onChange={e => set('unit_of_measure', e.target.value)}
                    placeholder="Ej: kg, tonelada, litro, unidad, servicio..." />
                </div>
              )}
              {financialConfig.condiciones_pago && (
                <div className="form-group">
                  <label>CONDICIONES DE PAGO</label>
                  <input type="text" value={form.payment_terms} onChange={e => set('payment_terms', e.target.value)}
                    placeholder="Ej: 50% anticipo, 50% contra entrega" />
                </div>
              )}
            </div>

            {financialConfig.valor_estimado && (
              !initial ? (
                <>
                  <label style={{ marginTop: 14, display: 'block' }}>PROYECCIÓN DEL DEAL (opcional)</label>
                  <div className="entity-fields-grid">
                    <Field label="Fecha de inicio del deal">
                      <input type="date" value={form.deal_start_date} onChange={e => set('deal_start_date', e.target.value)} />
                    </Field>
                    <Field label="Duración (años)">
                      <input type="number" min="1" max="50" placeholder="Ej: 5" value={form.deal_duration_years} onChange={e => set('deal_duration_years', e.target.value)} />
                    </Field>
                    <Field label="Valor total del deal">
                      <input type="number" step="0.01" placeholder="Ej: 5.000.000" value={form.deal_target_value} onChange={e => set('deal_target_value', e.target.value)} />
                    </Field>
                  </div>
                  <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>El desglose año por año se completa desde la vista de detalle, una vez creado el proyecto. Ninguno de estos campos es obligatorio.</p>
                </>
              ) : (
                <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>La proyección de valor del deal se gestiona desde la vista de detalle del proyecto.</p>
              )
            )}

            {financialConfig.hitos && (
              !initial ? (
                <>
                  <label style={{ marginTop: 14, display: 'block' }}>HITOS INICIALES</label>
                  <div className="neg-milestone-add" style={{ marginTop: 0 }}>
                    <Field label="Nombre del hito" style={{ flex: 1.5, minWidth: 160 }}>
                      <input type="text" className="neg-note-input neg-milestone-name-input" value={newMilestoneName} onChange={e => setNewMilestoneName(e.target.value)}
                        placeholder="Ej: Upfront, Milestone Fase 2..." />
                    </Field>
                    <Field label="Monto" style={{ width: 120, flexShrink: 0 }}>
                      <input type="number" className="neg-note-date-input neg-milestone-amount-input" value={newMilestoneAmount} onChange={e => setNewMilestoneAmount(e.target.value)}
                        placeholder="Negativo = pago" step="0.01" />
                    </Field>
                    <Field label="Fecha estimada" style={{ width: 150, flexShrink: 0 }}>
                      <input type="date" className="neg-note-date-input neg-milestone-date-input" value={newMilestoneDate} onChange={e => setNewMilestoneDate(e.target.value)} />
                    </Field>
                    <Field label="Momento" style={{ flex: 1.5, minWidth: 160 }}>
                      <input type="text" className="neg-note-input neg-milestone-timing-input" value={newMilestoneTiming} onChange={e => setNewMilestoneTiming(e.target.value)}
                        placeholder="Si no hay fecha exacta, ej: al lanzamiento" />
                    </Field>
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
                      <span style={{ flex: 1, fontSize: 13, color: '#374151' }}>
                        {m.name}
                        {(m.estimated_date || m.timing_note) && (
                          <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 8, fontWeight: 400 }}>
                            {[m.estimated_date ? new Date(m.estimated_date + 'T00:00:00').toLocaleDateString('es-AR') : null, m.timing_note].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: Number(m.amount) < 0 ? '#DC2626' : '#059669', textAlign: 'right', minWidth: 90 }}>{Number(m.amount).toLocaleString('es-AR')} {form.currency}</span>
                      <button type="button" onClick={() => set('milestones', form.milestones.filter(x => x.id !== m.id))} style={{ background: 'none', border: 'none', color: '#DC2626', cursor: 'pointer', fontSize: 16 }}>×</button>
                    </div>
                  ))}
                </>
              ) : (
                <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 14 }}>Los hitos se gestionan desde la vista de detalle del proyecto.</p>
              )
            )}
          </div>

          {!initial && playbooks.length > 0 && (
            <div className="form-group">
              <label>PLAYBOOK (opcional)</label>
              <select className="neg-newtask-select" style={{ width: '100%' }} value={playbookId} onChange={e => setPlaybookId(e.target.value)}>
                <option value="">Sin playbook — cargar tareas a mano</option>
                {playbooks.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}

          <div className="form-group">
            <label>TAREAS INICIALES</label>
            {!initial ? (
              <>
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
              </>
            ) : (
              <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>Las tareas se gestionan desde la pestaña Tareas del proyecto.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function NegotiationDetail({ neg, entities, entityTypes = [], customStates, customFieldDefs = [], members = [], getStateConfig, getEntityFlag, highlightTaskId, onClose, onEdit, onDeleted, onActivityChanged, onNotesChanged }) {
  const { effectiveRole, role, user, isStaff, workspaceId, activeWorkspace } = useAuth()
  useEscapeToClose(onClose)
  const negTerminalNames = terminalStatusNames(customStates)
  const canDelete = isOwner(effectiveRole)
  const canPause = isPrivilegedRole(effectiveRole)
  const canEdit = canEditContent(effectiveRole)
  const canEditInline = canEditContent(effectiveRole)
  const canNote = canEditContent(effectiveRole)
  const canTask = canEditContent(effectiveRole)
  const isPrivileged = isPrivilegedRole(effectiveRole)
  // Al impersonar un rol inferior, simulamos ser un usuario sin ID conocido
  const myUserId = user?.id

  function canCompleteTask(task) {
    if (task.status === 'done') return false
    if (isTaskBlocked(task)) return false
    if (isPrivileged) return true
    if (!task.assigned_to) return canEditContent(effectiveRole)
    return task.assigned_to === myUserId && canEditContent(effectiveRole)
  }
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [tasks, setTasks] = useState([])
  const [playbooks, setPlaybooks] = useState([])
  const [showPlaybookPicker, setShowPlaybookPicker] = useState(false)
  const [applyingPlaybookId, setApplyingPlaybookId] = useState('')
  const [applyingPlaybook, setApplyingPlaybook] = useState(false)

  useEffect(() => {
    supabase.from('task_playbooks').select('id, name').eq('workspace_id', workspaceId).order('sort_order')
      .then(({ data }) => setPlaybooks(data || []))
  }, [workspaceId])

  async function handleApplyPlaybook() {
    if (!applyingPlaybookId) return
    setApplyingPlaybook(true)
    const playbookName = playbooks.find(p => p.id === applyingPlaybookId)?.name
    await applyPlaybook(supabase, { playbookId: applyingPlaybookId, workspaceId, negotiationId: neg.id, userId: myUserId })
    await logActivity(supabase, {
      workspaceId, negotiationId: neg.id, type: 'playbook_applied',
      title: `Playbook aplicado: "${playbookName || ''}"`, actorId: myUserId,
    })
    setApplyingPlaybook(false)
    setShowPlaybookPicker(false)
    setApplyingPlaybookId('')
    fetchTasks()
    setActivityRefresh(v => v + 1)
  }
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [showLogMeeting, setShowLogMeeting] = useState(false)
  const [activityRefresh, setActivityRefresh] = useState(0)
  const [activityStatus, setActivityStatus] = useState(neg.activity_status || 'active')
  const [closeConfirmationStatus, setCloseConfirmationStatus] = useState(neg.close_confirmation_status || null)
  const isCloseApprover = isApproverFor(activeWorkspace, 'negotiation_close', user?.id)
  const [inlineStatus, setInlineStatus] = useState(neg.status || '')
  const [inlineObs, setInlineObs] = useState(neg.observations || '')
  const [inlineCurrency, setInlineCurrency] = useState(neg.currency || 'USD')
  const [inlineUnit, setInlineUnit] = useState(neg.unit_of_measure || '')
  const [inlinePaymentTerms, setInlinePaymentTerms] = useState(neg.payment_terms || '')
  const [activeTab, setActiveTab] = useState('bitacora')
  const [financialConfig, setFinancialConfig] = useState(resolveFinancialConfig(null))
  const [milestonesTotal, setMilestonesTotal] = useState(null)
  const [projectedTotal, setProjectedTotal] = useState(null)
  const [latestPrice, setLatestPrice] = useState(null)
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
  const quoteProducts = [primaryProduct, ...secondaryProducts.map(np => np.product)].filter(Boolean)
  const gridDefs = customFieldDefs.filter(d => d.field_type !== 'financial')
  const entitiesLinkDef = customFieldDefs.find(d => d.field_type === 'entities_link')
  const productsLinkDef = customFieldDefs.find(d => d.field_type === 'products_link')
  const inlineDetailDefs = gridDefs.filter(d => d.field_type !== 'status' && d.field_type !== 'entities_link' && d.field_type !== 'products_link' && d.key !== 'product')

  function fieldValue(def) {
    return def.storage_column ? columnValues[def.key] : getCustomFieldValue(customFieldValues, def.key)
  }

  useEffect(() => { fetchTasks() }, [])

  useEffect(() => {
    supabase.from('workspaces').select('financial_config').eq('id', neg.workspace_id || workspaceId).single()
      .then(({ data }) => setFinancialConfig(resolveFinancialConfig(data?.financial_config)))
  }, [neg.workspace_id, workspaceId])

  useEffect(() => { fetchMilestonesTotal() }, [neg.id, activityRefresh])
  useEffect(() => { fetchLatestPrice() }, [neg.id, activityRefresh])
  useEffect(() => { if (financialConfig.valor_estimado) fetchProjectedTotal() }, [neg.id, activityRefresh, financialConfig.valor_estimado])

  async function fetchMilestonesTotal() {
    const { data } = await supabase.from('deal_milestones').select('amount').eq('negotiation_id', neg.id)
    if (data) setMilestonesTotal(data.reduce((sum, m) => sum + Number(m.amount), 0))
  }

  async function fetchProjectedTotal() {
    const { data } = await supabase.from('negotiation_value_projections').select('amount').eq('negotiation_id', neg.id)
    if (data) setProjectedTotal(data.length > 0 ? data.reduce((sum, p) => sum + Number(p.amount), 0) : null)
  }

  // Una cotización es una sola aunque tenga varias presentaciones -- este
  // widget mostraba solo la fila más nueva del historial (una sola
  // presentación), perdiendo el resto de la cotización. Se trae un lote
  // (alcanza para cubrir cualquier cotización real) y se queda con TODAS
  // las filas que comparten fecha+motivo con la más nueva, mismo criterio
  // de agrupamiento que ya usa PriceHistory.jsx para el historial completo.
  async function fetchLatestPrice() {
    const { data } = await supabase.from('negotiation_price_history').select('*')
      .eq('negotiation_id', neg.id)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50)
    if (!data || data.length === 0) { setLatestPrice(null); return }
    const latest = data[0]
    setLatestPrice(data.filter(e => e.entry_date === latest.entry_date && (e.note || '') === (latest.note || '')))
  }

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
      await requestNegotiationCloseApproval(supabase, {
        workspace: activeWorkspace, workspaceId: neg.workspace_id || workspaceId, negotiation: neg,
        prevStatus: prevValue, newStatus: value, terminalNames: negTerminalNames, actorId: user?.id,
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

  async function handleConfirmClose() {
    await supabase.from('negotiations').update({ close_confirmation_status: 'confirmed' }).eq('id', neg.id)
    await logActivity(supabase, {
      workspaceId: neg.workspace_id || workspaceId, negotiationId: neg.id, type: 'negotiation_close_resolved',
      title: `Cierre a "${neg.status}" confirmado`, actorId: user?.id,
    })
    setCloseConfirmationStatus('confirmed')
    setActivityRefresh(v => v + 1)
    onActivityChanged?.()
  }

  async function handleRevertClose() {
    const revertTo = neg.close_requested_from_status
    if (!revertTo) return
    await supabase.from('negotiations').update({
      status: revertTo, close_confirmation_status: null, close_requested_from_status: null,
    }).eq('id', neg.id)
    await logActivity(supabase, {
      workspaceId: neg.workspace_id || workspaceId, negotiationId: neg.id, type: 'negotiation_close_resolved',
      title: `Cierre revertido — vuelve a "${revertTo}"`, actorId: user?.id,
    })
    setInlineStatus(revertTo)
    setCloseConfirmationStatus(null)
    setActivityRefresh(v => v + 1)
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

  const pendingTasksCount = tasks.filter(t => t.status !== 'done').length
  const daysSinceActivity = neg.last_activity_at ? Math.floor((Date.now() - new Date(neg.last_activity_at)) / 86400000) : null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="neg-detail-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header modal-header--sticky">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 className="modal-title"><span className="card-tile-number">#{neg.display_number}</span> {neg.product || neg.title}</h2>
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
        {closeConfirmationStatus === 'pending' && (
          <div className="neg-close-confirmation-banner">
            <span>⏳ Cierre a "{neg.status}" pendiente de confirmación.</span>
            {isCloseApprover && (
              <div className="neg-close-confirmation-actions">
                <button type="button" className="btn-edit" onClick={handleConfirmClose}>✓ Confirmar</button>
                <button type="button" className="btn-delete" onClick={handleRevertClose}>↩ Revertir a "{neg.close_requested_from_status}"</button>
              </div>
            )}
          </div>
        )}
        <div className="neg-detail-body neg-detail-body--split">
          <aside className="neg-detail-sidebar">
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
              <StatusDaysBadge neg={neg} />
            </div>
            {customFieldError && <p className="form-error">{customFieldError}</p>}

            <div className="neg-sidebar-section">
              <p className="neg-sidebar-label">Resumen</p>
              <div className="neg-resumen-grid">
                <div className={`neg-resumen-tile ${daysSinceActivity !== null && daysSinceActivity <= 7 ? 'neg-resumen-tile--ok' : ''}`}>
                  <div className="neg-resumen-num">{daysSinceActivity !== null ? `${daysSinceActivity}d` : '—'}</div>
                  <div className="neg-resumen-label">desde última actividad</div>
                </div>
                <div className={`neg-resumen-tile ${pendingTasksCount > 0 ? 'neg-resumen-tile--warn' : ''}`}>
                  <div className="neg-resumen-num">{pendingTasksCount}</div>
                  <div className="neg-resumen-label">tarea{pendingTasksCount !== 1 ? 's' : ''} pendiente{pendingTasksCount !== 1 ? 's' : ''}</div>
                </div>
                {financialConfig.valor_estimado && projectedTotal !== null ? (
                  <>
                    <div className="neg-resumen-tile neg-resumen-tile--wide">
                      <div className="neg-resumen-num">{formatAmount(projectedTotal)}{inlineCurrency ? ` ${inlineCurrency}` : ''}</div>
                      <div className="neg-resumen-label">proyectado</div>
                    </div>
                    {financialConfig.hitos && milestonesTotal !== null && (
                      <div className="neg-resumen-tile neg-resumen-tile--wide">
                        <div className="neg-resumen-num">{formatAmount(milestonesTotal)}{inlineCurrency ? ` ${inlineCurrency}` : ''}</div>
                        <div className="neg-resumen-label">real a la fecha (hitos)</div>
                      </div>
                    )}
                  </>
                ) : financialConfig.hitos && milestonesTotal !== null && (
                  <div className="neg-resumen-tile neg-resumen-tile--wide">
                    <div className="neg-resumen-num">{formatAmount(milestonesTotal)}{inlineCurrency ? ` ${inlineCurrency}` : ''}</div>
                    <div className="neg-resumen-label">total del deal (hitos)</div>
                  </div>
                )}
              </div>
            </div>

            {financialConfig.historial_precio && latestPrice?.length > 0 && (
              <div className="neg-sidebar-section">
                <p className="neg-sidebar-label">Última cotización</p>
                <div className="neg-quote-summary">
                  <span className="neg-quote-date">
                    {latestPrice[0].note ? `${latestPrice[0].note} - ` : ''}
                    {formatQuoteDate(latestPrice[0].entry_date)}
                  </span>
                  {latestPrice.map(e => {
                    const productName = e.product_id ? quoteProducts.find(p => p.id === e.product_id)?.name : null
                    const label = [productName, e.presentation].filter(Boolean).join(' — ')
                    return (
                      <div key={e.id} className="neg-quote-line">
                        <div className="neg-quote-line-main">
                          <span className="neg-quote-line-label">{label ? `${label}: ` : ''}</span>
                          <span className="neg-quote-value">
                            {formatAmount(e.value)}{inlineCurrency ? ` ${inlineCurrency}` : ''}{inlineUnit ? `/${inlineUnit}` : ''}
                          </span>
                        </div>
                        {financialConfig.volumen && e.quantity && (
                          <span className="neg-quote-detail">MOQ: {formatAmount(e.quantity)} {inlineUnit || ''}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {entitiesLinkDef && entityTypes.some(et => getEntitiesOfType(neg, et.id).length > 0) && (
              <div className="neg-sidebar-section">
                <p className="neg-sidebar-label">{entitiesLinkDef.label}</p>
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
              <div className="neg-sidebar-section">
                <p className="neg-sidebar-label">{productsLinkDef.label}</p>
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

            {inlineDetailDefs.length > 0 && (
              <div className="neg-sidebar-section">
                <p className="neg-sidebar-label">Información</p>
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
              </div>
            )}

            <div className="neg-sidebar-section">
              <p className="neg-sidebar-label">Observaciones internas</p>
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
          </aside>

          <section className="neg-detail-rightpane">
            <div className="neg-tabs">
              <button className={`neg-tab ${activeTab === 'financiero' ? 'active' : ''}`} onClick={() => setActiveTab('financiero')}>Financiero</button>
              <button className={`neg-tab ${activeTab === 'bitacora' ? 'active' : ''}`} onClick={() => setActiveTab('bitacora')}>Bitácora</button>
              <button className={`neg-tab ${activeTab === 'actividad' ? 'active' : ''}`} onClick={() => setActiveTab('actividad')}>Actividad</button>
              <button className={`neg-tab ${activeTab === 'tareas' ? 'active' : ''}`} onClick={() => setActiveTab('tareas')}>Tareas ({tasks.length})</button>
              <button className={`neg-tab ${activeTab === 'documentos' ? 'active' : ''}`} onClick={() => setActiveTab('documentos')}>Documentos</button>
            </div>

            {activeTab === 'financiero' && (
              <div className="neg-tab-panel">
                <NotesPostIts negotiationId={neg.id} workspaceId={neg.workspace_id || workspaceId} page="financiero" canEdit={canNote} hideComposer
                  onChanged={() => { setActivityRefresh(v => v + 1); onNotesChanged?.() }} contextLabel={neg.product || neg.title} />

                <div className="neg-financiero-fields">
                  <div className="neg-financiero-field">
                    <div className="detail-section-title">Moneda</div>
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
                  {financialConfig.historial_precio && financialConfig.volumen && (
                    <div className="neg-financiero-field">
                      <div className="detail-section-title">Unidad</div>
                      {canEditInline ? (
                        <input
                          type="text"
                          className="neg-inline-text-input"
                          value={inlineUnit}
                          placeholder="Ej: kg, litro, unidad..."
                          onChange={e => setInlineUnit(e.target.value)}
                          onBlur={() => saveInlineField('unit_of_measure', inlineUnit)}
                        />
                      ) : (
                        <span className="neg-detail-value">{inlineUnit || 'Sin especificar'}</span>
                      )}
                    </div>
                  )}
                  {financialConfig.condiciones_pago && (
                    <div className="neg-financiero-field">
                      <div className="detail-section-title">Condiciones de pago</div>
                      {canEditInline ? (
                        <input
                          type="text"
                          className="neg-inline-text-input"
                          value={inlinePaymentTerms}
                          placeholder="Ej: 50% anticipo, 50% contra entrega"
                          onChange={e => setInlinePaymentTerms(e.target.value)}
                          onBlur={() => saveInlineField('payment_terms', inlinePaymentTerms || null)}
                        />
                      ) : (
                        <span className="neg-detail-value">{inlinePaymentTerms || 'Sin especificar'}</span>
                      )}
                    </div>
                  )}
                </div>

                {financialConfig.historial_precio && (
                  <>
                    <div className="detail-section-title" style={{ marginTop: 18 }}>Historial de precio</div>
                    {financialConfig.volumen && !inlineUnit && (
                      <p className="neg-financiero-meta">⚠ Elegí una unidad arriba antes de cargar cantidades — si no, la cantidad queda sin saber a qué se refiere.</p>
                    )}
                    <PriceHistory
                      negotiationId={neg.id}
                      negotiationTitle={neg.product || neg.title}
                      workspaceId={neg.workspace_id || workspaceId}
                      currency={inlineCurrency}
                      unit={inlineUnit}
                      showQuantity={financialConfig.volumen}
                      products={(neg.negotiation_products || []).map(np => np.product).filter(Boolean)}
                      canEdit={canNote}
                      onChanged={() => setActivityRefresh(v => v + 1)}
                    />
                  </>
                )}

                {financialConfig.hitos && (
                  <>
                    <div className="detail-section-title" style={{ marginTop: 18 }}>
                      {financialConfig.valor_estimado ? 'Hitos y proyección' : 'Hitos'}
                    </div>
                    <DealMilestones
                      negotiationId={neg.id}
                      workspaceId={neg.workspace_id || workspaceId}
                      currency={inlineCurrency}
                      canEdit={canNote}
                      onChanged={() => { setActivityRefresh(v => v + 1); onActivityChanged?.() }}
                      showProjection={financialConfig.valor_estimado}
                      dealStartDate={neg.deal_start_date}
                      dealDurationYears={neg.deal_duration_years}
                      dealTargetValue={neg.deal_target_value}
                      onSaveDealMeta={saveInlineField}
                    />
                  </>
                )}
              </div>
            )}

            {activeTab === 'bitacora' && (
              <div className="neg-tab-panel">
                <NotesPostIts
                  negotiationId={neg.id}
                  workspaceId={neg.workspace_id || workspaceId}
                  page="bitacora"
                  variant="postit"
                  hideComposer
                  canEdit={canNote}
                  onChanged={() => { setActivityRefresh(v => v + 1); onNotesChanged?.() }}
                  contextLabel={neg.product || neg.title}
                />
                <div className="detail-section-title" style={{ marginTop: 4 }}>Registro</div>
                <NotesPostIts
                  negotiationId={neg.id}
                  workspaceId={neg.workspace_id || workspaceId}
                  page="__log__"
                  variant="timeline"
                  canEdit={canNote}
                  onChanged={() => { setActivityRefresh(v => v + 1); onNotesChanged?.() }}
                  contextLabel={neg.product || neg.title}
                />
              </div>
            )}

            {activeTab === 'actividad' && (
              <div className="neg-tab-panel">
                {canNote && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                    <button className="neg-add-task-btn" onClick={() => setShowLogMeeting(true)}>📞 Registrar / Programar</button>
                  </div>
                )}
                <ActivityTimeline negotiationId={neg.id} refreshKey={activityRefresh} />
              </div>
            )}

            {activeTab === 'tareas' && (
              <div className="neg-tab-panel">
                <NotesPostIts negotiationId={neg.id} workspaceId={neg.workspace_id || workspaceId} page="tareas" canEdit={canNote} hideComposer
                  onChanged={() => { setActivityRefresh(v => v + 1); onNotesChanged?.() }} contextLabel={neg.product || neg.title} />
                <div className="neg-tasks-header">
                  <div className="detail-section-title">TAREAS ({tasks.length})</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {canTask && playbooks.length > 0 && (
                      <button className="neg-add-task-btn" onClick={() => setShowPlaybookPicker(v => !v)}>📋 Aplicar playbook</button>
                    )}
                    {canTask && <button className="neg-add-task-btn" onClick={() => setShowTaskModal(true)}>+ Nueva tarea</button>}
                  </div>
                </div>
                {showPlaybookPicker && (
                  <div className="neg-newtask-row" style={{ marginBottom: 10 }}>
                    <select className="neg-newtask-select" style={{ flex: 1 }} value={applyingPlaybookId} onChange={e => setApplyingPlaybookId(e.target.value)}>
                      <option value="">Elegí un playbook...</option>
                      {playbooks.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <button type="button" className="btn-secondary" disabled={!applyingPlaybookId || applyingPlaybook} onClick={handleApplyPlaybook}>
                      {applyingPlaybook ? 'Aplicando...' : 'Aplicar'}
                    </button>
                  </div>
                )}
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
                            {task.due_date && <span className="neg-task-date">{new Date(task.due_date + 'T00:00:00').toLocaleDateString('es-AR')}</span>}
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
            )}

            {activeTab === 'documentos' && (
              <div className="neg-tab-panel">
                <NotesPostIts negotiationId={neg.id} workspaceId={neg.workspace_id || workspaceId} page="documentos" canEdit={canNote} hideComposer
                  onChanged={() => { setActivityRefresh(v => v + 1); onNotesChanged?.() }} contextLabel={neg.product || neg.title} />
                <div className="detail-section-title">DOCUMENTOS</div>
                <Documents
                  negotiationId={neg.id}
                  workspaceId={neg.workspace_id || workspaceId}
                  canEdit={canNote}
                  onChanged={() => setActivityRefresh(v => v + 1)}
                />
              </div>
            )}
          </section>
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
        <TaskModalInline negotiationId={neg.id} onClose={() => setShowTaskModal(false)} onCreated={() => { fetchTasks(); setActivityRefresh(v => v + 1) }} />
      )}
      {showLogMeeting && (
        <LogMeetingModal
          workspaceId={workspaceId}
          negotiationId={neg.id}
          members={members}
          onClose={() => setShowLogMeeting(false)}
          onSaved={() => { fetchTasks(); setActivityRefresh(v => v + 1) }}
        />
      )}
    </div>
  )
}

function TaskModalInline({ negotiationId, onClose, onCreated }) {
  const { workspaceId, user } = useAuth()
  useEscapeToClose(onClose)
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState('medium')
  const [dueDate, setDueDate] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [predecessorId, setPredecessorId] = useState('')
  const [members, setMembers] = useState([])
  const [candidates, setCandidates] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    supabase.from('workspace_members')
      .select(`user_id, profile:user_id ( full_name, email )`)
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .then(({ data }) => { if (data) setMembers(data) })
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId) return
    fetchPredecessorCandidates(supabase, { workspaceId, negotiationId }).then(setCandidates)
  }, [negotiationId, workspaceId])

  async function handleSave() {
    if (!title.trim()) return
    setSaving(true)
    setError(null)
    const { error: saveError } = await createTask(supabase, {
      workspaceId, title, priority, dueDate, assignedTo,
      negotiationId, predecessorId, createdBy: user?.id, actorId: user?.id,
    })
    setSaving(false)
    if (saveError) { setError('No se pudo crear la tarea. Intentá de nuevo.'); return }
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
          {candidates.length > 0 && (
            <div className="form-group">
              <label>DEPENDE DE (opcional)</label>
              <select value={predecessorId} onChange={e => setPredecessorId(e.target.value)}>
                <option value="">Ninguna</option>
                {candidates.map(t => (
                  <option key={t.id} value={t.id}>{t.title}{t.status === 'done' ? ' (hecha)' : ''}</option>
                ))}
              </select>
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
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