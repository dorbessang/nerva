import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import './NotificationBell.css'

export default function NotificationBell() {
  const { user, workspaceId } = useAuth()
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

  async function markRead(id) {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    await supabase.from('notifications').update({ read: true }).eq('id', id)
  }

  async function markAllRead() {
    const unreadIds = notifications.filter(n => !n.read).map(n => n.id)
    if (unreadIds.length === 0) return
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    await supabase.from('notifications').update({ read: true }).in('id', unreadIds)
  }

  const unreadCount = notifications.filter(n => !n.read).length

  function timeAgo(dateStr) {
    const diffMs = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diffMs / 60000)
    if (mins < 1) return 'ahora'
    if (mins < 60) return `hace ${mins}m`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `hace ${hours}h`
    return `hace ${Math.floor(hours / 24)}d`
  }

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
            {unreadCount > 0 && (
              <button className="notif-mark-all" onClick={markAllRead}>Marcar todas leídas</button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="notif-empty">Sin notificaciones por ahora.</p>
          ) : (
            <div className="notif-list">
              {notifications.map(n => (
                <div
                  key={n.id}
                  className={`notif-item ${n.read ? '' : 'notif-item--unread'}`}
                  onClick={() => !n.read && markRead(n.id)}
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
