import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { signOut } from "../lib/auth";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import "./Layout.css";

export default function Layout({ children }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [entityTypes, setEntityTypes] = useState([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetchEntityTypes();
  }, []);

  async function fetchEntityTypes() {
    const { data } = await supabase
      .from("entity_types")
      .select("id, name, icon")
      .order("sort_order");
    if (data) setEntityTypes(data);
  }

  async function handleSignOut() {
    await signOut();
    navigate("/login");
  }

  const staticNavItems = [
    {
      path: "/dashboard",
      label: "Dashboard",
      icon: (
        // 4 rectángulos en grilla 2x2 simulando widgets de dashboard
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="2" width="6" height="7" rx="1" />
          <rect x="10" y="2" width="6" height="4" rx="1" />
          <rect x="10" y="8" width="6" height="8" rx="1" />
          <rect x="2" y="11" width="6" height="5" rx="1" />
        </svg>
      ),
    },
    {
      path: "/tasks",
      label: "Tareas",
      icon: (
        // 3 filas con cuadrado a la izquierda y línea a la derecha
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="3" width="3" height="3" rx="0.5" />
          <line x1="8" y1="4.5" x2="16" y2="4.5" />
          <rect x="2" y="8" width="3" height="3" rx="0.5" />
          <line x1="8" y1="9.5" x2="16" y2="9.5" />
          <rect x="2" y="13" width="3" height="3" rx="0.5" />
          <line x1="8" y1="14.5" x2="16" y2="14.5" />
        </svg>
      ),
    },
    {
      path: "/negotiations",
      label: "Proyectos",
      icon: (
        // Triángulo apuntando arriba con dos líneas cortas abajo como propulsores
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="9,2 13,10 5,10" />
          <line x1="9" y1="10" x2="9" y2="14" />
          <line x1="6" y1="13" x2="7.5" y2="16" />
          <line x1="12" y1="13" x2="10.5" y2="16" />
        </svg>
      ),
    },
  ];

  const sidebarWidth = collapsed ? 64 : 220;

  return (
    <div className="layout-container">
      <header className="nerva-header">
        <div className="nerva-header-logo">
          <svg width="20" height="20" viewBox="0 0 14 14" fill="none">
            <path
              d="M2 12L7 2L12 12"
              stroke="white"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M4 8.5H10"
              stroke="white"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
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
          className={`sidebar ${collapsed ? "collapsed" : ""}`}
          style={{ width: sidebarWidth }}
        >
          <div className="sidebar-logo">
            <button
              className="collapse-btn"
              onClick={() => setCollapsed((c) => !c)}
              title={collapsed ? "Expandir" : "Colapsar"}
            >
              {collapsed ? "→" : "←"}
            </button>
          </div>

          <nav className="sidebar-nav">
            {staticNavItems.map((item) => (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`nav-item ${location.pathname === item.path ? "active" : ""}`}
                title={collapsed ? item.label : ""}
              >
                <span className="nav-icon">{item.icon}</span>
                {!collapsed && <span className="nav-label">{item.label}</span>}
              </button>
            ))}

            {entityTypes.length > 0 && <div className="nav-divider" />}

            {entityTypes.map((et) => (
              <button
                key={et.id}
                onClick={() => navigate(`/entities/${et.id}`)}
                className={`nav-item ${location.pathname === `/entities/${et.id}` ? "active" : ""}`}
                title={collapsed ? et.name + "es" : ""}
              >
                <span className="nav-icon">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 18 18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="6" cy="5" r="2.5" />
                    <path d="M2 16v-2a3 3 0 013-3h2a3 3 0 013 3v2" />
                    <circle cx="13" cy="5" r="2.5" />
                    <path d="M10 16v-2a3 3 0 013-3h2a3 3 0 013 3v2" />
                  </svg>
                </span>
                {!collapsed && (
                  <span className="nav-label">
                    {et.name.endsWith("r") ? et.name + "es" : et.name + "s"}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="sidebar-bottom">
            <button
              onClick={() => navigate("/settings")}
              className={`nav-item ${location.pathname === "/settings" ? "active" : ""}`}
              title={collapsed ? "Configuración" : ""}
            >
              <span className="nav-icon">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 18 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="8.5" cy="8.5" r="2.5" />
                  <path
                    d="
    M7.2 1.5 L7.2 3.2
    Q6.4 3.5 5.7 4.0
    L4.2 3.0 L3.0 4.2 L4.0 5.7
    Q3.5 6.4 3.2 7.2
    L1.5 7.2 L1.5 9.8 L3.2 9.8
    Q3.5 10.6 4.0 11.3
    L3.0 12.8 L4.2 14.0 L5.7 13.0
    Q6.4 13.5 7.2 13.8
    L7.2 15.5 L9.8 15.5 L9.8 13.8
    Q10.6 13.5 11.3 13.0
    L12.8 14.0 L14.0 12.8 L13.0 11.3
    Q13.5 10.6 13.8 9.8
    L15.5 9.8 L15.5 7.2 L13.8 7.2
    Q13.5 6.4 13.0 5.7
    L14.0 4.2 L12.8 3.0 L11.3 4.0
    Q10.6 3.5 9.8 3.2
    L9.8 1.5 Z
  "
                  />
                </svg>
              </span>
              {!collapsed && <span className="nav-label">Configuración</span>}
            </button>
          </div>
        </aside>

        <main
          className="layout-main"
          style={{
            marginLeft: sidebarWidth,
            width: `calc(100% - ${sidebarWidth}px)`,
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
