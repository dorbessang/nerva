import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import './Negotiations.css'

const WORKSPACE_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
const TERRITORIES = ['ARG','BOL','BRA','CEAM','CHI','COL','ECU','MEX','PAR','PER','URU','VEN']
const COMPANIES = ['Ethical Nutrition','Millet','Roemmers','Siegfried','Sidus','Tuteur']
const NDA_STATES = ['—','Enviado','En Revisión','Firmado']

export default function Negotiations() {
  const { user } = useAuth()
  const [negotiations, setNegotiations] = useState([])
  const [entities, setEntities] = useState([])
  const [members, setMembers] = useState([])
  const [customStates, setCustomStates] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('table')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterEntity, setFilterEntity] = useState('')
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [selectedNeg, setSelectedNeg] = useState(null)
  const [editingNeg, setEditingNeg] = useState(null)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [negsRes, entitiesRes, membersRes, statesRes] = await Promise.all([
      supabase.from('negotiations').select('*').order('created_at', { ascending: false }),
      supabase.from('entities').select('id, name, country_code').order('name'),
      supabase.from('workspace_members').select(`user_id, profile:user_id ( full_name )`),
      supabase.from('custom_states').select('*').eq('object_type', 'negotiation').order('sort_order'),
    ])

    if (negsRes.error) { setLoading(false); return }

    const negIds = negsRes.data.map(n => n.id)
    const { data: negEntities } = await supabase
      .from('negotiation_entities')
      .select('negotiation_id, entity_id, entity:entity_id(id, name, country_code)')
      .in('negotiation_id', negIds)

    const combined = negsRes.data.map(neg => ({
      ...neg,
      negotiation_entities: (negEntities || []).filter(ne => ne.negotiation_id === neg.id)
    }))

    setNegotiations(combined)
    if (entitiesRes.data) setEntities(entitiesRes.data)
    if (membersRes.data) setMembers(membersRes.data)
    if (statesRes.data) setCustomStates(statesRes.data)
    setLoading(false)
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

  const STATE_ORDER = ['Firmado', 'En Negociación', 'Derivado', 'Contactado', 'Descartado']
  const stateCounts = STATE_ORDER.map(name => {
    const found = customStates.find(s => s.name === name)
    return { name, color: found?.color || '#64748B', bg_color: found?.bg_color || '#F1F5F9', count: negotiations.filter(n => n.status === name).length }
  })

  const filtered = negotiations.filter(n => {
    if (filterStatus && n.status !== filterStatus) return false
    if (filterEntity) {
      const ids = n.negotiation_entities?.map(ne => ne.entity?.id) || []
      if (!ids.includes(filterEntity)) return false
    }
    if (search && !n.title?.toLowerCase().includes(search.toLowerCase()) && !n.product?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="neg-container">
      <div className="neg-header">
        <div>
          <h1 className="neg-title">Proyectos</h1>
          <p className="neg-subtitle">
            {negotiations.length} proyectos ·{' '}
            {stateCounts.filter(s => s.count > 0).map(s => (
              <span key={s.name} style={{ color: s.color, marginRight: 10 }}>{s.count} {s.name}</span>
            ))}
          </p>
        </div>
        <button className="neg-btn-primary" onClick={() => { setEditingNeg(null); setShowModal(true) }}>
          + Nuevo proyecto
        </button>
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
              <div className="neg-stat-bar-fill" style={{ width: negotiations.length ? `${(s.count / negotiations.length) * 100}%` : '0%', backgroundColor: s.color }} />
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
        <div className="neg-view-toggle">
          <button className={`neg-view-btn ${view === 'table' ? 'active' : ''}`} onClick={() => setView('table')} title="Vista tabla">☰</button>
          <button className={`neg-view-btn ${view === 'cards' ? 'active' : ''}`} onClick={() => setView('cards')} title="Vista cards">⊞</button>
        </div>
      </div>

      {loading ? (
        <div className="neg-loading">Cargando proyectos...</div>
      ) : filtered.length === 0 ? (
        <div className="neg-empty">No hay proyectos todavía.</div>
      ) : view === 'table' ? (
        <TableView negotiations={filtered} getStateConfig={getStateConfig} getEntityName={getEntityName} getEntityFlag={getEntityFlag} onSelect={setSelectedNeg} onEdit={neg => { setEditingNeg(neg); setShowModal(true) }} />
      ) : (
        <CardsView negotiations={filtered} getStateConfig={getStateConfig} getEntityName={getEntityName} getEntityFlag={getEntityFlag} onSelect={setSelectedNeg} />
      )}

      {showModal && (
        <NegotiationModal
          initial={editingNeg}
          entities={entities}
          members={members}
          customStates={customStates}
          onClose={() => setShowModal(false)}
          onSaved={fetchAll}
          workspaceId={WORKSPACE_ID}
          userId={user?.id}
        />
      )}

      {selectedNeg && (
        <NegotiationDetail
          neg={selectedNeg}
          entities={entities}
          getStateConfig={getStateConfig}
          getEntityFlag={getEntityFlag}
          onClose={() => setSelectedNeg(null)}
          onEdit={() => { setEditingNeg(selectedNeg); setSelectedNeg(null); setShowModal(true) }}
          onDeleted={fetchAll}
        />
      )}
    </div>
  )
}

function TableView({ negotiations, getStateConfig, getEntityName, getEntityFlag, onSelect }) {
  return (
    <div className="neg-table-wrapper">
      <table className="neg-table">
        <thead>
          <tr>
            <th>Producto</th>
            <th>Proveedor</th>
            <th>Estado</th>
            <th>NDA</th>
            <th>Territorios</th>
            <th>Empresas</th>
            <th>Fecha</th>
          </tr>
        </thead>
        <tbody>
          {negotiations.map(neg => {
            const cfg = getStateConfig(neg.status)
            const flag = getEntityFlag(neg)
            return (
              <tr key={neg.id} onClick={() => onSelect(neg)} className="neg-table-row">
                <td className="neg-td-product">{neg.product || neg.title}</td>
                <td className="neg-td-entity">
                  <span className="neg-entity-name">
                    {flag && <img src={flag} alt="" className="neg-flag" />}
                    {getEntityName(neg)}
                  </span>
                </td>
                <td><span className="neg-status-badge" style={{ backgroundColor: cfg.bg_color, color: cfg.color }}>{neg.status}</span></td>
                <td><span className="neg-nda-badge">{neg.nda || '—'}</span></td>
                <td>
                  <div className="neg-chips">
                    {neg.territories?.slice(0, 4).map(t => <span key={t} className="neg-chip neg-chip-green">{t}</span>)}
                    {neg.territories?.length > 4 && <span className="neg-chip neg-chip-gray">+{neg.territories.length - 4}</span>}
                  </div>
                </td>
                <td>
                  <div className="neg-chips">
                    {neg.companies?.slice(0, 2).map(c => <span key={c} className="neg-chip neg-chip-purple">{c}</span>)}
                    {neg.companies?.length > 2 && <span className="neg-chip neg-chip-gray">+{neg.companies.length - 2}</span>}
                  </div>
                </td>
                <td className="neg-td-date">{neg.target_date || '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CardsView({ negotiations, getStateConfig, getEntityName, getEntityFlag, onSelect }) {
  return (
    <div className="neg-cards-grid">
      {negotiations.map(neg => {
        const cfg = getStateConfig(neg.status)
        const flag = getEntityFlag(neg)
        return (
          <div key={neg.id} className="neg-card" onClick={() => onSelect(neg)}>
            <div className="neg-card-header">
              <div className="neg-card-title">{neg.product || neg.title}</div>
              <span className="neg-status-badge" style={{ backgroundColor: cfg.bg_color, color: cfg.color }}>{neg.status}</span>
            </div>
            <div className="neg-card-entity">
              {flag && <img src={flag} alt="" className="neg-flag" />}
              {getEntityName(neg)}
            </div>
            {neg.territories?.length > 0 && (
              <div className="neg-chips" style={{ marginTop: 8 }}>
                {neg.territories.slice(0, 4).map(t => <span key={t} className="neg-chip neg-chip-green">{t}</span>)}
                {neg.territories.length > 4 && <span className="neg-chip neg-chip-gray">+{neg.territories.length - 4}</span>}
              </div>
            )}
            {neg.target_date && <div className="neg-card-date">{neg.target_date}</div>}
          </div>
        )
      })}
    </div>
  )
}

function NegotiationModal({ initial, entities, members, customStates, onClose, onSaved, workspaceId, userId }) {
  const empty = {
    title: '', product: '', status: customStates[0]?.name || 'Contactado',
    nda: '—', target_date: '', notes: '', observations: '',
    territories: [], companies: [], participants: [], entity_ids: [], tasks: []
  }
  const [form, setForm] = useState(initial ? {
    ...empty, ...initial,
    entity_ids: initial.negotiation_entities?.map(ne => ne.entity?.id).filter(Boolean) || [],
    tasks: []
  } : empty)
  const [newTask, setNewTask] = useState('')
  const [newTaskAssignee, setNewTaskAssignee] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }
  function toggleArr(k, val) { setForm(f => ({ ...f, [k]: f[k].includes(val) ? f[k].filter(x => x !== val) : [...f[k], val] })) }

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
        await supabase.from('negotiation_entities').insert(form.entity_ids.map(eid => ({ negotiation_id: negId, entity_id: eid })))
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
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="neg-modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{initial ? 'Editar proyecto' : 'Nuevo proyecto'}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="neg-modal-body">
          <div className="form-row">
            <div className="form-group">
              <label>PRODUCTO / LÍNEA *</label>
              <input type="text" value={form.product} onChange={e => set('product', e.target.value)} placeholder="Ej: Ibuprofeno 400mg" />
            </div>
            <div className="form-group">
              <label>PROVEEDOR</label>
              <select value={form.entity_ids[0] || ''} onChange={e => set('entity_ids', e.target.value ? [e.target.value] : [])}>
                <option value="">Sin proveedor</option>
                {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
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
            <div className="neg-chips-select">
              {members.map(m => (
                <button key={m.user_id} type="button"
                  className={`neg-chip-btn ${form.participants.includes(m.profile?.full_name) ? 'selected' : ''}`}
                  onClick={() => toggleArr('participants', m.profile?.full_name)}>
                  {m.profile?.full_name || 'Usuario'}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label>EMPRESAS INTERESADAS</label>
            <div className="neg-chips-select">
              {COMPANIES.map(c => (
                <button key={c} type="button"
                  className={`neg-chip-btn ${form.companies.includes(c) ? 'selected' : ''}`}
                  onClick={() => toggleArr('companies', c)}>{c}</button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label>TERRITORIOS</label>
            <div className="neg-chips-select">
              <button type="button"
                className={`neg-chip-btn ${form.territories.length === TERRITORIES.length ? 'selected' : ''}`}
                onClick={() => set('territories', form.territories.length === TERRITORIES.length ? [] : [...TERRITORIES])}>
                Todos
              </button>
              {TERRITORIES.map(t => (
                <button key={t} type="button"
                  className={`neg-chip-btn ${form.territories.includes(t) ? 'selected' : ''}`}
                  onClick={() => toggleArr('territories', t)}>{t}</button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label>NOTAS</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} placeholder="Detalles de la negociación..." />
          </div>
          <div className="form-group">
            <label>OBSERVACIONES INTERNAS</label>
            <textarea value={form.observations} onChange={e => set('observations', e.target.value)} rows={2} placeholder="Solo visible al abrir el detalle..." />
          </div>
          <div className="form-group">
            <label>TAREAS INICIALES</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input type="text" value={newTask} onChange={e => setNewTask(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && newTask.trim()) { set('tasks', [...form.tasks, { id: Date.now(), text: newTask.trim(), assignee: newTaskAssignee }]); setNewTask(''); setNewTaskAssignee('') }}}
                placeholder="Describí la tarea y presioná Enter..." style={{ flex: 1 }} />
              <select value={newTaskAssignee} onChange={e => setNewTaskAssignee(e.target.value)} style={{ width: 140 }}>
                <option value="">Sin asignar</option>
                {members.map(m => <option key={m.user_id} value={m.user_id}>{m.profile?.full_name || 'Usuario'}</option>)}
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
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar proyecto'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function NegotiationDetail({ neg, entities, getStateConfig, getEntityFlag, onClose, onEdit, onDeleted }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [tasks, setTasks] = useState([])
  const [showTaskModal, setShowTaskModal] = useState(false)
  const cfg = getStateConfig(neg.status)
  const flag = getEntityFlag(neg)
  const entityNames = neg.negotiation_entities?.map(ne => ne.entity?.name).filter(Boolean).join(', ') || '—'

  useEffect(() => { fetchTasks() }, [])

  async function fetchTasks() {
    const { data } = await supabase.from('tasks')
      .select(`*, profile:assigned_to ( full_name )`)
      .eq('negotiation_id', neg.id)
      .order('created_at', { ascending: false })
    if (data) setTasks(data)
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
        <div className="modal-header">
          <h2 className="modal-title">{neg.product || neg.title}</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn-edit" onClick={onEdit}>✏️ Editar</button>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="neg-detail-body">
          <div className="neg-detail-hero">
            <div className="neg-detail-entity">
              {flag && <img src={flag} alt="" className="neg-flag-large" />}
              <span className="neg-detail-entity-name">{entityNames}</span>
            </div>
            <span className="neg-status-badge" style={{ backgroundColor: cfg.bg_color, color: cfg.color }}>{neg.status}</span>
          </div>
          <div className="neg-detail-grid">
            <div className="neg-detail-field">
              <div className="detail-section-title">FECHA</div>
              <div className="neg-detail-value">{neg.target_date || '—'}</div>
            </div>
            <div className="neg-detail-field">
              <div className="detail-section-title">NDA</div>
              <div className="neg-detail-value">{neg.nda || '—'}</div>
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
          {neg.notes && (
            <div className="neg-detail-section">
              <div className="detail-section-title">NOTAS</div>
              <div className="neg-detail-notes">{neg.notes}</div>
            </div>
          )}
          {neg.observations && (
            <div className="neg-detail-section">
              <div className="detail-section-title">OBSERVACIONES INTERNAS</div>
              <div className="neg-detail-notes">{neg.observations}</div>
            </div>
          )}
          <div className="neg-detail-section">
            <div className="neg-tasks-header">
              <div className="detail-section-title">TAREAS ({tasks.length})</div>
              <button className="neg-add-task-btn" onClick={() => setShowTaskModal(true)}>+ Nueva tarea</button>
            </div>
            {tasks.length === 0 ? (
              <p className="detail-empty">Sin tareas todavía.</p>
            ) : (
              <div className="neg-tasks-list">
                {tasks.map(task => (
                  <div key={task.id} className={`neg-task-row ${task.status === 'done' ? 'done' : ''}`}>
                    <button className={`neg-task-check ${task.status === 'done' ? 'checked' : ''}`} onClick={() => handleToggleTask(task.id, task.status)}>
                      {task.status === 'done' ? '✓' : ''}
                    </button>
                    <div className="neg-task-body">
                      <span className="neg-task-title">
                        {task.profile && <span style={{ color: '#1D4ED8', fontWeight: 600 }}>@{task.profile.full_name.charAt(0).toUpperCase() + task.profile.full_name.slice(1)}: </span>}
                        {task.title}
                      </span>
                    </div>
                    <span className={`neg-task-status badge-${task.status}`}>{statusLabel(task.status)}</span>
                    {task.due_date && <span className="neg-task-date">{new Date(task.due_date).toLocaleDateString('es-AR')}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="detail-footer">
          {!confirmDelete ? (
            <button className="btn-delete" onClick={() => setConfirmDelete(true)}>Eliminar proyecto</button>
          ) : (
            <div className="delete-confirm">
              <span>¿Seguro?</span>
              <button className="btn-delete-confirm" onClick={handleDelete}>Sí, eliminar</button>
              <button className="btn-secondary" onClick={() => setConfirmDelete(false)}>Cancelar</button>
            </div>
          )}
        </div>
      </div>
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
    supabase.from('workspace_members').select(`user_id, profile:user_id ( full_name )`)
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
              {members.map(m => <option key={m.user_id} value={m.user_id}>{m.profile?.full_name || 'Usuario'}</option>)}
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