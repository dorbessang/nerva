import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import TaskModal from '../components/TaskModal'
import TaskDrawer from '../components/TaskDrawer'
import SearchableSelect from '../components/SearchableSelect'
import { isTaskBlocked, notifySuccessors, dismissNotificationsForTask, wouldCreateCycle } from '../lib/tasks'
import { logActivity } from '../lib/activity'
import { naturalSortByName } from '../lib/tableSort'
import { isPrivileged as isPrivilegedRole, canEditContent } from '../lib/roles'
import './Tasks.css'

export default function Tasks() {
  const { user, role, workspaceId, effectiveRole } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const isPrivileged = isPrivilegedRole(effectiveRole)
  const canCreateTask = canEditContent(effectiveRole)
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('mine')
  const [filterEntity, setFilterEntity] = useState('')
  const [filterNegotiation, setFilterNegotiation] = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')
  const hasActiveFilters = filterEntity !== '' || filterNegotiation !== '' || filterAssignee !== ''
  function clearAllFilters() {
    setFilterEntity('')
    setFilterNegotiation('')
    setFilterAssignee('')
  }
  const [entities, setEntities] = useState([])
  const [negotiations, setNegotiations] = useState([])
  const [members, setMembers] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [confirmTask, setConfirmTask] = useState(null)
  const [selectedTask, setSelectedTask] = useState(null)
  const [dragTaskId, setDragTaskId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  const [dropConfirm, setDropConfirm] = useState(null) // { dragged, target }
  const [dropError, setDropError] = useState(null)

  // Deep-link desde otras pantallas (ej: "tareas pendientes" del resumen de
  // un proyecto) — abre Tareas ya filtrado, sin tener que rearmar el filtro
  // a mano.
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const neg = params.get('negotiation')
    const status = params.get('status')
    if (neg) setFilterNegotiation(neg)
    if (status) setFilter(status)
  }, [])

  useEffect(() => {
    if (!workspaceId) return
    fetchEntities()
    fetchNegotiations()
    fetchMembers()
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId) return
    fetchTasks()
  }, [workspaceId, filter, filterEntity, filterNegotiation, filterAssignee, effectiveRole])

  async function fetchEntities() {
    const { data } = await supabase.from('entities').select('id, name').eq('workspace_id', workspaceId).order('name')
    if (data) setEntities(naturalSortByName(data))
  }

  async function fetchNegotiations() {
    const { data } = await supabase
      .from('negotiations')
      .select('id, title, product')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
    if (data) setNegotiations(data)
  }

  async function fetchMembers() {
    const { data } = await supabase
      .from('workspace_members')
      .select(`user_id, profile:user_id ( full_name )`)
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
    if (data) setMembers(data)
  }

  async function fetchTasks() {
    setLoading(true)
    let query = supabase
      .from('tasks')
      .select(`
        *,
        profile:assigned_to ( full_name ),
        negotiation:negotiation_id ( id, title, product ),
        entity:entity_id ( id, name, country_code ),
        predecessor:predecessor_task_id ( id, title, status, profile:assigned_to ( full_name ) )
      `)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })

    // Viewer solo ve sus propias tareas
    if (effectiveRole === 'viewer') query = query.eq('assigned_to', user?.id)
    if (filter === 'active') query = query.in('status', ['pending', 'in_progress'])
    if (filter === 'mine') query = query.in('status', ['pending', 'in_progress']).eq('assigned_to', user?.id)
    if (filter === 'others') query = query.in('status', ['pending', 'in_progress']).neq('assigned_to', user?.id)
    if (filter === 'unassigned') query = query.in('status', ['pending', 'in_progress']).is('assigned_to', null)
    if (filter === 'done') query = query.eq('status', 'done')
    if (filterAssignee) query = query.eq('assigned_to', filterAssignee)
    if (filterNegotiation) query = query.eq('negotiation_id', filterNegotiation)

    const { data, error } = await query
    if (error) console.log('Error tasks:', error)

    let result = data || []

    if (filterEntity) {
      const neg = negotiations.filter(n => result.some(t => t.negotiation_id === n.id))
      result = result.filter(t => {
        if (!t.negotiation_id) return false
        return neg.some(n => n.id === t.negotiation_id)
      })
    }

    // Traemos las entidades de cada negociación
    const negIds = [...new Set(result.map(t => t.negotiation_id).filter(Boolean))]
    let negEntities = []
    if (negIds.length > 0) {
      const { data: ne } = await supabase
        .from('negotiation_entities')
        .select('negotiation_id, entity:entity_id ( name, country_code )')
        .in('negotiation_id', negIds)
      negEntities = ne || []
    }

    result = result.map(task => ({
      ...task,
      negotiation: task.negotiation ? {
        ...task.negotiation,
        entity: negEntities.find(ne => ne.negotiation_id === task.negotiation_id)?.entity || null
      } : null
    }))

    setTasks(result)
    setLoading(false)

    // Si viene de una notificación, abre directo el detalle de esa tarea
    const openTaskId = new URLSearchParams(location.search).get('openTask')
    if (openTaskId) {
      const found = result.find(t => t.id === openTaskId)
      if (found) setSelectedTask(found)
      navigate('/tasks', { replace: true })
    }
  }

  function handleCheckClick(task) {
    if (task.status === 'done' || isTaskBlocked(task)) return
    setConfirmTask(task)
  }

  function handleDrop(targetTask) {
    const draggedTask = tasks.find(t => t.id === dragTaskId)
    setDragOverId(null)
    if (!draggedTask || draggedTask.id === targetTask.id) return
    setDropConfirm({ dragged: draggedTask, target: targetTask })
  }

  // El chequeo de ciclo necesita el árbol completo de predecesoras del
  // workspace, no solo lo que está cargado en pantalla (puede estar filtrado).
  async function confirmSetPredecessor() {
    setDropError(null)
    const { dragged, target } = dropConfirm
    const { data: allTasks } = await supabase.from('tasks').select('id, predecessor_task_id').eq('workspace_id', workspaceId)
    if (wouldCreateCycle(allTasks || [], dragged.id, target.id)) {
      setDropError('Esa dependencia crearía un ciclo (una tarea terminaría dependiendo de sí misma).')
      return
    }
    const { error } = await supabase.from('tasks').update({ predecessor_task_id: target.id }).eq('id', dragged.id)
    if (error) { setDropError('No se pudo guardar la dependencia. Intentá de nuevo.'); return }
    setDropConfirm(null)
    fetchTasks()
  }

  async function handleConfirmDone() {
    const { error } = await supabase
      .from('tasks')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', confirmTask.id)
    if (!error) {
      await notifySuccessors(supabase, confirmTask, workspaceId)
      await dismissNotificationsForTask(supabase, confirmTask.id)
      if (confirmTask.negotiation_id || confirmTask.entity_id) {
        await logActivity(supabase, {
          workspaceId, negotiationId: confirmTask.negotiation_id, entityId: confirmTask.entity_id,
          type: 'task_completed', title: `Tarea completada: "${confirmTask.title}"`, actorId: user?.id,
        })
      }
      setConfirmTask(null)
      fetchTasks()
    }
  }

  function statusLabel(status) {
    const map = { pending: 'Pendiente', in_progress: 'En progreso', done: 'Hecho', cancelled: 'Cancelado' }
    return map[status] || status
  }

  function priorityLabel(priority) {
    const map = { low: 'Baja', medium: 'Media', high: 'Alta', urgent: 'Urgente' }
    return map[priority] || priority
  }

  const pendingCount = tasks.filter(t => t.status !== 'done').length
  const doneCount = tasks.filter(t => t.status === 'done').length

  return (
    <div className="tasks-container">
      <div className="tasks-header">
        <h1 className="tasks-title">Tareas</h1>
        {canCreateTask && (
          <button className="tasks-new-btn" onClick={() => setShowModal(true)}>
            + Nueva tarea
          </button>
        )}
      </div>

      <div className="tasks-toolbar">
        <div className="tasks-filters">
          {[
            { key: 'mine', label: 'Mis tareas' },
            ...(canEditContent(effectiveRole) ? [{ key: 'others', label: 'Terceros' }, { key: 'unassigned', label: 'De equipo' }] : []),
            ...(isPrivileged ? [{ key: 'active', label: 'Todas activas' }] : [{ key: 'active', label: 'Activas' }]),
            { key: 'done', label: 'Hechas' },
          ].map(f => (
            <button
              key={f.key}
              className={`filter-btn ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="tasks-dropdowns">
          <div className="filter-field">
            <label className="filter-field-label">Proyecto</label>
            <SearchableSelect
              value={filterNegotiation}
              onChange={setFilterNegotiation}
              options={negotiations.map(n => ({ value: n.id, label: n.product || n.title }))}
              placeholder="Buscar proyecto..."
              emptyLabel="Todos los proyectos"
            />
          </div>

          <div className="filter-field">
            <label className="filter-field-label">Proveedor</label>
            <SearchableSelect
              value={filterEntity}
              onChange={setFilterEntity}
              options={entities.map(e => ({ value: e.id, label: e.name }))}
              placeholder="Buscar proveedor..."
              emptyLabel="Todos los proveedores"
            />
          </div>

          {isPrivileged && (
            <div className="filter-field">
              <label className="filter-field-label">Responsable</label>
              <select className="dropdown-filter" value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
                <option value="">Todos los responsables</option>
                {members.map(m => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.profile?.full_name || 'Usuario'}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {hasActiveFilters && (
          <button type="button" className="clear-filters-btn" onClick={clearAllFilters}>✕ Limpiar filtros</button>
        )}
      </div>

      {filter !== 'done' && (
        <p className="tasks-count">
          {pendingCount} pendiente{pendingCount !== 1 ? 's' : ''}
          {doneCount > 0 && ` · ${doneCount} completada${doneCount !== 1 ? 's' : ''}`}
        </p>
      )}

      {loading ? (
        <div className="tasks-loading">Cargando tareas...</div>
      ) : tasks.length === 0 ? (
        <div className="tasks-empty">
          <p>No hay tareas todavía.</p>
        </div>
      ) : (
        <div className="tasks-list">
          {tasks.map(task => {
            const blocked = isTaskBlocked(task)
            return (
            <div
              key={task.id}
              className={`task-card ${task.status === 'done' ? 'status-done' : ''} ${dragOverId === task.id ? 'task-card--drag-over' : ''}`}
              onClick={() => setSelectedTask(task)}
              draggable={canCreateTask}
              onDragStart={() => setDragTaskId(task.id)}
              onDragOver={e => { if (canCreateTask) { e.preventDefault(); setDragOverId(task.id) } }}
              onDragLeave={() => setDragOverId(id => (id === task.id ? null : id))}
              onDrop={e => { e.preventDefault(); if (canCreateTask) handleDrop(task) }}
              title={canCreateTask ? 'Arrastrá una tarea sobre otra para marcarla como dependiente' : undefined}
            >
              <button
                className={`task-check ${task.status === 'done' ? 'checked' : ''}`}
                onClick={(e) => { e.stopPropagation(); handleCheckClick(task) }}
                disabled={blocked}
                title={blocked ? 'Esta tarea depende de otra que todavía no se completó' : 'Marcar como completada'}
              >
                {task.status === 'done' ? '✓' : blocked ? '🔒' : ''}
              </button>

              <div className="task-card-body">
                <p className="task-title">
                  {task.profile && (() => {
                    const isOther = task.assigned_to && task.assigned_to !== user?.id
                    if (isPrivileged || !isOther) {
                      return <span className="task-assignee">@{task.profile.full_name.charAt(0).toUpperCase() + task.profile.full_name.slice(1)}: </span>
                    }
                    return <span style={{ color: '#9ca3af', fontWeight: 500 }}>Asignado a otro miembro: </span>
                  })()}
                  {task.title}
                </p>
                {blocked && (
                  <p className="task-blocked-note">
                    {isPrivileged
                      ? `🔒 Bloqueada por "${task.predecessor.title}" (${task.predecessor.profile?.full_name || 'sin asignar'} · ${statusLabel(task.predecessor.status)})`
                      : '🔒 Pendiente de aprobación previa'}
                  </p>
                )}
                {task.negotiation && (
                  <p className="task-meta">
                    {task.negotiation.entity?.country_code && (
                      <img
                        src={`https://flagcdn.com/w20/${task.negotiation.entity.country_code.toLowerCase()}.png`}
                        alt=""
                        style={{ width: 14, borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }}
                      />
                    )}
                    {task.negotiation.entity?.name && (
                      <span style={{ fontWeight: 600, color: '#374151' }}>
                        {task.negotiation.entity.name}
                      </span>
                    )}
                    {task.negotiation.entity?.name && ' · '}
                    {task.negotiation.product || task.negotiation.title}
                  </p>
                )}
                {!task.negotiation && task.entity && (
                  <p className="task-meta">
                    {task.entity.country_code && (
                      <img
                        src={`https://flagcdn.com/w20/${task.entity.country_code.toLowerCase()}.png`}
                        alt=""
                        style={{ width: 14, borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }}
                      />
                    )}
                    <span style={{ fontWeight: 600, color: '#374151' }}>{task.entity.name}</span>
                  </p>
                )}
              </div>

              <div className="task-card-right">
                <span className="task-priority-slot">
                  {(task.priority === 'high' || task.priority === 'urgent') && (
                    <span className={`task-priority priority-${task.priority}`}>
                      {task.priority === 'high' ? 'Alta' : 'Urgente'}
                    </span>
                  )}
                </span>
                <span className={`task-status-badge badge-${task.status}`}>
                  {task.status === 'pending' ? 'Pendiente' : task.status === 'in_progress' ? 'En progreso' : 'Hecho'}
                </span>
                <span className="task-due">
                  {task.due_date ? new Date(task.due_date + 'T00:00:00').toLocaleDateString('es-AR') : ''}
                </span>
              </div>
            </div>
          )})}
        </div>
      )}

      {showModal && (
        <TaskModal
          onClose={() => setShowModal(false)}
          onCreated={fetchTasks}
        />
      )}

      {confirmTask && (
        <div className="confirm-overlay" onClick={() => setConfirmTask(null)}>
          <div className="confirm-card" onClick={e => e.stopPropagation()}>
            <p className="confirm-title">¿Marcar como completada?</p>
            <p className="confirm-desc">"{confirmTask.title}"</p>
            <div className="confirm-actions">
              <button className="btn-secondary" onClick={() => setConfirmTask(null)}>Cancelar</button>
              <button className="btn-confirm" onClick={handleConfirmDone}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {dropConfirm && (
        <div className="confirm-overlay" onClick={() => { setDropConfirm(null); setDropError(null) }}>
          <div className="confirm-card" onClick={e => e.stopPropagation()}>
            <p className="confirm-title">¿Marcar como dependiente?</p>
            <p className="confirm-desc">
              "{dropConfirm.dragged.title}" va a quedar bloqueada hasta que "{dropConfirm.target.title}" se marque como hecha.
            </p>
            {dropError && <p className="form-error">{dropError}</p>}
            <div className="confirm-actions">
              <button className="btn-secondary" onClick={() => { setDropConfirm(null); setDropError(null) }}>Cancelar</button>
              <button className="btn-confirm" onClick={confirmSetPredecessor}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdated={fetchTasks}
        />
      )}
    </div>
  )
}