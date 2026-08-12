import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { timeAgo } from '../lib/timeAgo'
import './NotificationBell.css'

export default function NotificationBell() {
  const { user, workspaceId } = useAuth()
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState([])
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (user && workspaceId) fetchNotifications()
  }, [user, workspaceId])

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function fetchNotifications() {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(20)
    if (data) setNotifications(data)
  }

  async function handleToggleOpen() {
    const next = !open
    setOpen(next)
    if (next) fetchNotifications()
  }

  async function dismiss(id) {
    setNotifications(prev => prev.filter(n => n.id !== id))
    await supabase.from('notifications').delete().eq('id', id)
  }

  async function dismissAll() {
    const ids = notifications.map(n => n.id)
    if (ids.length === 0) return
    setNotifications([])
    await supabase.from('notifications').delete().in('id', ids)
  }

  async function handleNotifClick(n) {
    dismiss(n.id)
    setOpen(false)

    if (n.task_id) {
      const { data: task } = await supabase
        .from('tasks')
        .select('negotiation_id')
        .eq('id', n.task_id)
        .maybeSingle()

      if (task?.negotiation_id) {
        navigate(`/negotiations?openNeg=${task.negotiation_id}&openTask=${n.task_id}`)
      } else {
        navigate(`/tasks?openTask=${n.task_id}`)
      }
      return
    }

    if (n.negotiation_id) {
      navigate(`/negotiations?openNeg=${n.negotiation_id}`)
      return
    }

    if (n.entity_id) {
      const { data: entity } = await supabase
        .from('entities')
        .select('entity_type_id')
        .eq('id', n.entity_id)
        .maybeSingle()

      if (entity?.entity_type_id) {
        navigate(`/entities/${entity.entity_type_id}?openEntity=${n.entity_id}`)
      }
    }
  }

  const unreadCount = notifications.length

  return (
    <div className="notif-bell-wrap" ref={ref}>
      <button className="notif-bell-btn" onClick={handleToggleOpen} title="Notificaciones">
        🔔
        {unreadCount > 0 && <span className="notif-bell-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-dropdown">
          <div className="notif-dropdown-header">
            <span>Notificaciones</span>
            {notifications.length > 0 && (
              <button className="notif-mark-all" onClick={dismissAll}>Borrar todas</button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="notif-empty">Sin notificaciones por ahora.</p>
          ) : (
            <div className="notif-list">
              {notifications.map(n => (
                <div
                  key={n.id}
                  className="notif-item notif-item--unread"
                  onClick={() => handleNotifClick(n)}
                >
                  <p className="notif-item-title">{n.title}</p>
                  {n.body && <p className="notif-item-body">{n.body}</p>}
                  <p className="notif-item-time">{timeAgo(n.created_at)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
