// NextEventBadge.jsx — recordatorio fijo en el header con el próximo
// evento con fecha asignado al usuario, sin importar si es del workspace
// personal o de cualquier workspace de equipo (mismo criterio "global" que
// ya usa la Agenda para bajar a tierra lo asignado en todos lados). Muestra
// solo el siguiente, nunca una lista — a propósito, es un recordatorio, no
// un calendario chico.

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import * as LucideIcons from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { taskDeepLink } from '../lib/tasks'
import './NextEventBadge.css'

const REFRESH_MS = 60000

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// "Hoy · 10:30", "Mañana", "12/10 · 09:00" — sin hora, es un evento de
// todo el día (cuenta como "próximo" mientras sea hoy o después).
function formatWhen(task) {
  const today = new Date()
  const todayStr = toDateStr(today)
  const tomorrowStr = toDateStr(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1))
  let day
  if (task.due_date === todayStr) day = 'Hoy'
  else if (task.due_date === tomorrowStr) day = 'Mañana'
  else day = new Date(task.due_date + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
  return task.due_time ? `${day} · ${task.due_time.slice(0, 5)}` : day
}

export default function NextEventBadge() {
  const { user, workspaces, setActiveWorkspace } = useAuth()
  const navigate = useNavigate()
  const [nextTask, setNextTask] = useState(null)

  useEffect(() => {
    if (!user || workspaces.length === 0) return
    fetchNext()
    const interval = setInterval(fetchNext, REFRESH_MS)
    return () => clearInterval(interval)
  }, [user, workspaces])

  async function fetchNext() {
    const workspaceIds = workspaces.map(w => w.id)
    const { data, error } = await supabase.from('tasks')
      .select(`
        id, title, due_date, due_time, workspace_id, negotiation_id, entity_id,
        entity:entity_id ( entity_type_id )
      `)
      .in('workspace_id', workspaceIds)
      .eq('assigned_to', user.id)
      .neq('status', 'done')
      .not('due_date', 'is', null)
      .order('due_date', { ascending: true })
      .order('due_time', { ascending: true, nullsFirst: false })
      .limit(20)
    if (error) { console.error('NextEventBadge fetch error:', error.message); return }

    const now = new Date()
    const todayStr = toDateStr(now)
    const nowHM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const upcoming = (data || []).find(t => {
      if (t.due_date > todayStr) return true
      if (t.due_date < todayStr) return false
      return !t.due_time || t.due_time >= nowHM
    })
    setNextTask(upcoming || null)
  }

  function handleClick() {
    if (!nextTask) return
    setActiveWorkspace(nextTask.workspace_id)
    navigate(taskDeepLink(nextTask))
  }

  if (!nextTask) return null

  return (
    <button className="next-event-badge" onClick={handleClick} title="Tu próximo evento">
      <LucideIcons.Clock size={13} className="next-event-icon" />
      <span className="next-event-when">{formatWhen(nextTask)}</span>
      <span className="next-event-title">{nextTask.title}</span>
    </button>
  )
}
