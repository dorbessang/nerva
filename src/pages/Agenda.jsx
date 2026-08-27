// Agenda.jsx — Espacio del workspace personal: tablero kanban, calendario y
// notas sueltas, todo sobre `tasks` sin negotiation_id/entity_id (tareas
// "sueltas", no atadas a ningún proyecto/entidad).

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import NotesPostIts from '../components/NotesPostIts'
import { useCloseOnOutsideOrEscape } from '../lib/useCloseOnOutsideOrEscape'
import { canEditContent } from '../lib/roles'
import './Agenda.css'

// A dónde navegar al clickear una tarea "externa" (de un workspace de
// equipo, traída acá solo para bajar a tierra lo asignado — de sólo
// lectura, se edita/completa desde su proyecto/entidad de origen).
function externalTaskPath(task) {
  if (task.negotiation_id) return `/negotiations?openNeg=${task.negotiation_id}&openTask=${task.id}`
  if (task.entity_id) return `/entities/${task.entity?.entity_type_id}?openEntity=${task.entity_id}`
  return `/tasks?openTask=${task.id}`
}

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
    setExternalTasks((data || []).map(t => ({ ...t, _external: true, _workspaceName: wsNameById[t.workspace_id] || 'Otro workspace' })))
  }

  function openExternalTask(task) {
    setActiveWorkspace(task.workspace_id)
    navigate(externalTaskPath(task))
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
            <KanbanBoard tasks={allTasks} canEdit={canEdit} onAdd={handleAdd} onMove={handleMove} onDelete={handleDelete} onOpenExternal={openExternalTask} />
          )}
          {tab === 'calendario' && (
            <CalendarView tasks={allTasks} canEdit={canEdit} onAdd={handleAdd} onMove={handleMove} onDelete={handleDelete} onOpenExternal={openExternalTask} />
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

function TodayWidget({ tasks, onOpenExternal }) {
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
              className={`today-widget-item ${t._external ? 'today-widget-item--external' : ''}`}
              onClick={t._external ? () => onOpenExternal(t) : undefined}
              role={t._external ? 'button' : undefined}
            >
              <div className="today-widget-marker">
                <span className="today-widget-dot" />
                <span className="today-widget-line" />
              </div>
              <div className="today-widget-content">
                {t.due_time && <span className="today-widget-time">{t.due_time.slice(0, 5)}</span>}
                <span className="today-widget-task-title">{t.title}</span>
                {t._external && <span className="agenda-external-badge">{t._workspaceName}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function KanbanBoard({ tasks, canEdit, onAdd, onMove, onDelete, onOpenExternal }) {
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
                  className={`kanban-card ${task._external ? 'kanban-card--external' : ''}`}
                  draggable={canEdit && !task._external}
                  onDragStart={e => !task._external && e.dataTransfer.setData('text/plain', task.id)}
                  onClick={task._external ? () => onOpenExternal(task) : undefined}
                  role={task._external ? 'button' : undefined}
                >
                  {task._external && <span className="agenda-external-badge">{task._workspaceName}</span>}
                  <span className="kanban-card-title">{task.title}</span>
                  {task.due_date && (
                    <span className="kanban-card-date">
                      {new Date(task.due_date + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
                      {task.due_time && ` · ${task.due_time.slice(0, 5)}`}
                    </span>
                  )}
                  {canEdit && !task._external && (
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
    <TodayWidget tasks={tasks} onOpenExternal={onOpenExternal} />
    </div>
  )
}

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(d, n) {
  const nd = new Date(d)
  nd.setDate(nd.getDate() + n)
  return nd
}

// Lunes de la semana que contiene la fecha dada
function startOfWeek(d) {
  const offset = (d.getDay() + 6) % 7
  return addDays(d, -offset)
}

const HOUR_HEIGHT = 56 // px por hora en las vistas Día/Semana
const MIN_BLOCK_HEIGHT = 18

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function minutesToTime(mins) {
  const m = ((mins % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function addMinutesToTime(t, delta) {
  return minutesToTime(timeToMinutes(t) + delta)
}

// Agrupa tareas con horario que se solapan en "clusters" y les asigna
// columna + cantidad de columnas del cluster, para dibujarlas lado a lado
// (mismo criterio visual que Google Calendar, sin el algoritmo completo).
function layoutTimedTasks(timedTasks) {
  const sorted = [...timedTasks]
    .map(t => ({ ...t, _end: t.due_time_end || addMinutesToTime(t.due_time, 30) }))
    .sort((a, b) => a.due_time.localeCompare(b.due_time) || a._end.localeCompare(b._end))

  const clusters = []
  let current = []
  let currentEnd = null
  for (const t of sorted) {
    if (current.length === 0 || t.due_time < currentEnd) {
      current.push(t)
      currentEnd = !currentEnd || t._end > currentEnd ? t._end : currentEnd
    } else {
      clusters.push(current)
      current = [t]
      currentEnd = t._end
    }
  }
  if (current.length) clusters.push(current)

  const positioned = []
  for (const cluster of clusters) {
    cluster.forEach((t, i) => positioned.push({ ...t, _col: i, _cols: cluster.length }))
  }
  return positioned
}

function CalendarView({ tasks, canEdit, onAdd, onMove, onDelete, onOpenExternal }) {
  const [viewMode, setViewMode] = useState('mes')
  const [selectedDate, setSelectedDate] = useState(new Date())

  return (
    <div>
      <div className="calendar-mode-toggle">
        <button className={viewMode === 'dia' ? 'active' : ''} onClick={() => setViewMode('dia')}>Día</button>
        <button className={viewMode === 'semana' ? 'active' : ''} onClick={() => setViewMode('semana')}>Semana</button>
        <button className={viewMode === 'mes' ? 'active' : ''} onClick={() => setViewMode('mes')}>Mes</button>
      </div>
      {viewMode === 'mes' && (
        <MonthView
          tasks={tasks} canEdit={canEdit} onAdd={onAdd} onMove={onMove} onDelete={onDelete} onOpenExternal={onOpenExternal}
          onSelectDay={(d) => { setSelectedDate(d); setViewMode('dia') }}
        />
      )}
      {viewMode === 'dia' && (
        <DayView
          tasks={tasks} canEdit={canEdit} onAdd={onAdd} onMove={onMove} onDelete={onDelete} onOpenExternal={onOpenExternal}
          selectedDate={selectedDate} onChangeDate={setSelectedDate}
        />
      )}
      {viewMode === 'semana' && (
        <WeekView
          tasks={tasks} canEdit={canEdit} onAdd={onAdd} onMove={onMove} onDelete={onDelete} onOpenExternal={onOpenExternal}
          selectedDate={selectedDate} onChangeDate={setSelectedDate}
        />
      )}
    </div>
  )
}

function MonthView({ tasks, canEdit, onAdd, onMove, onDelete, onOpenExternal, onSelectDay }) {
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [addingDay, setAddingDay] = useState(null)
  const [addingTitle, setAddingTitle] = useState('')
  const [showQuickAdd, setShowQuickAdd] = useState(false)

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
        {canEdit && <button className="quick-add-trigger" onClick={() => setShowQuickAdd(v => !v)}>+ Nuevo evento</button>}
      </div>

      {showQuickAdd && (
        <QuickAddPanel defaultDate={new Date(year, monthIdx, 1)} onAdd={onAdd} onClose={() => setShowQuickAdd(false)} />
      )}

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
              <button className="calendar-cell-day" onClick={() => onSelectDay(new Date(year, monthIdx, d))} title="Ver día">{d}</button>
              <div className="calendar-cell-tasks">
                {dayTasks.map(task => task._external ? (
                  <div key={task.id} className="calendar-task calendar-task--external" onClick={() => onOpenExternal(task)} role="button">
                    <span className="agenda-external-badge">{task._workspaceName}</span>
                    <span className="calendar-task-title">{task.title}</span>
                  </div>
                ) : (
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

const HOURS = Array.from({ length: 24 }, (_, i) => i)

function AllDayRow({ dates, tasks, canEdit, onAdd, onDelete, onMove, onOpenExternal }) {
  const [addingDate, setAddingDate] = useState(null)
  const [addingTitle, setAddingTitle] = useState('')

  function submitAdd(dStr) {
    if (!addingTitle.trim()) { setAddingDate(null); return }
    onAdd(addingTitle, dStr, null, null)
    setAddingTitle('')
    setAddingDate(null)
  }

  return (
    <div className="allday-row" style={{ gridTemplateColumns: `70px repeat(${dates.length}, 1fr)` }}>
      <span className="day-allday-label">Sin horario</span>
      {dates.map(date => {
        const dStr = toDateStr(date)
        const dayTasks = tasks.filter(t => t.due_date === dStr && !t.due_time)
        return (
          <div key={dStr} className="allday-cell">
            {dayTasks.map(task => task._external ? (
              <div key={task.id} className="calendar-task calendar-task--external" onClick={() => onOpenExternal(task)} role="button">
                <span className="agenda-external-badge">{task._workspaceName}</span>
                <span className="calendar-task-title">{task.title}</span>
              </div>
            ) : (
              <div key={task.id} className={`calendar-task ${task.status === 'done' ? 'done' : ''}`}>
                <input
                  type="checkbox"
                  checked={task.status === 'done'}
                  onChange={() => onMove(task.id, task.status === 'done' ? 'pending' : 'done')}
                  disabled={!canEdit}
                />
                <span className="calendar-task-title">{task.title}</span>
                {canEdit && <button className="calendar-task-delete" onClick={() => onDelete(task.id)}>✕</button>}
              </div>
            ))}
            {canEdit && (addingDate === dStr ? (
              <input
                type="text" autoFocus className="calendar-add-input"
                value={addingTitle} onChange={e => setAddingTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitAdd(dStr); if (e.key === 'Escape') setAddingDate(null) }}
                onBlur={() => submitAdd(dStr)}
              />
            ) : (
              <button className="calendar-add-btn calendar-add-btn--wide" onClick={() => { setAddingDate(dStr); setAddingTitle('') }}>+</button>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function HourGutter() {
  return (
    <div className="hour-gutter" style={{ height: HOUR_HEIGHT * 24 }}>
      {HOURS.map(h => (
        <div key={h} className="hour-gutter-label" style={{ top: h * HOUR_HEIGHT }}>{String(h).padStart(2, '0')}:00</div>
      ))}
    </div>
  )
}

// Columna de un día en la grilla horaria — se reusa tal cual en Día (una
// sola, ancha) y en Semana (7, angostas, una al lado de la otra).
function TimeColumn({ date, tasks, canEdit, onAdd, onMove, onDelete, onOpenExternal }) {
  const [addingTime, setAddingTime] = useState(null)
  const [addingTitle, setAddingTitle] = useState('')
  const [addingEnd, setAddingEnd] = useState('')
  const formRef = useRef(null)

  const dStr = toDateStr(date)
  const timedTasks = tasks.filter(t => t.due_date === dStr && t.due_time)
  const positioned = layoutTimedTasks(timedTasks)

  function closeAdd() { setAddingTime(null) }
  useCloseOnOutsideOrEscape(formRef, !!addingTime, closeAdd)

  function handleSlotClick(e) {
    if (!canEdit) return
    const rect = e.currentTarget.getBoundingClientRect()
    const offsetY = e.clientY - rect.top
    const totalMinutes = Math.max(0, Math.floor((offsetY / HOUR_HEIGHT) * 60))
    const snapped = Math.floor(totalMinutes / 30) * 30
    const start = minutesToTime(snapped)
    setAddingTime(start)
    setAddingTitle('')
    setAddingEnd(addMinutesToTime(start, 30))
  }

  function submitAdd(e) {
    e?.preventDefault()
    if (!addingTitle.trim()) { setAddingTime(null); return }
    onAdd(addingTitle, dStr, addingTime, addingEnd || null)
    setAddingTime(null)
    setAddingTitle('')
  }

  return (
    <div className="time-col" style={{ height: HOUR_HEIGHT * 24 }} onClick={handleSlotClick}>
      {HOURS.map(h => (
        <div key={h} className="time-col-hourline" style={{ top: h * HOUR_HEIGHT }} />
      ))}

      {positioned.map(task => {
        const top = (timeToMinutes(task.due_time) / 60) * HOUR_HEIGHT
        const height = Math.max(((timeToMinutes(task._end) - timeToMinutes(task.due_time)) / 60) * HOUR_HEIGHT, MIN_BLOCK_HEIGHT)
        const widthPct = 100 / task._cols
        const leftPct = widthPct * task._col
        if (task._external) {
          return (
            <div
              key={task.id}
              className="time-block time-block--external"
              style={{ top, height, left: `${leftPct}%`, width: `calc(${widthPct}% - 3px)` }}
              onClick={e => { e.stopPropagation(); onOpenExternal(task) }}
              role="button"
              title={`${task.due_time.slice(0, 5)}–${task._end.slice(0, 5)} · ${task.title} · ${task._workspaceName}`}
            >
              <span className="time-block-body">
                <span className="time-block-time">{task.due_time.slice(0, 5)}</span>
                <span className="time-block-title">{task.title}</span>
                <span className="agenda-external-badge">{task._workspaceName}</span>
              </span>
            </div>
          )
        }
        return (
          <div
            key={task.id}
            className={`time-block ${task.status === 'done' ? 'done' : ''}`}
            style={{ top, height, left: `${leftPct}%`, width: `calc(${widthPct}% - 3px)` }}
            onClick={e => e.stopPropagation()}
            title={`${task.due_time.slice(0, 5)}–${task._end.slice(0, 5)} · ${task.title}`}
          >
            <input
              type="checkbox"
              checked={task.status === 'done'}
              onChange={() => onMove(task.id, task.status === 'done' ? 'pending' : 'done')}
              disabled={!canEdit}
            />
            <span className="time-block-body">
              <span className="time-block-time">{task.due_time.slice(0, 5)}</span>
              <span className="time-block-title">{task.title}</span>
            </span>
            {canEdit && <button className="time-block-delete" onClick={() => onDelete(task.id)}>✕</button>}
          </div>
        )
      })}

      {addingTime && (
        <form
          className="time-add-form" ref={formRef}
          style={{ top: (timeToMinutes(addingTime) / 60) * HOUR_HEIGHT }}
          onClick={e => e.stopPropagation()}
          onSubmit={submitAdd}
        >
          <input
            type="text" autoFocus placeholder="Título..." className="time-add-title"
            value={addingTitle} onChange={e => setAddingTitle(e.target.value)}
          />
          <div className="time-add-row">
            <span>{addingTime} –</span>
            <input
              type="time" className="time-add-end" value={addingEnd}
              onChange={e => setAddingEnd(e.target.value)}
            />
            <button type="submit" className="time-add-ok">OK</button>
          </div>
        </form>
      )}
    </div>
  )
}

// Botón "+ Nuevo evento" — entrada alternativa a "click en la grilla" para
// cuando la franja deseada ya está ocupada por otro evento (el bloque tapa
// el click) o simplemente para no tener que ubicarlo a ojo.
function QuickAddPanel({ defaultDate, onAdd, onClose }) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(toDateStr(defaultDate))
  const [start, setStart] = useState(() => {
    const now = new Date()
    return minutesToTime(Math.floor((now.getHours() * 60 + now.getMinutes()) / 30) * 30)
  })
  const [end, setEnd] = useState(() => addMinutesToTime(start, 30))
  const formRef = useRef(null)

  useCloseOnOutsideOrEscape(formRef, true, onClose)

  function submit(e) {
    e?.preventDefault()
    if (!title.trim()) return
    onAdd(title, date, start, end)
    onClose()
  }

  return (
    <form className="quick-add-panel" ref={formRef} onSubmit={submit}>
      <input
        type="text" autoFocus placeholder="Título del evento..." className="quick-add-title"
        value={title} onChange={e => setTitle(e.target.value)}
      />
      <input type="date" value={date} onChange={e => setDate(e.target.value)} />
      <input type="time" value={start} onChange={e => { setStart(e.target.value); setEnd(addMinutesToTime(e.target.value, 30)) }} />
      <span className="quick-add-sep">–</span>
      <input type="time" value={end} onChange={e => setEnd(e.target.value)} />
      <button type="submit" className="time-add-ok">Agregar</button>
      <button type="button" className="quick-add-cancel" onClick={onClose}>✕</button>
    </form>
  )
}

function DayView({ tasks, canEdit, onAdd, onMove, onDelete, onOpenExternal, selectedDate, onChangeDate }) {
  const scrollRef = useRef(null)
  const [showQuickAdd, setShowQuickAdd] = useState(false)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_HEIGHT // arranca mostrando ~7am
  }, [])

  return (
    <div className="day-view">
      <div className="calendar-nav">
        <button onClick={() => onChangeDate(addDays(selectedDate, -1))}>‹</button>
        <span className="calendar-month-label">
          {selectedDate.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^\w/, c => c.toUpperCase())}
        </span>
        <button onClick={() => onChangeDate(addDays(selectedDate, 1))}>›</button>
        <button className="calendar-today-btn" onClick={() => onChangeDate(new Date())}>Hoy</button>
        {canEdit && <button className="quick-add-trigger" onClick={() => setShowQuickAdd(v => !v)}>+ Nuevo evento</button>}
      </div>

      {showQuickAdd && (
        <QuickAddPanel defaultDate={selectedDate} onAdd={onAdd} onClose={() => setShowQuickAdd(false)} />
      )}

      <AllDayRow dates={[selectedDate]} tasks={tasks} canEdit={canEdit} onAdd={onAdd} onDelete={onDelete} onMove={onMove} onOpenExternal={onOpenExternal} />

      <div className="time-grid-scroll" ref={scrollRef}>
        <div className="time-grid-inner">
          <HourGutter />
          <TimeColumn date={selectedDate} tasks={tasks} canEdit={canEdit} onAdd={onAdd} onMove={onMove} onDelete={onDelete} onOpenExternal={onOpenExternal} />
        </div>
      </div>
    </div>
  )
}

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function WeekView({ tasks, canEdit, onAdd, onMove, onDelete, onOpenExternal, selectedDate, onChangeDate }) {
  const scrollRef = useRef(null)
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const weekStart = startOfWeek(selectedDate)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const todayStr = toDateStr(new Date())

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_HEIGHT
  }, [])

  const weekEnd = addDays(weekStart, 6)
  const label = `${weekStart.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} – ${weekEnd.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}`

  return (
    <div className="day-view">
      <div className="calendar-nav">
        <button onClick={() => onChangeDate(addDays(selectedDate, -7))}>‹</button>
        <span className="calendar-month-label">{label}</span>
        <button onClick={() => onChangeDate(addDays(selectedDate, 7))}>›</button>
        <button className="calendar-today-btn" onClick={() => onChangeDate(new Date())}>Hoy</button>
        {canEdit && <button className="quick-add-trigger" onClick={() => setShowQuickAdd(v => !v)}>+ Nuevo evento</button>}
      </div>

      {showQuickAdd && (
        <QuickAddPanel defaultDate={selectedDate} onAdd={onAdd} onClose={() => setShowQuickAdd(false)} />
      )}

      <div className="week-day-headers" style={{ gridTemplateColumns: `70px repeat(7, 1fr)` }}>
        <span />
        {days.map((d, i) => (
          <div key={i} className={`week-day-header ${toDateStr(d) === todayStr ? 'today' : ''}`}>
            {WEEKDAY_LABELS[i]} <strong>{d.getDate()}</strong>
          </div>
        ))}
      </div>

      <AllDayRow dates={days} tasks={tasks} canEdit={canEdit} onAdd={onAdd} onDelete={onDelete} onMove={onMove} onOpenExternal={onOpenExternal} />

      <div className="time-grid-scroll" ref={scrollRef}>
        <div className="time-grid-inner">
          <HourGutter />
          <div className="time-grid-week-cols">
            {days.map((d, i) => (
              <TimeColumn key={i} date={d} tasks={tasks} canEdit={canEdit} onAdd={onAdd} onMove={onMove} onDelete={onDelete} onOpenExternal={onOpenExternal} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
