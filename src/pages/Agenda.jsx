// Agenda.jsx — Espacio del workspace personal: tablero kanban, calendario y
// notas sueltas, todo sobre `tasks` sin negotiation_id/entity_id (tareas
// "sueltas", no atadas a ningún proyecto/entidad).

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import NotesPostIts from '../components/NotesPostIts'
import { CalendarView, toDateStr, addMinutesToTime } from '../components/CalendarEngine'
import { taskDeepLink } from '../lib/tasks'
import { canEditContent } from '../lib/roles'
import './Agenda.css'

const COLUMNS = [
  { key: 'pending', label: 'Pendiente', color: '#D97706', bg: '#fef3c7' },
  { key: 'in_progress', label: 'En curso', color: '#1D4ED8', bg: '#dbeafe' },
  { key: 'done', label: 'Completado', color: '#059669', bg: '#d1fae5' },
]

const TABS = [
  { key: 'tablero', label: 'Tablero' },
  { key: 'calendario', label: 'Calendario' },
  { key: 'notas', label: 'Notas' },
]

export default function Agenda() {
  const { user, workspaceId, effectiveRole, workspaces, setActiveWorkspace } = useAuth()
  const navigate = useNavigate()
  const canEdit = canEditContent(effectiveRole)
  const [tab, setTab] = useState('tablero')
  const [tasks, setTasks] = useState([])
  const [externalTasks, setExternalTasks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (workspaceId) fetchTasks() }, [workspaceId])
  useEffect(() => { if (user && workspaces.length) fetchExternalTasks() }, [user, workspaces])

  // Todo lo que tenemos asignado en workspaces de equipo — para que la
  // agenda personal "baje a tierra" lo pendiente en todos lados, no solo
  // lo que se cargó acá suelto. Solo lectura: se completa/reprograma desde
  // el proyecto/entidad de origen, no desde acá.
  async function fetchExternalTasks() {
    const teamWsIds = workspaces.filter(w => w.type !== 'personal').map(w => w.id)
    if (teamWsIds.length === 0) { setExternalTasks([]); return }
    const { data, error } = await supabase.from('tasks')
      .select(`
        id, title, status, due_date, due_time, due_time_end, workspace_id, negotiation_id, entity_id,
        entity:entity_id ( entity_type_id )
      `)
      .in('workspace_id', teamWsIds)
      .eq('assigned_to', user.id)
      .neq('status', 'done')
    if (error) { console.error('fetchExternalTasks error:', error.message); return }
    const wsNameById = Object.fromEntries(workspaces.map(w => [w.id, w.name]))
    setExternalTasks((data || []).map(t => ({ ...t, _linked: true, _badge: wsNameById[t.workspace_id] || 'Otro workspace' })))
  }

  function openExternalTask(task) {
    setActiveWorkspace(task.workspace_id)
    navigate(taskDeepLink(task))
  }

  const allTasks = [...tasks, ...externalTasks]

  async function fetchTasks() {
    setLoading(true)
    const { data, error } = await supabase.from('tasks').select('*')
      .eq('workspace_id', workspaceId)
      .is('negotiation_id', null)
      .is('entity_id', null)
      .order('created_at', { ascending: false })
    if (error) console.error('fetchTasks error:', error.message)
    setTasks(data || [])
    setLoading(false)
  }

  async function handleAdd(title, dueDate, dueTime, dueTimeEnd) {
    if (!title.trim()) return
    const { data, error } = await supabase.from('tasks').insert({
      workspace_id: workspaceId,
      title: title.trim(),
      status: 'pending',
      priority: 'medium',
      due_date: dueDate || null,
      due_time: dueTime || null,
      due_time_end: dueTime ? (dueTimeEnd || addMinutesToTime(dueTime, 30)) : null,
      assigned_to: user?.id,
      created_by: user?.id,
    }).select().single()
    if (error) { console.error('addTask error:', error.message); return }
    if (data) setTasks(prev => [data, ...prev])
  }

  async function handleMove(taskId, newStatus) {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t))
    await supabase.from('tasks').update({
      status: newStatus,
      completed_at: newStatus === 'done' ? new Date().toISOString() : null,
    }).eq('id', taskId)
  }

  async function handleDelete(taskId) {
    setTasks(prev => prev.filter(t => t.id !== taskId))
    await supabase.from('tasks').delete().eq('id', taskId)
  }

  return (
    <div className="agenda-container">
      <div className="agenda-header">
        <h1 className="agenda-title">Agenda</h1>
      </div>

      <div className="agenda-tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`agenda-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="agenda-loading">Cargando...</div>
      ) : (
        <>
          {tab === 'tablero' && (
            <KanbanBoard tasks={allTasks} canEdit={canEdit} onAdd={handleAdd} onMove={handleMove} onDelete={handleDelete} onOpenLinked={openExternalTask} />
          )}
          {tab === 'calendario' && (
            <CalendarView tasks={allTasks} canEdit={canEdit} onAdd={handleAdd} onMove={handleMove} onDelete={handleDelete} onOpenLinked={openExternalTask} />
          )}
          {tab === 'notas' && (
            <NotesPostIts workspaceId={workspaceId} canEdit={canEdit} />
          )}
        </>
      )}
    </div>
  )
}

const TODAY_WIDGET_MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const TODAY_WIDGET_WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

function TodayWidget({ tasks, onOpenLinked }) {
  const now = new Date()
  const todayStr = toDateStr(now)
  const todayTasks = tasks
    .filter(t => t.due_date === todayStr && t.status !== 'done')
    .sort((a, b) => {
      if (a.due_time && b.due_time) return a.due_time.localeCompare(b.due_time)
      if (a.due_time) return -1
      if (b.due_time) return 1
      return 0
    })

  return (
    <div className="today-widget">
      <div className="today-widget-header">
        <div>
          <div className="today-widget-title">Hoy</div>
          <div className="today-widget-date">
            {TODAY_WIDGET_WEEKDAYS[now.getDay()]}, {now.getDate()} de {TODAY_WIDGET_MONTHS[now.getMonth()]}
          </div>
        </div>
        {todayTasks.length > 0 && (
          <span className="today-widget-count">{todayTasks.length}</span>
        )}
      </div>
      {todayTasks.length === 0 ? (
        <div className="today-widget-empty">
          <span className="today-widget-empty-icon">✓</span>
          <p>Nada para hoy.</p>
        </div>
      ) : (
        <div className="today-widget-timeline">
          {todayTasks.map(t => (
            <div
              key={t.id}
              className={`today-widget-item ${t._linked ? 'today-widget-item--linked' : ''}`}
              onClick={t._linked ? () => onOpenLinked(t) : undefined}
              role={t._linked ? 'button' : undefined}
            >
              <div className="today-widget-marker">
                <span className="today-widget-dot" />
                <span className="today-widget-line" />
              </div>
              <div className="today-widget-content">
                {t.due_time && <span className="today-widget-time">{t.due_time.slice(0, 5)}</span>}
                <span className="today-widget-task-title">{t.title}</span>
                {t._linked && <span className="calendar-badge">{t._badge}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function KanbanBoard({ tasks, canEdit, onAdd, onMove, onDelete, onOpenLinked }) {
  const [newTitle, setNewTitle] = useState('')
  const [dragOverCol, setDragOverCol] = useState(null)

  function handleAddSubmit() {
    if (!newTitle.trim()) return
    onAdd(newTitle, '')
    setNewTitle('')
  }

  return (
    <div className="tablero-layout">
    <div className="kanban-board">
      {COLUMNS.map((col, idx) => {
        const colTasks = tasks.filter(t => t.status === col.key)
        return (
          <div
            key={col.key}
            className={`kanban-col ${dragOverCol === col.key ? 'drag-over' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOverCol(col.key) }}
            onDragLeave={() => setDragOverCol(null)}
            onDrop={e => {
              e.preventDefault()
              setDragOverCol(null)
              const taskId = e.dataTransfer.getData('text/plain')
              if (taskId) onMove(taskId, col.key)
            }}
          >
            <div className="kanban-col-header" style={{ color: col.color }}>
              {col.label} <span className="kanban-col-count">{colTasks.length}</span>
            </div>

            {col.key === 'pending' && canEdit && (
              <div className="kanban-quick-add">
                <input
                  type="text"
                  placeholder="+ Agregar tarea y Enter..."
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddSubmit() }}
                />
              </div>
            )}

            <div className="kanban-col-body">
              {colTasks.map(task => (
                <div
                  key={task.id}
                  className={`kanban-card ${task._linked ? 'kanban-card--linked' : ''}`}
                  draggable={canEdit && !task._linked}
                  onDragStart={e => !task._linked && e.dataTransfer.setData('text/plain', task.id)}
                  onClick={task._linked ? () => onOpenLinked(task) : undefined}
                  role={task._linked ? 'button' : undefined}
                >
                  {task._linked && <span className="calendar-badge">{task._badge}</span>}
                  <span className="kanban-card-title">{task.title}</span>
                  {task.due_date && (
                    <span className="kanban-card-date">
                      {new Date(task.due_date + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
                      {task.due_time && ` · ${task.due_time.slice(0, 5)}`}
                    </span>
                  )}
                  {canEdit && !task._linked && (
                    <div className="kanban-card-actions">
                      {idx > 0 && (
                        <button title="Mover a la izquierda" onClick={() => onMove(task.id, COLUMNS[idx - 1].key)}>‹</button>
                      )}
                      {idx < COLUMNS.length - 1 && (
                        <button title="Mover a la derecha" onClick={() => onMove(task.id, COLUMNS[idx + 1].key)}>›</button>
                      )}
                      <button title="Eliminar" className="kanban-card-delete" onClick={() => onDelete(task.id)}>✕</button>
                    </div>
                  )}
                </div>
              ))}
              {colTasks.length === 0 && <p className="kanban-empty">Sin tareas.</p>}
            </div>
          </div>
        )
      })}
    </div>
    <TodayWidget tasks={tasks} onOpenLinked={onOpenLinked} />
    </div>
  )
}
