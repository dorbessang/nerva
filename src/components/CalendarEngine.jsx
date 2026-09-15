// CalendarEngine — vistas Día/Semana/Mes reusables sobre una lista de
// tareas con due_date/due_time. Extraído de Agenda.jsx para poder usarse
// también en el calendario grupal del workspace, sin duplicar el motor.
//
// Una tarea es "editable inline" (checkbox/borrar) por default. Si trae
// `_linked: true`, se renderiza como solo-click: no se puede marcar/borrar
// desde acá, un click dispara `onOpenLinked(task)` para ir a su origen
// (proyecto/entidad). Cualquier tarea puede sumar `_badge` (texto corto,
// ej. nombre de workspace o de la persona asignada) para mostrar de quién
// o de dónde es, sin que eso cambie si es editable o no.

import { useState, useRef, useEffect } from 'react'
import { useCloseOnOutsideOrEscape } from '../lib/useCloseOnOutsideOrEscape'
import Field from './FieldLabel'
import './CalendarEngine.css'

export function toDateStr(d) {
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

export function addMinutesToTime(t, delta) {
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

export function CalendarView({ tasks, canEdit, onAdd, onMove, onDelete, onOpenLinked }) {
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
          tasks={tasks} canEdit={canEdit} onAdd={onAdd} onMove={onMove} onDelete={onDelete} onOpenLinked={onOpenLinked}
          onSelectDay={(d) => { setSelectedDate(d); setViewMode('dia') }}
        />
      )}
      {viewMode === 'dia' && (
        <DayView
          tasks={tasks} canEdit={canEdit} onAdd={onAdd} onMove={onMove} onDelete={onDelete} onOpenLinked={onOpenLinked}
          selectedDate={selectedDate} onChangeDate={setSelectedDate}
        />
      )}
      {viewMode === 'semana' && (
        <WeekView
          tasks={tasks} canEdit={canEdit} onAdd={onAdd} onMove={onMove} onDelete={onDelete} onOpenLinked={onOpenLinked}
          selectedDate={selectedDate} onChangeDate={setSelectedDate}
        />
      )}
    </div>
  )
}

function MonthView({ tasks, canEdit, onAdd, onMove, onDelete, onOpenLinked, onSelectDay }) {
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
                {dayTasks.map(task => task._linked ? (
                  <div key={task.id} className="calendar-task calendar-task--linked" onClick={() => onOpenLinked(task)} role="button">
                    {task._badge && <span className="calendar-badge">{task._badge}</span>}
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
                    {task._badge && <span className="calendar-badge">{task._badge}</span>}
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

function AllDayRow({ dates, tasks, canEdit, onAdd, onDelete, onMove, onOpenLinked }) {
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
            {dayTasks.map(task => task._linked ? (
              <div key={task.id} className="calendar-task calendar-task--linked" onClick={() => onOpenLinked(task)} role="button">
                {task._badge && <span className="calendar-badge">{task._badge}</span>}
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
                {task._badge && <span className="calendar-badge">{task._badge}</span>}
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
function TimeColumn({ date, tasks, canEdit, onAdd, onMove, onDelete, onOpenLinked }) {
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
        if (task._linked) {
          return (
            <div
              key={task.id}
              className="time-block time-block--linked"
              style={{ top, height, left: `${leftPct}%`, width: `calc(${widthPct}% - 3px)` }}
              onClick={e => { e.stopPropagation(); onOpenLinked(task) }}
              role="button"
              title={`${task.due_time.slice(0, 5)}–${task._end.slice(0, 5)} · ${task.title}${task._badge ? ` · ${task._badge}` : ''}`}
            >
              <span className="time-block-body">
                <span className="time-block-time">{task.due_time.slice(0, 5)}</span>
                <span className="time-block-title">{task.title}</span>
                {task._badge && <span className="calendar-badge">{task._badge}</span>}
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
              {task._badge && <span className="calendar-badge">{task._badge}</span>}
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
      <Field label="Título" style={{ flex: 1, minWidth: 160 }}>
        <input
          type="text" autoFocus placeholder="Título del evento..." className="quick-add-title"
          value={title} onChange={e => setTitle(e.target.value)}
        />
      </Field>
      <Field label="Fecha">
        <input type="date" value={date} onChange={e => setDate(e.target.value)} />
      </Field>
      <Field label="Desde">
        <input type="time" value={start} onChange={e => { setStart(e.target.value); setEnd(addMinutesToTime(e.target.value, 30)) }} />
      </Field>
      <Field label="Hasta">
        <input type="time" value={end} onChange={e => setEnd(e.target.value)} />
      </Field>
      <button type="submit" className="time-add-ok">Agregar</button>
      <button type="button" className="quick-add-cancel" onClick={onClose}>✕</button>
    </form>
  )
}

function DayView({ tasks, canEdit, onAdd, onMove, onDelete, onOpenLinked, selectedDate, onChangeDate }) {
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

      <AllDayRow dates={[selectedDate]} tasks={tasks} canEdit={canEdit} onAdd={onAdd} onDelete={onDelete} onMove={onMove} onOpenLinked={onOpenLinked} />

      <div className="time-grid-scroll" ref={scrollRef}>
        <div className="time-grid-inner">
          <HourGutter />
          <TimeColumn date={selectedDate} tasks={tasks} canEdit={canEdit} onAdd={onAdd} onMove={onMove} onDelete={onDelete} onOpenLinked={onOpenLinked} />
        </div>
      </div>
    </div>
  )
}

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function WeekView({ tasks, canEdit, onAdd, onMove, onDelete, onOpenLinked, selectedDate, onChangeDate }) {
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

      {/* En mobile, 7 columnas + gutter no entran en el ancho de la
          pantalla sin quedar ilegibles (nada de texto/hora visible) —
          .week-hscroll fuerza un ancho mínimo y scrollea horizontal en
          vez de achicar cada columna, mismo patrón que cualquier
          calendario semanal real en el celular. En desktop no hace nada
          (el contenido ya entra). Todo adentro (headers, sin horario,
          grilla horaria) comparte el mismo scroll para que las columnas
          queden alineadas entre sí. */}
      <div className="week-hscroll">
        <div className="week-hscroll-inner">
          <div className="week-day-headers" style={{ gridTemplateColumns: `70px repeat(7, 1fr)` }}>
            <span />
            {days.map((d, i) => (
              <div key={i} className={`week-day-header ${toDateStr(d) === todayStr ? 'today' : ''}`}>
                {WEEKDAY_LABELS[i]} <strong>{d.getDate()}</strong>
              </div>
            ))}
          </div>

          <AllDayRow dates={days} tasks={tasks} canEdit={canEdit} onAdd={onAdd} onDelete={onDelete} onMove={onMove} onOpenLinked={onOpenLinked} />

          <div className="time-grid-scroll" ref={scrollRef}>
            <div className="time-grid-inner">
              <HourGutter />
              <div className="time-grid-week-cols">
                {days.map((d, i) => (
                  <TimeColumn key={i} date={d} tasks={tasks} canEdit={canEdit} onAdd={onAdd} onMove={onMove} onDelete={onDelete} onOpenLinked={onOpenLinked} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
