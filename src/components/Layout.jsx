import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { signOut } from '../lib/auth'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import './Layout.css'

export default function Layout({ children }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [entityTypes, setEntityTypes] = useState([])
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => { fetchEntityTypes() }, [])

  async function fetchEntityTypes() {
    const { data } = await supabase
      .from('entity_types')
      .select('id, name, icon')
      .order('sort_order')
    if (data) setEntityTypes(data)
  }

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const staticNavItems = [
    { path: '/dashboard', label: 'Dashboard', icon: '⊞' },
    { path: '/tasks', label: 'Tareas', icon: '✓' },
    { path: '/negotiations', label: 'Proyectos', icon: '◎' },
  ]

  const sidebarWidth = collapsed ? 64 : 220

  return (
    <div className="layout-container">
      <header className="nerva-header">
        <div className="nerva-header-logo">
          <svg width="20" height="20" viewBox="0 0 14 14" fill="none">
            <path d="M2 12L7 2L12 12" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M4 8.5H10" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          <span className="nerva-header-title">NERVA</span>
        </div>
        <div className="nerva-header-right">
          <div className="nerva-status-dot" />
          <span className="nerva-status-text">en línea</span>
          <span className="nerva-header-divider">·</span>
          <span className="nerva-header-user">{user?.email}</span>
          <button onClick={handleSignOut} className="nerva-header-signout">
            Cerrar sesión
          </button>
        </div>
      </header>

      <div className="layout-body">
        <aside
          className={`sidebar ${collapsed ? 'collapsed' : ''}`}
          style={{ width: sidebarWidth }}
        >
          <div className="sidebar-logo">
            <button
              className="collapse-btn"
              onClick={() => setCollapsed(c => !c)}
              title={collapsed ? 'Expandir' : 'Colapsar'}
            >
              {collapsed ? '→' : '←'}
            </button>
          </div>

          <nav className="sidebar-nav">
            {staticNavItems.map(item => (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
                title={collapsed ? item.label : ''}
              >
                <span className="nav-icon">{item.icon}</span>
                {!collapsed && <span className="nav-label">{item.label}</span>}
              </button>
            ))}

            {entityTypes.length > 0 && <div className="nav-divider" />}

            {entityTypes.map(et => (
              <button
                key={et.id}
                onClick={() => navigate(`/entities/${et.id}`)}
                className={`nav-item ${location.pathname === `/entities/${et.id}` ? 'active' : ''}`}
                title={collapsed ? et.name + 'es' : ''}
              >
                <span className="nav-icon">⬡</span>
                {!collapsed && (
                  <span className="nav-label">
                    {et.name.endsWith('r') ? et.name + 'es' : et.name + 's'}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="sidebar-bottom">
            <button
              onClick={handleSignOut}
              className="signout-btn"
              title={collapsed ? 'Cerrar sesión' : ''}
              style={{ display: 'none' }}
            />
          </div>
        </aside>

        <main
          className="layout-main"
          style={{
            marginLeft: sidebarWidth,
            width: `calc(100% - ${sidebarWidth}px)`
          }}
        >
          {children}
        </main>
      </div>
    </div>
  )
}