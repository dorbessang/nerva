import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { signOut } from "../lib/auth";
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import * as LucideIcons from "lucide-react";
import RoleImpersonator from "./RoleImpersonator";
import NotificationBell from "./NotificationBell";
import GlobalSearch from "./GlobalSearch";
import WelcomeSetup from "../pages/WelcomeSetup";
import "./Layout.css";

function EntityIcon({ name, size = 18 }) {
  const Icon = LucideIcons[name]
  return Icon ? <Icon size={size} /> : null
}

function useIsMobile(breakpoint = 860) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= breakpoint
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return isMobile;
}

export default function Layout({ children }) {
  const { user, profile, workspaces, workspaceId, activeWorkspace, setActiveWorkspace } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [entityTypes, setEntityTypes] = useState([]);
  const [productTypes, setProductTypes] = useState([]);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);
  const wsDropdownRef = useRef(null);
  const [alertProjects, setAlertProjects] = useState([]);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const isPersonalWorkspace = activeWorkspace?.type === 'personal';
  const needsOnboarding = activeWorkspace && activeWorkspace.type !== 'personal' && activeWorkspace.onboarded === false;
  const showWelcome = needsOnboarding && activeWorkspace.role === 'owner';

  useEffect(() => {
    fetchEntityTypes();
    fetchProductTypes();
  }, [workspaceId, location.pathname]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (workspaceId) fetchAlertProjects();
  }, [workspaceId]);

  async function fetchAlertProjects() {
    const day90ago = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const day120ago = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('negotiations')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('activity_status', 'active')
      .neq('status', 'Completado')
      .lt('last_activity_at', day90ago)
      .gte('last_activity_at', day120ago);
    setAlertProjects(data || []);
    setBannerDismissed(false);
  }

  // Cerrar dropdown al hacer click afuera
  useEffect(() => {
    function handleClickOutside(e) {
      if (wsDropdownRef.current && !wsDropdownRef.current.contains(e.target)) {
        setWsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function fetchEntityTypes() {
    if (!workspaceId || isPersonalWorkspace) { setEntityTypes([]); return; }
    const { data } = await supabase
      .from("entity_types")
      .select("id, name, icon, plural")
      .eq("workspace_id", workspaceId)
      .order("sort_order");
    if (data) setEntityTypes(data);
  }

  async function fetchProductTypes() {
    if (!workspaceId || isPersonalWorkspace) { setProductTypes([]); return; }
    const { data } = await supabase
      .from("product_types")
      .select("id, name, icon, plural")
      .eq("workspace_id", workspaceId)
      .order("sort_order");
    if (data) setProductTypes(data);
  }

  async function handleSignOut() {
    await signOut();
    navigate("/login");
  }

  const staticNavItems = [
    {
      path: "/dashboard",
      label: "Dashboard",
      icon: <LucideIcons.LayoutDashboard size={18} />,
    },
    ...(isPersonalWorkspace ? [
      {
        path: "/agenda",
        label: "Agenda",
        icon: <LucideIcons.Calendar size={18} />,
      },
    ] : [
      {
        path: "/tasks",
        label: "Tareas",
        icon: <LucideIcons.ListTodo size={18} />,
      },
      {
        path: "/negotiations",
        label: "Proyectos",
        icon: <LucideIcons.Handshake size={18} />,
      },
    ]),
  ];

  const sidebarWidth = isMobile ? 0 : collapsed ? 64 : 220;
  const asideWidth = isMobile ? 220 : sidebarWidth;
  const showLabels = isMobile || !collapsed;

  return (
    <div className="layout-container">
      <header className="nerva-header">
        <button
          className="mobile-nav-toggle"
          onClick={() => setMobileNavOpen((o) => !o)}
          aria-label="Abrir menú"
        >
          <LucideIcons.Menu size={20} />
        </button>

        <div className="nerva-header-logo">
          <img src="/favicon.png" width="20" height="20" alt="" />
          <span className="nerva-header-title">NERVA</span>
        </div>

        {/* Workspace switcher — en el flujo normal del header, al lado del logo */}
        {workspaces.length > 0 && (
          <div
            className="ws-switcher ws-switcher--header"
            ref={wsDropdownRef}
          >
            <button
              className="ws-switcher-btn"
              onClick={() => setWsDropdownOpen(o => !o)}
            >
              <span className="ws-switcher-name">{activeWorkspace?.name ?? '—'}</span>
              <LucideIcons.ChevronDown size={12} />
            </button>
            {wsDropdownOpen && (
              <div className="ws-dropdown">
                {workspaces.map(ws => (
                  <button
                    key={ws.id}
                    className={`ws-dropdown-item ${ws.id === workspaceId ? 'active' : ''}`}
                    onClick={() => { setActiveWorkspace(ws.id); setWsDropdownOpen(false); navigate('/dashboard'); }}
                  >
                    <span className="ws-dropdown-name">{ws.name}</span>
                    <span className="ws-dropdown-type">{ws.type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <GlobalSearch />

        <div className="nerva-header-right">
          <div className="nerva-status-dot" />
          <span className="nerva-status-text">en línea</span>
          <span className="nerva-header-divider">·</span>
          <NotificationBell />
          <button className="nerva-header-user" onClick={() => navigate('/profile')}>
            {profile?.full_name || user?.email}
          </button>
          <button onClick={handleSignOut} className="nerva-header-signout">
            Cerrar sesión
          </button>
        </div>
      </header>

      {/* Banner global de alerta — proyectos con 90-120 días sin actividad */}
      {alertProjects.length > 0 && !bannerDismissed && (
        <div className="layout-alert-banner">
          <span className="layout-alert-icon">⚠️</span>
          <span className="layout-alert-text">
            <strong>{alertProjects.length} {alertProjects.length === 1 ? 'proyecto lleva' : 'proyectos llevan'} más de 3 meses sin actividad.</strong>
            {' '}¿Querés revisarlos?
          </span>
          <button
            className="layout-alert-cta"
            onClick={() => navigate('/negotiations?filter=low_activity')}
          >
            Ver proyectos
          </button>
          <button className="layout-alert-close" onClick={() => setBannerDismissed(true)}>✕</button>
        </div>
      )}

      <div className="layout-body">
        {showWelcome ? (
          <main className="layout-main" style={{ marginLeft: 0, width: "100%" }}>
            <WelcomeSetup workspace={activeWorkspace} />
          </main>
        ) : (
        <>
        {isMobile && mobileNavOpen && (
          <div
            className="sidebar-backdrop"
            onClick={() => setMobileNavOpen(false)}
          />
        )}

        <aside
          className={`sidebar ${collapsed && !isMobile ? "collapsed" : ""} ${isMobile ? "sidebar--mobile" : ""} ${isMobile && mobileNavOpen ? "sidebar--mobile-open" : ""}`}
          style={{ width: asideWidth }}
        >
          <div className="sidebar-logo">
            {isMobile ? (
              <button
                className="collapse-btn"
                onClick={() => setMobileNavOpen(false)}
                title="Cerrar"
              >
                ✕
              </button>
            ) : (
              <button
                className="collapse-btn"
                onClick={() => setCollapsed((c) => !c)}
                title={collapsed ? "Expandir" : "Colapsar"}
              >
                {collapsed ? <LucideIcons.ChevronRight size={16} /> : <LucideIcons.ChevronLeft size={16} />}
              </button>
            )}
          </div>

          <nav className="sidebar-nav">
            {staticNavItems.map((item) => (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`nav-item ${location.pathname === item.path ? "active" : ""}`}
                title={showLabels ? "" : item.label}
              >
                <span className="nav-icon">{item.icon}</span>
                {showLabels && <span className="nav-label">{item.label}</span>}
              </button>
            ))}

            {entityTypes.length > 0 && <div className="nav-divider" />}

            {entityTypes.map((et) => (
              <button
                key={et.id}
                onClick={() => navigate(`/entities/${et.id}`)}
                className={`nav-item ${location.pathname === `/entities/${et.id}` ? "active" : ""}`}
                title={showLabels ? "" : et.name}
              >
                <span className="nav-icon">
                  {et.icon
                    ? <EntityIcon name={et.icon} size={18} />
                    : <LucideIcons.Users size={18} />
                  }
                </span>
                {showLabels && (
                  <span className="nav-label">
                    {et.plural || (et.name.endsWith('s') ? et.name : et.name.endsWith('r') ? et.name + 'es' : et.name + 's')}
                  </span>
                )}
              </button>
            ))}

            {productTypes.length > 0 && (
              <>
                <div className="nav-divider" />
                <button
                  onClick={() => navigate("/products")}
                  className={`nav-item ${location.pathname === "/products" ? "active" : ""}`}
                  title={showLabels ? "" : "Productos"}
                >
                  <span className="nav-icon"><LucideIcons.Package size={18} /></span>
                  {showLabels && <span className="nav-label">Productos</span>}
                </button>
              </>
            )}
          </nav>

          <div className="sidebar-bottom">
            <button
              onClick={() => navigate("/profile")}
              className={`nav-item ${location.pathname === "/profile" ? "active" : ""}`}
              title={showLabels ? "" : "Mi perfil"}
            >
              <span className="nav-icon"><LucideIcons.User size={18} /></span>
              {showLabels && <span className="nav-label">Mi perfil</span>}
            </button>
            <button
              onClick={() => navigate("/settings")}
              className={`nav-item ${location.pathname === "/settings" ? "active" : ""}`}
              title={showLabels ? "" : "Configuración"}
            >
              <span className="nav-icon">
                <LucideIcons.Settings size={18} />
              </span>
              {showLabels && <span className="nav-label">Configuración</span>}
            </button>
          </div>
        </aside>

        <main
          className="layout-main"
          style={
            isMobile
              ? { marginLeft: 0, width: "100%" }
              : { marginLeft: sidebarWidth, width: `calc(100% - ${sidebarWidth}px)` }
          }
        >
          {children}
        </main>
        </>
        )}
      </div>
      <RoleImpersonator />
    </div>
  );
}
