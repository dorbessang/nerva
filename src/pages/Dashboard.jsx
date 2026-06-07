import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useNavigate } from 'react-router-dom'
import './Dashboard.css'

const WORKSPACE_ID = 'aaaaaaaa-0000-0000-0000-000000000001'

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ totalProjects: 0, pendingTasks: 0, overdueTasks: 0, activeEntities: 0 })
  const [stateCounts, setStateCounts] = useState([])
  const [myTasks, setMyTasks] = useState([])
  const [recentActivity, setRecentActivity] = useState([])
  const [chartView, setChartView] = useState('bars')

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]

    const [negsRes, tasksRes, entitiesRes, statesRes, myTasksRes, recentRes] = await Promise.all([
      supabase.from('negotiations').select('id, status').eq('workspace_id', WORKSPACE_ID),
      supabase.from('tasks').select('id, status, due_date').eq('workspace_id', WORKSPACE_ID),
      supabase.from('entities').select('id').eq('workspace_id', WORKSPACE_ID).eq('status', 'active'),
      supabase.from('custom_states').select('*').eq('object_type', 'negotiation').eq('workspace_id', WORKSPACE_ID).order('sort_order'),
      supabase.from('tasks').select(`
        id, title, status, due_date, priority,
        profile:assigned_to ( full_name ),
        negotiation:negotiation_id ( product, title )
      `)
      .eq('workspace_id', WORKSPACE_ID)
      .eq('assigned_to', user?.id)
      .in('status', ['pending', 'in_progress'])
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(5),
      supabase.from('negotiations').select(`
        id, product, title, status, updated_at,
        negotiation_entities ( entity:entity_id ( name, country_code ) )
      `)
      .eq('workspace_id', WORKSPACE_ID)
      .order('updated_at', { ascending: false })
      .limit(6),
    ])

    const negotiations = negsRes.data || []
    const tasks = tasksRes.data || []

    setStats({
      totalProjects: negotiations.length,
      pendingTasks: tasks.filter(t => t.status !== 'done').length,
      overdueTasks: tasks.filter(t => t.due_date && t.due_date < today && t.status !== 'done').length,
      activeEntities: entitiesRes.data?.length || 0,
    })

    const STATE_ORDER = ['Firmado', 'En Negociación', 'Derivado', 'Contactado', 'Descartado']
    setStateCounts(STATE_ORDER.map(name => {
      const found = statesRes.data?.find(s => s.name === name)
      return { name, color: found?.color || '#64748B', count: negotiations.filter(n => n.status === name).length, total: negotiations.length }
    }))

    setMyTasks(myTasksRes.data || [])

    const negIds = (recentRes.data || []).map(n => n.id)
    let negEntities = []
    if (negIds.length > 0) {
      const { data } = await supabase
        .from('negotiation_entities')
        .select('negotiation_id, entity:entity_id ( name, country_code )')
        .in('negotiation_id', negIds)
      negEntities = data || []
    }

    const recent = (recentRes.data || []).map(neg => ({
      ...neg,
      entities: negEntities.filter(ne => ne.negotiation_id === neg.id).map(ne => ne.entity).filter(Boolean)
    }))

    setRecentActivity(recent)
    setLoading(false)
  }

  function isOverdue(date) {
    if (!date) return false
    return date < new Date().toISOString().split('T')[0]
  }

  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `hace ${mins}m`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `hace ${hrs}h`
    const days = Math.floor(hrs / 24)
    if (days === 1) return 'ayer'
    return `hace ${days} días`
  }

  if (loading) return <div className="db-loading">Cargando...</div>

  return (
    <div className="db-container">
      <div className="db-header">
        <p className="db-date">
          {new Date().toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      <div className="db-metrics">
        <div className="db-metric-card">
          <p className="db-metric-label">Proyectos activos</p>
          <p className="db-metric-value">{stats.totalProjects}</p>
          <p className="db-metric-detail">{stateCounts.find(s => s.name === 'Firmado')?.count || 0} firmados</p>
        </div>
        <div className="db-metric-card">
          <p className="db-metric-label">Tareas pendientes</p>
          <p className="db-metric-value">{stats.pendingTasks}</p>
          <p className="db-metric-detail">en todo el workspace</p>
        </div>
        <div className="db-metric-card">
          <p className="db-metric-label">Tareas vencidas</p>
          <p className={`db-metric-value ${stats.overdueTasks > 0 ? 'danger' : ''}`}>{stats.overdueTasks}</p>
          <p className="db-metric-detail">{stats.overdueTasks > 0 ? 'Requieren atención' : 'Todo al día'}</p>
        </div>
        <div className="db-metric-card">
          <p className="db-metric-label">Proveedores activos</p>
          <p className="db-metric-value success">{stats.activeEntities}</p>
          <p className="db-metric-detail">en el workspace</p>
        </div>
      </div>

      <div className="db-grid2">
        <div className="db-section-card">
          <div className="db-section-header">
            <p className="db-section-title">Proyectos por estado</p>
            <div className="db-toggle">
              <button
                className={`db-toggle-btn ${chartView === 'bars' ? 'active' : ''}`}
                onClick={() => setChartView('bars')}
                title="Vista barras"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="1" y="8" width="3" height="5" fill="currentColor" rx="1"/>
                  <rect x="5.5" y="5" width="3" height="8" fill="currentColor" rx="1"/>
                  <rect x="10" y="2" width="3" height="11" fill="currentColor" rx="1"/>
                </svg>
              </button>
              <button
                className={`db-toggle-btn ${chartView === 'donut' ? 'active' : ''}`}
                onClick={() => setChartView('donut')}
                title="Vista donut"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="2.5" fill="none"/>
                  <circle cx="7" cy="7" r="2.5" fill="currentColor"/>
                </svg>
              </button>
            </div>
          </div>

          {chartView === 'bars' ? (
            <div>
              {stateCounts.map(s => (
                <div key={s.name} className="db-state-row" onClick={() => navigate('/negotiations')}>
                  <span className="db-state-label">{s.name}</span>
                  <div className="db-state-bar-bg">
                    <div className="db-state-bar-fill" style={{ width: s.total ? `${(s.count / s.total) * 100}%` : '0%', backgroundColor: s.color }} />
                  </div>
                  <span className="db-state-count">{s.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="db-donut-wrap">
              <div className="db-donut-chart">
                <DonutChart stateCounts={stateCounts} />
                <div className="db-donut-center">
                  <span className="db-donut-total">{stateCounts.reduce((a, s) => a + s.count, 0)}</span>
                  <span className="db-donut-label">total</span>
                </div>
              </div>
              <div className="db-donut-legend">
                {stateCounts.filter(s => s.count > 0).map(s => (
                  <div key={s.name} className="db-legend-item">
                    <div className="db-legend-dot" style={{ backgroundColor: s.color }} />
                    <span className="db-legend-name">{s.name}</span>
                    <span className="db-legend-count">{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="db-section-card">
          <p className="db-section-title">Mis tareas próximas</p>
          {myTasks.length === 0 ? (
            <p className="db-empty">Sin tareas asignadas.</p>
          ) : (
            myTasks.map(task => (
              <div key={task.id} className="db-task-row" onClick={() => navigate('/tasks')}>
                <div className="db-task-body">
                  <p className="db-task-title">
                    {task.profile && (
                      <span className="db-task-assignee">
                        @{task.profile.full_name.charAt(0).toUpperCase() + task.profile.full_name.slice(1)}:{' '}
                      </span>
                    )}
                    {task.title}
                  </p>
                  <p className="db-task-meta">{task.negotiation?.product || task.negotiation?.title || 'Sin proyecto'}</p>
                </div>
                <div className="db-task-right">
                  {(task.priority === 'high' || task.priority === 'urgent') && (
                    <span className={`db-task-priority priority-${task.priority}`}>
                      {task.priority === 'high' ? 'Alta' : 'Urgente'}
                    </span>
                  )}
                  {task.due_date && (
                    <span className={`db-task-date ${isOverdue(task.due_date) ? 'overdue' : ''}`}>
                      {isOverdue(task.due_date) ? 'Vencida' : new Date(task.due_date).toLocaleDateString('es-AR')}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="db-section-card" style={{ marginTop: 16 }}>
        <p className="db-section-title">Actividad reciente</p>
        <div className="db-recent-grid">
          {recentActivity.map(neg => {
            const cfg = stateCounts.find(s => s.name === neg.status)
            const entityNames = neg.entities?.map(e => e.name).join(', ') || '—'
            return (
              <div key={neg.id} className="db-recent-row" onClick={() => navigate('/negotiations')}>
                <div className="db-recent-dot" style={{ backgroundColor: cfg?.color || '#9ca3af' }} />
                <div className="db-recent-body">
                  <p className="db-recent-title">{neg.product || neg.title}</p>
                  <p className="db-recent-sub">{entityNames}</p>
                </div>
                <span className="db-recent-date">{timeAgo(neg.updated_at)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function DonutChart({ stateCounts }) {
  const total = stateCounts.reduce((a, s) => a + s.count, 0)
  if (total === 0) return <svg viewBox="0 0 120 120" width="120" height="120"><circle cx="60" cy="60" r="45" fill="none" stroke="#f3f4f6" strokeWidth="18"/></svg>

  const r = 45
  const circumference = 2 * Math.PI * r
  let offset = 0
  const slices = stateCounts.filter(s => s.count > 0).map(s => {
    const pct = s.count / total
    const slice = { ...s, pct, offset, dash: pct * circumference, gap: circumference }
    offset += pct * circumference
    return slice
  })

  return (
    <svg viewBox="0 0 120 120" width="120" height="120" style={{ transform: 'rotate(-90deg)' }}>
      <circle cx="60" cy="60" r={r} fill="none" stroke="#f3f4f6" strokeWidth="18"/>
      {slices.map(s => (
        <circle
          key={s.name}
          cx="60" cy="60" r={r}
          fill="none"
          stroke={s.color}
          strokeWidth="18"
          strokeDasharray={`${s.dash} ${s.gap}`}
          strokeDashoffset={-s.offset}
        />
      ))}
    </svg>
  )
}