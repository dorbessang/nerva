// TeamCalendar.jsx — Calendario grupal del workspace: todas las tareas con
// fecha (sueltas, de proyecto o de entidad) de todo el equipo, no solo las
// mías. Reusa el mismo motor de Día/Semana/Mes que la Agenda personal
// (CalendarEngine.jsx) — la diferencia es el alcance de los datos y que acá
// la mayoría de las tareas son de otra persona o cuelgan de un
// proyecto/entidad, así que se muestran "linked" (badge + click al origen,
// no editables inline) salvo las mías sueltas, igual criterio que ya usa
// la Agenda con las tareas de otros workspaces.
//
// Visibilidad: viewer ve solo lo suyo (mismo criterio que Tasks.jsx); el
// resto de los roles ve todo el workspace, con un filtro opcional por
// persona para no saturarse en equipos grandes.

import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { CalendarView, addMinutesToTime } from '../components/CalendarEngine'
import { taskDeepLink } from '../lib/tasks'
import { canEditContent } from '../lib/roles'
import './TeamCalendar.css'

// Mismo criterio de color pseudo-random por id que ya usan los post-its
// (NotesPostIts.jsx) — determinista, sin tabla de colores por usuario.
const MEMBER_COLORS = [
  { fg: '#7c3aed', bg: '#f3e8ff' }, // violeta
  { fg: '#0891b2', bg: '#e0f7fa' }, // cian
  { fg: '#c2410c', bg: '#ffedd5' }, // naranja
  { fg: '#15803d', bg: '#dcfce7' }, // verde
  { fg: '#be185d', bg: '#fce7f3' }, // rosa
  { fg: '#a16207', bg: '#fef9c3' }, // amarillo oscuro
]

function colorForUser(userId) {
  if (!userId) return MEMBER_COLORS[0]
  const hash = userId.charCodeAt(0) + (userId.charCodeAt(4) || 0)
  return MEMBER_COLORS[hash % MEMBER_COLORS.length]
}

export default function TeamCalendar() {
  const { user, workspaceId, effectiveRole } = useAuth()
  const navigate = useNavigate()
  const canSeeEveryone = effectiveRole !== 'viewer'
  const canEdit = canEditContent(effectiveRole)

  const [tasks, setTasks] = useState([])
  const [members, setMembers] = useState([])
  const [hiddenMemberIds, setHiddenMemberIds] = useState(new Set())
  const [loading, setLoading] = useState(true)

  async function fetchMembers() {
    const { data } = await supabase
      .from('workspace_members')
      .select('user_id, profile:user_id ( full_name )')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
    setMembers((data || []).map(m => ({ id: m.user_id, name: m.profile?.full_name || 'Sin nombre' })))
  }

  async function fetchTasks() {
    setLoading(true)
    let query = supabase.from('tasks')
      .select(`
        id, title, status, due_date, due_time, due_time_end, assigned_to, negotiation_id, entity_id,
        profile:assigned_to ( full_name ),
        negotiation:negotiation_id ( id, title ),
        entity:entity_id ( id, name, entity_type_id )
      `)
      .eq('workspace_id', workspaceId)
      .not('due_date', 'is', null)

    // Viewer solo ve sus propias tareas — mismo criterio que Tasks.jsx
    if (!canSeeEveryone) query = query.eq('assigned_to', user?.id)

    const { data, error } = await query
    if (error) { console.error('fetchTasks (calendario) error:', error.message); setLoading(false); return }

    setTasks((data || []).map(t => {
      const loose = !t.negotiation_id && !t.entity_id
      const isMine = t.assigned_to === user?.id
      const assigneeName = t.profile?.full_name || (t.assigned_to ? 'Sin nombre' : 'Sin asignar')
      // Editable inline solo lo mío y suelto — todo lo demás (de otra
      // persona, o colgado de un proyecto/entidad aunque sea mío) se abre
      // en su origen, igual que ya hace la Agenda con tareas externas.
      const linked = !(loose && isMine)
      const badge = linked
        ? (t.negotiation?.title || t.entity?.name || assigneeName)
        : null
      return { ...t, _linked: linked, _badge: badge }
    }))
    setLoading(false)
  }

  useEffect(() => { if (workspaceId) fetchMembers() }, [workspaceId])
  useEffect(() => { if (workspaceId) fetchTasks() }, [workspaceId, effectiveRole])

  const visibleTasks = useMemo(
    () => tasks.filter(t => !t.assigned_to || !hiddenMemberIds.has(t.assigned_to)),
    [tasks, hiddenMemberIds]
  )

  function toggleMember(id) {
    setHiddenMemberIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
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
    }).select('id, title, status, due_date, due_time, due_time_end, assigned_to, negotiation_id, entity_id').single()
    if (error) { console.error('addTask (calendario) error:', error.message); return }
    if (data) setTasks(prev => [...prev, { ...data, _linked: false, _badge: null }])
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

  function openLinkedTask(task) {
    navigate(taskDeepLink(task))
  }

  return (
    <div className="team-calendar-container">
      <div className="team-calendar-header">
        <h1 className="team-calendar-title">Calendario</h1>
        {canSeeEveryone && members.length > 1 && (
          <div className="team-calendar-legend">
            {members.map(m => {
              const color = colorForUser(m.id)
              const hidden = hiddenMemberIds.has(m.id)
              return (
                <button
                  key={m.id}
                  className={`team-calendar-member ${hidden ? 'is-hidden' : ''}`}
                  style={{ '--member-fg': color.fg, '--member-bg': color.bg }}
                  onClick={() => toggleMember(m.id)}
                  title={hidden ? `Mostrar tareas de ${m.name}` : `Ocultar tareas de ${m.name}`}
                >
                  <span className="team-calendar-member-dot" />
                  {m.name}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {!canSeeEveryone && (
        <p className="team-calendar-viewer-note">Estás viendo solo tus propias tareas.</p>
      )}

      {loading ? (
        <div className="team-calendar-loading">Cargando...</div>
      ) : (
        <CalendarView
          tasks={visibleTasks}
          canEdit={canEdit}
          onAdd={handleAdd}
          onMove={handleMove}
          onDelete={handleDelete}
          onOpenLinked={openLinkedTask}
        />
      )}
    </div>
  )
}
