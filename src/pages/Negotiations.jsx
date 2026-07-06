import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import DeleteConfirmModal from '../components/DeleteConfirmModal'
import './Negotiations.css'

const TERRITORIES = ['ARG','BOL','BRA','CEAM','CHI','COL','ECU','MEX','PAR','PER','URU','VEN']
const COMPANIES = ['Ethical Nutrition','Millet','Roemmers','Siegfried','Sidus','Tuteur', 'Ceoderma']
const NDA_STATES = ['—','Enviado','En Revisión','Firmado']

// Todas las columnas disponibles para la tabla
const ALL_COLUMNS = [
  { key: 'product',          label: 'Producto',         alwaysVisible: true  },
  { key: 'entities',         label: 'Proveedor'                              },
  { key: 'status',           label: 'Estado'                                 },
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

function useColumnPrefs(userId) {
  const key = `nerva_col_prefs_${userId}`
  const [cols, setCols] = useState(() => {
    try {
      const saved = localStorage.getItem(key)
      if (saved) {
        const parsed = JSON.parse(saved)
        // Mergeamos por si hay columnas nuevas que no estaban guardadas
        const savedKeys = parsed.map(c => c.key)
        const merged = [
          ...parsed,
          ...ALL_COLUMNS.filter(c => !savedKeys.includes(c.key)).map(c => ({ key: c.key, visible: false }))
        ]
        return merged
      }
    } catch {}
    return ALL_COLUMNS.map(c => ({ key: c.key, visible: DEFAULT_VISIBLE.includes(c.key) }))
  })

  function saveCols(newCols) {
    setCols(newCols)
    localStorage.setItem(key, JSON.stringify(newCols))
  }

  return [cols, saveCols]
}

export default function Negotiations() {
  const { user, workspaceId, effectiveRole } = useAuth()
  const canCreateProject = effectiveRole === 'owner' || effectiveRole === 'admin' || effectiveRole === 'editor'
  const location = useLocation()
  const [negotiations, setNegotiations] = useState([])
  const [entities, setEntities] = useState([])
  const [members, setMembers] = useState([])
  const [customStates, setCustomStates] = useState([])
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
  const [cols, saveCols] = useColumnPrefs(user?.id)

  // Si viene del banner del dashboard, pre-filtra por baja actividad
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('filter') === 'low_activity') setFilterActivity('low_activity')
  }, [location.search])

  // Si viene de "ver proyecto" desde una entidad, abre ese proyecto directamente
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const openId = params.get('open')
    if (openId && negotiations.length > 0) {
      const found = negotiations.find(n => n.id === openId)
      if (found) setSelectedNeg(found)
    }
  }, [location.search, negotiations])

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [negsRes, entitiesRes, membersRes, statesRes] = await Promise.all([
      supabase.from('negotiations').select('*').order('created_at', { ascending: false }),
      supabase.from('entities').select('id, name, country_code').order('name'),
      supabase.from('workspace_members').select(`user_id, profile:user_id ( full_name )`).eq('workspace_id', workspaceId),
      supabase.from('custom_states').select('*').eq('object_type', 'negotiation').order('sort_order'),
    ])

    if (negsRes.error) { setLoading(false); return }

    const negIds = negsRes.data.map(n => n.id)
    const [{ data: negEntities }, { data: negNotes }] = await Promise.all([
      supabase
        .from('negotiation_entities')
        .select('negotiation_id, entity_id, entity:entity_id(id, name, country_code)')
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
      supabase.from('negotiations').select('*').eq('id', id).single(),
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

  function getEntityName(neg) {
    const ents = neg.negotiation_entities?.map(ne => ne.entity).filter(Boolean) || []
    return ents.map(e => e.name).join(', ') || '—'
  }

  function getEntityFlag(neg) {
    const ents = neg.negotiation_entities?.map(ne => ne.entity).filter(Boolean) || []
    if (ents.length === 0 || !ents[0].country_code) return null
    return `https://flagcdn.com/w20/${ents[0].country_code.toLowerCase()}.png`
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
      </div>

      <div className="neg-toolbar">
        <input className="neg-search" type="text" placeholder="🔍 Buscar proyecto o producto..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="neg-select" value={filterEntity} onChange={e => setFilterEntity(e.target.value)}>
          <option value="">Todos los proveedores</option>
          {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select className="neg-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">Todos los estados</option>
          {customStates.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
        <select className="neg-select" value={filterActivity} onChange={e => setFilterActivity(e.target.value)}>
          <option value="active">En curso</option>
          <option value="paused">Pausados</option>
          <option value="inactive">Inactivos</option>
          <option value="low_activity">Baja actividad</option>
          <option value="">Todos</option>
        </select>
        <div className="neg-view-toggle">
          <button className={`neg-view-btn ${view === 'table' ? 'active' : ''}`} onClick={() => setView('table')} title="Vista tabla">☰</button>
          <button className={`neg-view-btn ${view === 'cards' ? 'active' : ''}`} onClick={() => setView('cards')} title="Vista cards">⊞</button>
        </div>
        <button
          className={`neg-col-btn ${showColEditor ? 'active' : ''}`}
          onClick={() => setShowColEditor(v => !v)}
          title="Configurar columnas"
        >
          ⚙ Columnas
        </button>
      </div>

      {showColEditor && (
        <ColumnEditor cols={cols} onChange={saveCols} onClose={() => setShowColEditor(false)} />
      )}

      {loading ? (
        <div className="neg-loading">Cargando proyectos...</div>
      ) : filtered.length === 0 ? (
        <div className="neg-empty">No hay proyectos todavía.</div>
      ) : view === 'table' ? (
        <TableView negotiations={filtered} getStateConfig={getStateConfig} getEntityName={getEntityName} getEntityFlag={getEntityFlag} onSelect={setSelectedNeg} cols={cols} />
      ) : (
        <CardsView negotiations={filtered} getStateConfig={getStateConfig} getEntityName={getEntityName} getEntityFlag={getEntityFlag} onSelect={setSelectedNeg} cols={cols} />
      )}

      {showModal && (
        <NegotiationModal
          initial={editingNeg}
          entities={entities}
          members={members}
          customStates={customStates}
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
          getStateConfig={getStateConfig}
          getEntityFlag={getEntityFlag}
          onClose={() => setSelectedNeg(null)}
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
function ColumnEditor({ cols, onChange, onClose }) {
  const [dragSrc, setDragSrc] = useState(null)
  const [dragOver, setDragOver] = useState(null)

  function toggleVisible(key) {
    const col = ALL_COLUMNS.find(c => c.key === key)
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
        <span className="col-editor-title">Configurar columnas</span>
        <span className="col-editor-hint">Arrastrá para reordenar · Clic para mostrar/ocultar</span>
        <button className="col-editor-close" onClick={onClose}>✕</button>
      </div>
      <div className="col-editor-list">
        {cols.map((c, idx) => {
          const def = ALL_COLUMNS.find(x => x.key === c.key)
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
function renderCell(key, neg, getStateConfig, getEntityName, getEntityFlag) {
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
    default:
      return <td key={key}>—</td>
  }
}

function TableView({ negotiations, getStateConfig, getEntityName, getEntityFlag, onSelect, cols }) {
  const visibleCols = cols.filter(c => c.visible)

  return (
    <div className="neg-table-wrapper">
      <table className="neg-table">
        <thead>
          <tr>
            {visibleCols.map(c => {
              const def = ALL_COLUMNS.find(x => x.key === c.key)
              return <th key={c.key}>{def?.label}</th>
            })}
          </tr>
        </thead>
        <tbody>
          {negotiations.map(neg => {
            const rowClass = neg.activity_status === 'paused' ? 'neg-row-paused' : neg.activity_status === 'inactive' ? 'neg-row-inactive' : ''
            return (
              <tr key={neg.id} onClick={() => onSelect(neg)} className={`neg-table-row ${rowClass}`}>
                {visibleCols.map(c => renderCell(c.key, neg, getStateConfig, getEntityName, getEntityFlag))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function renderCardField(key, neg, getStateConfig, getEntityName, getEntityFlag) {
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
    default: return null
  }
}

function CardsView({ negotiations, getStateConfig, getEntityName, getEntityFlag, onSelect, cols }) {
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
            <div className="neg-card-header">
              <div className="neg-card-title">
                {actIcon && <span className={`neg-paused-icon ${neg.activity_status === 'inactive' ? 'neg-icon-inactive' : 'neg-icon-paused'}`}>{actIcon}</span>}
                {neg.product || neg.title}
              </div>
              <span className="neg-status-badge" style={{ backgroundColor: cfg.bg_color, color: cfg.color }}>{neg.status}</span>
            </div>
            {visibleFields.map(c => renderCardField(c.key, neg, getStateConfig, getEntityName, getEntityFlag))}
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

export function NegotiationModal({ initial, presetEntity, entities, members, customStates, onClose, onCancel, onSaved, workspaceId, userId }) {
  const empty = {
    title: '', product: '', status: customStates[0]?.name || 'Contactado',
    nda: '—', target_date: '', notes: '', observations: '',
    territories: [], companies: [], participants: [],
    entity_ids: presetEntity ? [{ id: presetEntity.id, role: '' }] : [], // [{ id, role }]
    tasks: []
  }
  const [form, setForm] = useState(initial ? {
    ...empty, ...initial,
    entity_ids: initial.negotiation_entities?.map(ne => ({ id: ne.entity?.id, role: ne.role || '' })).filter(e => e.id) || [],
    tasks: []
  } : empty)
  const [entitySearch, setEntitySearch] = useState('')
  const [entityDropdownOpen, setEntityDropdownOpen] = useState(false)
  const entityRef = useRef(null)
  const [newTask, setNewTask] = useState('')
  const [newTaskAssignee, setNewTaskAssignee] = useState('')
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
      notes: form.notes, observations: form.observations,
      territories: form.territories, companies: form.companies,
      participants: form.participants, created_by: userId,
    }
    let negId = initial?.id
    if (initial?.id) {
      await supabase.from('negotiations').update(row).eq('id', initial.id)
    } else {
      const { data } = await supabase.from('negotiations').insert(row).select().single()
      negId = data?.id
    }
    if (negId) {
      await supabase.from('negotiation_entities').delete().eq('negotiation_id', negId)
      if (form.entity_ids.length > 0) {
        await supabase.from('negotiation_entities').insert(
          form.entity_ids.map(e => ({ negotiation_id: negId, entity_id: e.id, role: e.role || null }))
        )
      }
      if (form.tasks.length > 0) {
        await supabase.from('tasks').insert(form.tasks.map(t => ({
          workspace_id: workspaceId, negotiation_id: negId,
          title: t.text, assigned_to: t.assignee || null,
          status: 'pending', priority: 'medium', created_by: userId,
        })))
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

            {/* Lista de entidades seleccionadas con campo de rol */}
            {form.entity_ids.length > 0 && (
              <div className="entity-selected-list">
                {form.entity_ids.map(e => {
                  const ent = entities.find(x => x.id === e.id)
                  return (
                    <div key={e.id} className="entity-selected-row">
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
        </div>
      </div>
    </div>
  )
}

export function NegotiationDetail({ neg, entities, customStates, getStateConfig, getEntityFlag, onClose, onEdit, onDeleted, onActivityChanged, onNotesChanged }) {
  const { effectiveRole, role, user, isStaff } = useAuth()
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
    if (isPrivileged) return true
    if (!task.assigned_to) return effectiveRole !== 'viewer'
    return task.assigned_to === myUserId && effectiveRole !== 'viewer'
  }
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [tasks, setTasks] = useState([])
  const [showTaskModal, setShowTaskModal] = useState(false)
  const [activityStatus, setActivityStatus] = useState(neg.activity_status || 'active')
  const [inlineStatus, setInlineStatus] = useState(neg.status || '')
  const [inlineNda, setInlineNda] = useState(neg.nda || '—')
  const [inlineObs, setInlineObs] = useState(neg.observations || '')
  const [notes, setNotes] = useState(neg.notes_list || [])
  const [newNote, setNewNote] = useState('')
  const [newNoteDate, setNewNoteDate] = useState(new Date().toISOString().split('T')[0])
  const [savingNote, setSavingNote] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState(null)
  const [editingNoteText, setEditingNoteText] = useState('')
  const cfg = getStateConfig(neg.status)
  const flag = getEntityFlag(neg)
  const entityNames = neg.negotiation_entities?.map(ne => ne.entity?.name).filter(Boolean).join(', ') || '—'

  useEffect(() => { fetchTasks(); fetchNotes() }, [])

  async function fetchTasks() {
    const { data } = await supabase.from('tasks')
      .select(`*, profile:assigned_to ( full_name )`)
      .eq('negotiation_id', neg.id)
      .order('created_at', { ascending: false })
    if (data) setTasks(data)
  }

  async function fetchNotes() {
    const { data, error } = await supabase.from('negotiation_notes')
      .select('*')
      .eq('negotiation_id', neg.id)
      .order('note_date', { ascending: true })
    if (error) console.error('fetchNotes error:', error.message)
    if (data) setNotes(data)
  }

  async function handleAddNote() {
    if (!newNote.trim()) return
    setSavingNote(true)
    const { error } = await supabase.from('negotiation_notes').insert({
      negotiation_id: neg.id,
      workspace_id: neg.workspace_id,
      content: newNote.trim(),
      note_date: newNoteDate,
    })
    if (error) { console.error('addNote error:', error.message); setSavingNote(false); return }
    setNewNote('')
    setNewNoteDate(new Date().toISOString().split('T')[0])
    setSavingNote(false)
    fetchNotes()
    onNotesChanged?.()
  }

  async function handleDeleteNote(noteId) {
    await supabase.from('negotiation_notes').delete().eq('id', noteId)
    setNotes(prev => prev.filter(n => n.id !== noteId))
    onNotesChanged?.()
  }

  async function handleSaveNoteEdit(noteId) {
    const text = editingNoteText.trim()
    if (!text) return
    await supabase.from('negotiation_notes').update({ content: text }).eq('id', noteId)
    setNotes(prev => prev.map(n => n.id === noteId ? { ...n, content: text } : n))
    setEditingNoteId(null)
    onNotesChanged?.()
  }

  async function saveInlineField(field, value) {
    await supabase.from('negotiations').update({ [field]: value }).eq('id', neg.id)
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

  async function handleToggleTask(taskId, currentStatus) {
    if (currentStatus === 'done') return
    await supabase.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', taskId)
    fetchTasks()
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
          <div className="neg-detail-section">
            <div className="detail-section-title">NOTAS</div>
            <div className="neg-notes-list">
              {notes.length === 0 && <p className="detail-empty">Sin notas todavía.</p>}
              {notes.map((n, idx) => {
                const NOTE_COLORS = [
                  { bg: '#fef08a', border: '#fde047', date: '#854d0e' },
                  { bg: '#bfdbfe', border: '#93c5fd', date: '#1e40af' },
                  { bg: '#bbf7d0', border: '#86efac', date: '#166534' },
                  { bg: '#fecdd3', border: '#fda4af', date: '#9f1239' },
                ]
                const hash = n.id ? n.id.charCodeAt(0) + n.id.charCodeAt(4) : idx
                const col = NOTE_COLORS[hash % NOTE_COLORS.length]
                const rotations = [-3, -1.5, 0, 1.5, 3]
                const rot = rotations[(hash + idx) % rotations.length]
                const isEditing = editingNoteId === n.id
                return (
                  <div key={n.id} className="neg-note-item" style={{
                    background: col.bg,
                    borderLeft: `3px solid ${col.border}`,
                    transform: isEditing ? 'rotate(0deg) scale(1.03)' : `rotate(${rot}deg)`,
                    marginLeft: idx % 2 === 0 ? 0 : 8,
                    zIndex: isEditing ? 20 : idx,
                  }}>
                    <span className="neg-note-date" style={{ color: col.date }}>
                      {new Date(n.note_date + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                    </span>
                    {isEditing ? (
                      <textarea
                        className="neg-note-edit-input"
                        value={editingNoteText}
                        autoFocus
                        onChange={e => setEditingNoteText(e.target.value)}
                        onBlur={() => handleSaveNoteEdit(n.id)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveNoteEdit(n.id) }
                          if (e.key === 'Escape') setEditingNoteId(null)
                        }}
                        style={{ background: 'transparent', border: 'none', outline: 'none', width: '100%', font: 'inherit', fontSize: 13, resize: 'none', lineHeight: 1.5, padding: 0, color: '#374151' }}
                        rows={3}
                      />
                    ) : (
                      <span
                        className="neg-note-content"
                        onDoubleClick={canNote ? () => { setEditingNoteId(n.id); setEditingNoteText(n.content) } : undefined}
                        title={canNote ? 'Doble click para editar' : undefined}
                      >{n.content}</span>
                    )}
                    {!isEditing && canNote && (
                      <button className="neg-note-delete" onClick={() => handleDeleteNote(n.id)} title="Eliminar nota">✕</button>
                    )}
                  </div>
                )
              })}
            </div>
            {canNote && (
              <div className="neg-note-add">
                <input
                  type="date"
                  className="neg-note-date-input"
                  value={newNoteDate}
                  onChange={e => setNewNoteDate(e.target.value)}
                />
                <input
                  type="text"
                  className="neg-note-input"
                  placeholder="Nueva nota..."
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddNote() }}
                />
                <button className="neg-add-task-btn" onClick={handleAddNote} disabled={savingNote || !newNote.trim()}>
                  + Agregar
                </button>
              </div>
            )}
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
                    return (
                      <div key={task.id} className={`neg-task-row ${task.status === 'done' ? 'done' : ''} ${isOther && !isPrivileged ? 'neg-task-row--other' : ''}`}>
                        <button
                          className={`neg-task-check ${task.status === 'done' ? 'checked' : ''}`}
                          onClick={() => canCompleteTask(task) && handleToggleTask(task.id, task.status)}
                          disabled={!canCompleteTask(task)}
                          title={!canCompleteTask(task) && isOther ? 'Solo el asignado puede completar esta tarea' : undefined}
                        >
                          {task.status === 'done' ? '✓' : ''}
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
        <TaskModalInline negotiationId={neg.id} onClose={() => setShowTaskModal(false)} onCreated={fetchTasks} />
      )}
    </div>
  )
}

function TaskModalInline({ negotiationId, onClose, onCreated }) {
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState('medium')
  const [dueDate, setDueDate] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [members, setMembers] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('workspace_members')
      .select(`user_id, profile:user_id ( full_name, email )`)
      .eq('workspace_id', 'aaaaaaaa-0000-0000-0000-000000000001')
      .then(({ data }) => { if (data) setMembers(data) })
  }, [])

  async function handleSave() {
    if (!title.trim()) return
    setSaving(true)
    await supabase.from('tasks').insert({
      workspace_id: 'aaaaaaaa-0000-0000-0000-000000000001',
      title: title.trim(), priority,
      due_date: dueDate || null, assigned_to: assignedTo || null,
      negotiation_id: negotiationId, status: 'pending',
    })
    setSaving(false)
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