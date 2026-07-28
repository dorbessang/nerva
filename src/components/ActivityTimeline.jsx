import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import './ActivityTimeline.css'

const TYPE_ICONS = {
  project_created: '📁',
  entity_created: '🏷️',
  note_added: '📝',
  task_created: '☑️',
  task_completed: '✅',
  status_changed: '🔄',
}

// Timeline cronológico de todo lo que pasó con un proyecto o con una
// entidad. Para una entidad, agrega también la actividad de todos los
// proyectos vinculados a ella (para que sea el verdadero hub).
export default function ActivityTimeline({ negotiationId, entityId, refreshKey }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchEvents() }, [negotiationId, entityId, refreshKey])

  async function fetchEvents() {
    setLoading(true)
    let query = supabase
      .from('activity_log')
      .select('*, actor:actor_id ( full_name )')
      .order('created_at', { ascending: false })
      .limit(50)

    if (negotiationId) {
      query = query.eq('negotiation_id', negotiationId)
    } else if (entityId) {
      const { data: links } = await supabase
        .from('negotiation_entities')
        .select('negotiation_id')
        .eq('entity_id', entityId)
      const negIds = [...new Set((links || []).map(l => l.negotiation_id))]
      const negFilter = negIds.length > 0 ? `,negotiation_id.in.(${negIds.join(',')})` : ''
      query = query.or(`entity_id.eq.${entityId}${negFilter}`)
    }

    const { data, error } = await query
    if (error) console.error('fetchEvents error:', error.message)
    setEvents(data || [])
    setLoading(false)
  }

  function timeAgo(dateStr) {
    const diffMs = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diffMs / 60000)
    if (mins < 1) return 'ahora'
    if (mins < 60) return `hace ${mins}m`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `hace ${hours}h`
    const days = Math.floor(hours / 24)
    if (days < 30) return `hace ${days}d`
    return new Date(dateStr).toLocaleDateString('es-AR')
  }

  if (loading) return <p className="detail-empty">Cargando actividad...</p>
  if (events.length === 0) return <p className="detail-empty">Sin actividad todavía.</p>

  return (
    <div className="activity-timeline">
      {events.map(ev => (
        <div key={ev.id} className="activity-item">
          <span className="activity-icon">{TYPE_ICONS[ev.type] || '•'}</span>
          <div className="activity-body">
            <span className="activity-title">{ev.title}</span>
            <span className="activity-meta">
              {ev.actor?.full_name ? `${ev.actor.full_name} · ` : ''}{timeAgo(ev.created_at)}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
