import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { signOut } from "../lib/auth";
import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import * as LucideIcons from "lucide-react";
import RoleImpersonator from "./RoleImpersonator";
import NotificationBell from "./NotificationBell";
import NextEventBadge from "./NextEventBadge";
import Avatar from "./Avatar";
import GlobalSearch from "./GlobalSearch";
import WelcomeSetup from "../pages/WelcomeSetup";
import { isOwner } from "../lib/roles";
import { lowActivityWindow } from "../lib/lowActivity";
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
  const { user, profile, isStaff, workspaces, workspaceId, activeWorkspace, setActiveWorkspace } = useAuth();
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
  const [navFlyout, setNavFlyout] = useState(null);
  const [inactiveProjects, setInactiveProjects] = useState([]);
  const [inactiveBannerDismissed, setInactiveBannerDismissed] = useState(false);
  const [openTicketCount, setOpenTicketCount] = useState(0);
  const [ownerPendingCount, setOwnerPendingCount] = useState(0);

  const isPersonalWorkspace = activeWorkspace?.type === 'personal';
  const needsOnboarding = activeWorkspace && activeWorkspace.type !== 'personal' && activeWorkspace.onboarded === false;
  const showWelcome = needsOnboarding && isOwner(activeWorkspace.role);

  useEffect(() => {
    fetchEntityTypes();
    fetchProductTypes();
  }, [workspaceId, location.pathname]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (workspaceId) fetchLowActivityBanners();
  }, [workspaceId, activeWorkspace?.low_activity_alert_days, activeWorkspace?.low_activity_inactive_days]);

  // Burbuja de "tickets abiertos" para el staff, visible desde cualquier
  // pantalla (no solo dentro de Perfil → Staff) — se refresca cada 60s,
  // no hay infraestructura de realtime en la app todavía.
  useEffect(() => {
    if (!isStaff) return;
    fetchOpenTicketCount();
    const interval = setInterval(fetchOpenTicketCount, 60000);
    return () => clearInterval(interval);
  }, [isStaff]);

  async function fetchOpenTicketCount() {
    const { count } = await supabase
      .from('access_grants')
      .select('id', { count: 'exact', head: true })
      .eq('is_ticket', true)
      .eq('status', 'open');
    setOpenTicketCount(count || 0);
  }

  // Misma burbuja que la de tickets del staff, pero del lado del owner:
  // accesos de soporte esperando confirmación + solicitudes de staff
  // pendientes de aprobar, sumadas entre todos los workspaces donde soy
  // owner (no solo el activo).
  useEffect(() => {
    const ownerWsIds = workspaces.filter(w => w.role === 'owner').map(w => w.id);
    if (ownerWsIds.length === 0) { setOwnerPendingCount(0); return; }
    fetchOwnerPendingCount(ownerWsIds);
    const interval = setInterval(() => fetchOwnerPendingCount(ownerWsIds), 60000);
    return () => clearInterval(interval);
  }, [workspaces]);

  async function fetchOwnerPendingCount(ownerWsIds) {
    const [{ count: grantsCount }, { count: requestsCount }] = await Promise.all([
      supabase.from('access_grants').select('id', { count: 'exact', head: true }).eq('status', 'pending_confirmation').in('workspace_id', ownerWsIds),
      supabase.from('staff_action_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending').in('workspace_id', ownerWsIds),
    ]);
    setOwnerPendingCount((grantsCount || 0) + (requestsCount || 0));
  }

  // Trae los estados marcados "final" del workspace (is_terminal) y con eso
  // arma los dos banners — antes se excluía directo por SQL comparando
  // contra el texto fijo 'Completado', ahora ese nombre es libre de
  // cambiar por workspace.
  async function fetchLowActivityBanners() {
    const { data: states } = await supabase
      .from('custom_states')
      .select('name')
      .eq('workspace_id', workspaceId)
      .eq('object_type', 'negotiation')
      .eq('is_terminal', true);
    const terminalNames = new Set((states || []).map(s => s.name));

    const { since, until } = lowActivityWindow(
      new Date(),
      activeWorkspace?.low_activity_alert_days,
      activeWorkspace?.low_activity_inactive_days
    );
    const [{ data: alertData }, { data: inactiveData }] = await Promise.all([
      supabase
        .from('negotiations')
        .select('id, status')
        .eq('workspace_id', workspaceId)
        .eq('activity_status', 'active')
        .lt('last_activity_at', since)
        .gte('last_activity_at', until),
      // Proyectos que ya cruzaron el umbral de inactividad de verdad (el
      // cron los pasó a activity_status='inactive') — banner aparte del de
      // "baja actividad" de arriba, que es solo para los que todavía están
      // en la zona de alerta pero no se marcaron inactivos todavía.
      supabase
        .from('negotiations')
        .select('id, status')
        .eq('workspace_id', workspaceId)
        .eq('activity_status', 'inactive'),
    ]);

    setAlertProjects((alertData || []).filter(n => !terminalNames.has(n.status)));
    setBannerDismissed(false);
    setInactiveProjects((inactiveData || []).filter(n => !terminalNames.has(n.status)));
    setInactiveBannerDismissed(false);
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
        path: "/calendario",
        label: "Calendario",
        icon: <LucideIcons.Calendar size={18} />,
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

  function handleNavMouseEnter(e, label) {
    if (!collapsed || isMobile) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setNavFlyout({ label, top: rect.top + rect.height / 2 });
  }
  function handleNavMouseLeave() {
    setNavFlyout(null);
  }

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
          <NextEventBadge />
          <div className="nerva-status-dot" />
          <span className="nerva-status-text">en línea</span>
          <span className="nerva-header-divider">·</span>
          <NotificationBell />
          <button className="nerva-header-user" onClick={() => navigate('/profile')}>
            <Avatar profile={profile} size={22} />
            <span className="nerva-header-user-name">{profile?.full_name || user?.email}</span>
          </button>
          <button onClick={handleSignOut} className="nerva-header-signout">
            Cerrar sesión
          </button>
        </div>
      </header>

      {((alertProjects.length > 0 && !bannerDismissed) || (inactiveProjects.length > 0 && !inactiveBannerDismissed)) && (
        <div className="layout-alert-banners">
          {/* Zona de aviso — entre low_activity_alert_days y low_activity_inactive_days del workspace */}
          {alertProjects.length > 0 && !bannerDismissed && (
            <div className="layout-alert-banner">
              <span className="layout-alert-icon">⚠️</span>
              <span className="layout-alert-text">
                <strong>{alertProjects.length} {alertProjects.length === 1 ? 'proyecto lleva' : 'proyectos llevan'} más de {activeWorkspace?.low_activity_alert_days ?? 90} días sin actividad.</strong>
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

          {/* Proyectos que ya cruzaron el umbral y se marcaron 'inactive' de verdad (cron diario) */}
          {inactiveProjects.length > 0 && !inactiveBannerDismissed && (
            <div className="layout-alert-banner layout-alert-banner--inactive">
              <span className="layout-alert-icon">💤</span>
              <span className="layout-alert-text">
                <strong>{inactiveProjects.length} {inactiveProjects.length === 1 ? 'proyecto pasó' : 'proyectos pasaron'} a inactivo por falta de seguimiento.</strong>
                {' '}¿Querés revisarlos?
              </span>
              <button
                className="layout-alert-cta"
                onClick={() => navigate('/negotiations?filter=inactive')}
              >
                Ver proyectos
              </button>
              <button className="layout-alert-close" onClick={() => setInactiveBannerDismissed(true)}>✕</button>
            </div>
          )}
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
                onMouseEnter={(e) => handleNavMouseEnter(e, item.label)}
                onMouseLeave={handleNavMouseLeave}
              >
                <span className="nav-icon">{item.icon}</span>
                {showLabels && <span className="nav-label">{item.label}</span>}
              </button>
            ))}

            {entityTypes.length > 0 && (
              <>
                <div className="nav-divider" />
                <button
                  onClick={() => navigate("/entities")}
                  className={`nav-item ${location.pathname === "/entities" ? "active" : ""}`}
                  onMouseEnter={(e) => handleNavMouseEnter(e, "Todas las entidades")}
                  onMouseLeave={handleNavMouseLeave}
                >
                  <span className="nav-icon"><LucideIcons.Layers size={18} /></span>
                  {showLabels && <span className="nav-label">Todas las entidades</span>}
                </button>
              </>
            )}

            {entityTypes.map((et) => (
              <button
                key={et.id}
                onClick={() => navigate(`/entities/${et.id}`)}
                className={`nav-item ${location.pathname === `/entities/${et.id}` ? "active" : ""}`}
                onMouseEnter={(e) => handleNavMouseEnter(e, et.plural || (et.name.endsWith('s') ? et.name : et.name.endsWith('r') ? et.name + 'es' : et.name + 's'))}
                onMouseLeave={handleNavMouseLeave}
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
                  onMouseEnter={(e) => handleNavMouseEnter(e, "Productos")}
                  onMouseLeave={handleNavMouseLeave}
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
              onMouseEnter={(e) => handleNavMouseEnter(e, "Mi perfil")}
              onMouseLeave={handleNavMouseLeave}
            >
              <span className="nav-icon nav-icon--with-badge">
                <LucideIcons.User size={18} />
                {isStaff && openTicketCount > 0 && (
                  <span className="nav-item-badge">{openTicketCount > 9 ? '9+' : openTicketCount}</span>
                )}
              </span>
              {showLabels && <span className="nav-label">Mi perfil</span>}
            </button>
            <button
              onClick={() => navigate("/settings")}
              className={`nav-item ${location.pathname === "/settings" ? "active" : ""}`}
              onMouseEnter={(e) => handleNavMouseEnter(e, "Configuración")}
              onMouseLeave={handleNavMouseLeave}
            >
              <span className="nav-icon nav-icon--with-badge">
                <LucideIcons.Settings size={18} />
                {ownerPendingCount > 0 && (
                  <span className="nav-item-badge">{ownerPendingCount > 9 ? '9+' : ownerPendingCount}</span>
                )}
              </span>
              {showLabels && <span className="nav-label">Configuración</span>}
            </button>
          </div>
        </aside>

        {navFlyout && (
          <div className="nav-flyout" style={{ top: navFlyout.top, left: sidebarWidth + 8 }}>
            {navFlyout.label}
          </div>
        )}

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
