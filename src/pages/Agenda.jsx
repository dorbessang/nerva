// Agenda.jsx — Espacio del workspace personal: tablero kanban, calendario y
// notas sueltas, todo sobre `tasks` sin negotiation_id/entity_id (tareas
// "sueltas", no atadas a ningún proyecto/entidad).

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import NotesPostIts from '../components/NotesPostIts'
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
  const { user, workspaceId, effectiveRole } = useAuth()
  const canEdit = effectiveRole !== 'viewer'
  const [tab, setTab] = useState('tablero')
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (workspaceId) fetchTasks() }, [workspaceId])

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

  async function handleAdd(title, dueDate) {
    if (!title.trim()) return
    const { data, error } = await supabase.from('tasks').insert({
      workspace_id: workspaceId,
      title: title.trim(),
      status: 'pending',
      priority: 'medium',
      due_date: dueDate || null,
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
            <KanbanBoard tasks={tasks} canEdit={canEdit} onAdd={handleAdd} onMove={handleMove} onDelete={handleDelete} />
          )}
          {tab === 'calendario' && (
            <CalendarView tasks={tasks} canEdit={canEdit} onAdd={handleAdd} onMove={handleMove} onDelete={handleDelete} />
          )}
          {tab === 'notas' && (
            <NotesPostIts workspaceId={workspaceId} canEdit={canEdit} />
          )}
        </>
      )}
    </div>
  )
}

function KanbanBoard({ tasks, canEdit, onAdd, onMove, onDelete }) {
  const [newTitle, setNewTitle] = useState('')
  const [dragOverCol, setDragOverCol] = useState(null)

  function handleAddSubmit() {
    if (!newTitle.trim()) return
    onAdd(newTitle, '')
    setNewTitle('')
  }

  return (
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
                  className="kanban-card"
                  draggable={canEdit}
                  onDragStart={e => e.dataTransfer.setData('text/plain', task.id)}
                >
                  <span className="kanban-card-title">{task.title}</span>
                  {task.due_date && (
                    <span className="kanban-card-date">{new Date(task.due_date + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}</span>
                  )}
                  {canEdit && (
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
  )
}

function CalendarView({ tasks, canEdit, onAdd, onMove, onDelete }) {
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [addingDay, setAddingDay] = useState(null)
  const [addingTitle, setAddingTitle] = useState('')

  const todayStr = new Date().toISOString().split('T')[0]

  const tasksByDay = {}
  for (const t of tasks) {
    if (!t.due_date) continue
    if (!tasksByDay[t.due_date]) tasksByDay[t.due_date] = []
    tasksByDay[t.due_date].push(t)
  }

  const year = month.getFullYear()
  const monthIdx = month.getMonth()
  const firstOfMonth = new Date(year, monthIdx, 1)
  // Lunes=0 ... Domingo=6
  const startOffset = (firstOfMonth.getDay() + 6) % 7
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate()

  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  function dayStr(d) {
    return `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }

  function submitAdd(dStr) {
    if (!addingTitle.trim()) { setAddingDay(null); return }
    onAdd(addingTitle, dStr)
    setAddingTitle('')
    setAddingDay(null)
  }

  return (
    <div className="calendar-view">
      <div className="calendar-nav">
        <button onClick={() => setMonth(new Date(year, monthIdx - 1, 1))}>‹</button>
        <span className="calendar-month-label">
          {month.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }).replace(/^\w/, c => c.toUpperCase())}
        </span>
        <button onClick={() => setMonth(new Date(year, monthIdx + 1, 1))}>›</button>
        <button className="calendar-today-btn" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Hoy</button>
      </div>

      <div className="calendar-grid">
        {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => (
          <div key={d} className="calendar-weekday">{d}</div>
        ))}
        {cells.map((d, idx) => {
          if (d === null) return <div key={idx} className="calendar-cell calendar-cell--empty" />
          const dStr = dayStr(d)
          const dayTasks = tasksByDay[dStr] || []
          const isToday = dStr === todayStr
          return (
            <div key={idx} className={`calendar-cell ${isToday ? 'calendar-cell--today' : ''}`}>
              <div className="calendar-cell-day">{d}</div>
              <div className="calendar-cell-tasks">
                {dayTasks.map(task => (
                  <div key={task.id} className={`calendar-task ${task.status === 'done' ? 'done' : ''}`}>
                    <input
                      type="checkbox"
                      checked={task.status === 'done'}
                      onChange={() => onMove(task.id, task.status === 'done' ? 'pending' : 'done')}
                      disabled={!canEdit}
                    />
                    <span className="calendar-task-title">{task.title}</span>
                    {canEdit && (
                      <button className="calendar-task-delete" onClick={() => onDelete(task.id)}>✕</button>
                    )}
                  </div>
                ))}
                {canEdit && addingDay === dStr ? (
                  <input
                    type="text"
                    autoFocus
                    className="calendar-add-input"
                    value={addingTitle}
                    onChange={e => setAddingTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') submitAdd(dStr); if (e.key === 'Escape') setAddingDay(null) }}
                    onBlur={() => submitAdd(dStr)}
                  />
                ) : canEdit && (
                  <button className="calendar-add-btn" onClick={() => { setAddingDay(dStr); setAddingTitle('') }}>+</button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
