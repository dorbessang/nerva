// Dashboard.jsx — Página principal con métricas generales del workspace

import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { useNavigate } from "react-router-dom";
import "./Dashboard.css";

export default function Dashboard() {
  const { user, workspaceId } = useAuth()
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [chartView, setChartView] = useState("bars"); // 'bars' | 'donut'

  // Métricas generales del workspace
  const [stats, setStats] = useState({
    activeProjects: 0,
    completedProjects: 0,
    pausedProjects: 0,
    inactiveProjects: 0,
    pendingTasks: 0,
    tasksDueThisWeek: 0,
    overdueTasks: 0,
    activeEntities: 0,
  });

  // Proyectos en zona de alerta — se muestra en el banner global de Layout
  const [alertProjects, setAlertProjects] = useState([]);

  // Conteo de proyectos por estado para el gráfico
  const [stateCounts, setStateCounts] = useState([]);

  // Tareas asignadas al usuario logueado
  const [myTasks, setMyTasks] = useState([]);

  // Proyectos modificados recientemente
  const [recentActivity, setRecentActivity] = useState([]);

  // Valor de pipeline — suma de hitos de pago de proyectos en curso, agrupado por moneda
  const [pipelineValue, setPipelineValue] = useState([]);

  useEffect(() => {
    if (workspaceId) fetchAll();
  }, [workspaceId]);

  async function fetchAll() {
    setLoading(true);
    const today = new Date().toISOString().split("T")[0];

    // Traemos todos los datos en paralelo para mejor performance
    const [negsRes, tasksRes, entitiesRes, statesRes, myTasksRes, recentRes, milestonesRes] =
      await Promise.all([
        // Todos los proyectos del workspace (para métricas)
        supabase
          .from("negotiations")
          .select("id, status, activity_status, last_activity_at, currency")
          .eq("workspace_id", workspaceId),

        // Todas las tareas (para contar pendientes y vencidas)
        supabase
          .from("tasks")
          .select("id, status, due_date")
          .eq("workspace_id", workspaceId),

        // Entidades activas (proveedores, distribuidores, etc.)
        supabase
          .from("entities")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("status", "active"),

        // Estados personalizados de negociaciones (colores y nombres)
        supabase
          .from("custom_states")
          .select("*")
          .eq("object_type", "negotiation")
          .eq("workspace_id", workspaceId)
          .order("sort_order"),

        // Tareas asignadas al usuario logueado, ordenadas por fecha límite
        supabase
          .from("tasks")
          .select(
            `
        id, title, status, due_date, priority,
        profile:assigned_to ( full_name ),
        negotiation:negotiation_id ( product, title )
      `,
          )
          .eq("workspace_id", workspaceId)
          .eq("assigned_to", user?.id)
          .in("status", ["pending", "in_progress"])
          .order("due_date", { ascending: true, nullsFirst: false })
          .limit(5),

        // Proyectos más recientemente modificados (para actividad reciente)
        supabase
          .from("negotiations")
          .select(
            `
        id, product, title, status, updated_at, nda, description,
        negotiation_entities ( entity:entity_id ( name, country_code ) )
      `,
          )
          .eq("workspace_id", workspaceId)
          .order("updated_at", { ascending: false })
          .limit(6),

        // Hitos de pago de todos los proyectos (para valorizar el pipeline)
        supabase
          .from("deal_milestones")
          .select("negotiation_id, amount")
          .eq("workspace_id", workspaceId),
      ]);

    const negotiations = negsRes.data || [];
    const tasks = tasksRes.data || [];

    const now = new Date();
    const day90ago = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();
    const day120ago = new Date(now - 120 * 24 * 60 * 60 * 1000).toISOString();
    const endOfWeek = new Date();
    endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
    const endOfWeekStr = endOfWeek.toISOString().split("T")[0];

    // Proyectos en zona de alerta: activos, no completados, sin actividad entre 90 y 120 días
    const alert = negotiations.filter(n =>
      n.activity_status === 'active' &&
      n.status !== 'Completado' &&
      n.last_activity_at < day90ago &&
      n.last_activity_at >= day120ago
    );
    setAlertProjects(alert);

    setStats({
      activeProjects: negotiations.filter(n => n.activity_status === 'active' && n.status !== 'Completado').length,
      completedProjects: negotiations.filter(n => n.status === 'Completado').length,
      pausedProjects: negotiations.filter(n => n.activity_status === 'paused').length,
      inactiveProjects: negotiations.filter(n => n.activity_status === 'inactive').length,
      pendingTasks: tasks.filter((t) => t.status !== "done").length,
      tasksDueThisWeek: tasks.filter(
        (t) => t.due_date && t.due_date <= endOfWeekStr && t.due_date >= today && t.status !== "done",
      ).length,
      overdueTasks: tasks.filter(
        (t) => t.due_date && t.due_date < today && t.status !== "done",
      ).length,
      activeEntities: entitiesRes.data?.length || 0,
    });

    const activeNegs = negotiations.filter(n => n.activity_status === 'active' && n.status !== 'Completado');

    // Sumamos los hitos de pago de los proyectos en curso, agrupados por moneda
    // (sin conversión automática — cada moneda se muestra por separado)
    const activeNegIds = new Set(activeNegs.map(n => n.id));
    const currencyByNegId = Object.fromEntries(negotiations.map(n => [n.id, n.currency || 'USD']));
    const totalsByCurrency = {};
    for (const m of milestonesRes.data || []) {
      if (!activeNegIds.has(m.negotiation_id)) continue;
      const cur = currencyByNegId[m.negotiation_id] || 'USD';
      totalsByCurrency[cur] = (totalsByCurrency[cur] || 0) + Number(m.amount);
    }
    setPipelineValue(
      Object.entries(totalsByCurrency)
        .map(([currency, total]) => ({ currency, total }))
        .sort((a, b) => b.total - a.total)
    );
    const completedStateData = (statesRes.data || []).find(s => s.name === 'Completado');
    const completedNegCount = negotiations.filter(n => n.status === 'Completado').length;
    setStateCounts([
      ...(statesRes.data || [])
        .filter(s => s.name !== 'Completado')
        .map(s => ({
          name: s.name,
          color: s.color,
          count: activeNegs.filter(n => n.status === s.name).length,
          total: activeNegs.length,
        })),
      {
        name: 'Completado',
        color: completedStateData?.color || '#059669',
        count: completedNegCount,
        total: negotiations.length,
      },
    ]);

    setMyTasks(myTasksRes.data || []);

    // Para actividad reciente traemos las entidades por separado
    // (evitamos el problema de múltiples FKs en negotiation_entities)
    const negIds = (recentRes.data || []).map((n) => n.id);
    let negEntities = [];
    if (negIds.length > 0) {
      const { data } = await supabase
        .from("negotiation_entities")
        .select("negotiation_id, entity:entity_id ( name, country_code )")
        .in("negotiation_id", negIds);
      negEntities = data || [];
    }

    const recent = (recentRes.data || []).map((neg) => ({
      ...neg,
      entities: negEntities
        .filter((ne) => ne.negotiation_id === neg.id)
        .map((ne) => ne.entity)
        .filter(Boolean),
    }));

    setRecentActivity(recent);
    setLoading(false);
  }

  // Verifica si una fecha ya pasó (para marcar tareas como vencidas)
  function isOverdue(date) {
    if (!date) return false;
    return date < new Date().toISOString().split("T")[0];
  }

  // Convierte una fecha en texto relativo (hace 2h, ayer, etc.)
  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `hace ${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `hace ${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return "ayer";
    return `hace ${days} días`;
  }

  if (loading) return <div className="db-loading">Cargando...</div>;

  return (
    <div className="db-container">
      {/* Fecha actual */}
      <div className="db-header">
        <p className="db-date">
          {new Date()
            .toLocaleDateString("es-AR", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })
            .toLowerCase()
            .replace(/^\w/, (l) => l.toUpperCase())}
        </p>
      </div>

      {/* Cards de métricas */}
      <div className="db-metrics">
        <div className="db-metric-card">
          <p className="db-metric-label">Proyectos en curso</p>
          <p className="db-metric-value">{stats.activeProjects}</p>
          <p className="db-metric-detail">{stats.completedProjects} completados</p>
        </div>
        <div className="db-metric-card">
          <p className="db-metric-label">Tareas pendientes</p>
          <p className="db-metric-value">{stats.pendingTasks}</p>
          <p className="db-metric-detail">{stats.tasksDueThisWeek} con fecha esta semana</p>
        </div>
        <div className="db-metric-card">
          <p className="db-metric-label">Tareas vencidas</p>
          <p className={`db-metric-value ${stats.overdueTasks > 0 ? "danger" : ""}`}>
            {stats.overdueTasks}
          </p>
          <p className="db-metric-detail">
            {stats.overdueTasks > 0 ? "Requieren atención" : "Todo al día"}
          </p>
        </div>
        <div className="db-metric-card">
          <p className="db-metric-label">Entidades activas</p>
          <p className="db-metric-value success">{stats.activeEntities}</p>
          <p className="db-metric-detail">
            {stats.pausedProjects > 0 && `${stats.pausedProjects} proy. pausados`}
            {stats.pausedProjects === 0 && 'en el workspace'}
          </p>
        </div>
      </div>

      {/* Valor de pipeline — suma de hitos de pago de proyectos en curso */}
      <div className="db-section-card" style={{ marginBottom: 16 }}>
        <p className="db-section-title">Valor de pipeline (proyectos en curso)</p>
        {pipelineValue.length === 0 ? (
          <p className="db-empty">Sin hitos de pago cargados todavía.</p>
        ) : (
          <div className="db-pipeline-row">
            {pipelineValue.map((p) => (
              <div key={p.currency} className={`db-pipeline-chip ${p.total < 0 ? 'db-pipeline-chip--negative' : ''}`}>
                <span className="db-pipeline-amount">
                  {p.total.toLocaleString("es-AR", { maximumFractionDigits: 0 })}
                </span>
                <span className="db-pipeline-currency">{p.currency}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Grid de 2 columnas: gráfico de estados + mis tareas */}
      <div className="db-grid2">
        {/* Card izquierda: proyectos por estado con toggle barras/donut */}
        <div className="db-section-card">
          <div className="db-section-header">
            <p className="db-section-title">Proyectos por estado</p>

            {/* Toggle para cambiar entre vista de barras y donut */}
            <div className="db-toggle">
              <button
                className={`db-toggle-btn ${chartView === "bars" ? "active" : ""}`}
                onClick={() => setChartView("bars")}
                title="Vista barras"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect
                    x="1"
                    y="8"
                    width="3"
                    height="5"
                    fill="currentColor"
                    rx="1"
                  />
                  <rect
                    x="5.5"
                    y="5"
                    width="3"
                    height="8"
                    fill="currentColor"
                    rx="1"
                  />
                  <rect
                    x="10"
                    y="2"
                    width="3"
                    height="11"
                    fill="currentColor"
                    rx="1"
                  />
                </svg>
              </button>
              <button
                className={`db-toggle-btn ${chartView === "donut" ? "active" : ""}`}
                onClick={() => setChartView("donut")}
                title="Vista donut"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle
                    cx="7"
                    cy="7"
                    r="5.5"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    fill="none"
                  />
                  <circle cx="7" cy="7" r="2.5" fill="currentColor" />
                </svg>
              </button>
            </div>
          </div>

          {/* Contenedor del gráfico — ambas vistas siempre están en el DOM
              La vista de barras define la altura, el donut se posiciona encima
              Así el card nunca cambia de tamaño al switchear */}
          <div style={{ position: "relative" }}>
            {/* Vista barras — siempre en el DOM para definir la altura del contenedor */}
            <div
              style={{
                visibility: chartView === "bars" ? "visible" : "hidden",
              }}
            >
              {stateCounts.map((s) => (
                <div
                  key={s.name}
                  className="db-state-row"
                  onClick={() => navigate("/negotiations")}
                >
                  <span className="db-state-label">{s.name}</span>
                  <div className="db-state-bar-bg">
                    <div
                      className="db-state-bar-fill"
                      style={{
                        width: s.total ? `${(s.count / s.total) * 100}%` : "0%",
                        backgroundColor: s.color,
                      }}
                    />
                  </div>
                  <span className="db-state-count">{s.count}</span>
                </div>
              ))}
            </div>

            {/* Vista donut — posicionada en absolute sobre las barras */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                visibility: chartView === "donut" ? "visible" : "hidden",
              }}
            >
              <div className="db-donut-wrap">
                <div className="db-donut-chart">
                  <DonutChart stateCounts={stateCounts} />
                  <div className="db-donut-center">
                    <span className="db-donut-total">
                      {stateCounts.reduce((a, s) => a + s.count, 0)}
                    </span>
                    <span className="db-donut-label">total</span>
                  </div>
                </div>
                <div className="db-donut-legend">
                  {stateCounts
                    .filter((s) => s.count > 0)
                    .map((s) => (
                      <div key={s.name} className="db-legend-item">
                        <div
                          className="db-legend-dot"
                          style={{ backgroundColor: s.color }}
                        />
                        <span className="db-legend-name">{s.name}</span>
                        <span className="db-legend-count">{s.count}</span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Card derecha: mis tareas próximas */}
        <div className="db-section-card">
          <p className="db-section-title">Mis tareas próximas</p>
          {myTasks.length === 0 ? (
            <p className="db-empty">Sin tareas asignadas.</p>
          ) : (
            myTasks.map((task) => (
              <div
                key={task.id}
                className="db-task-row"
                onClick={() => navigate("/tasks")}
              >
                <div className="db-task-body">
                  <p className="db-task-title">
                    {task.profile && (
                      <span className="db-task-assignee">
                        @
                        {task.profile.full_name.charAt(0).toUpperCase() +
                          task.profile.full_name.slice(1)}
                        :{" "}
                      </span>
                    )}
                    {task.title}
                  </p>
                  <p className="db-task-meta">
                    {task.negotiation?.product ||
                      task.negotiation?.title ||
                      "Sin proyecto"}
                  </p>
                </div>
                <div className="db-task-right">
                  {(task.priority === "high" || task.priority === "urgent") && (
                    <span
                      className={`db-task-priority priority-${task.priority}`}
                    >
                      {task.priority === "high" ? "Alta" : "Urgente"}
                    </span>
                  )}
                  {task.due_date && (
                    <span
                      className={`db-task-date ${isOverdue(task.due_date) ? "overdue" : ""}`}
                    >
                      {isOverdue(task.due_date)
                        ? "Vencida"
                        : new Date(task.due_date).toLocaleDateString("es-AR")}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Actividad reciente — 6 proyectos más recientemente modificados */}
      <div className="db-section-card" style={{ marginTop: 16 }}>
        <p className="db-section-title">Actividad reciente</p>
        <div className="db-recent-grid">
          {recentActivity.map((neg) => {
            const cfg = stateCounts.find((s) => s.name === neg.status);
            const entityNames =
              neg.entities?.map((e) => e.name).join(", ") || "—";

            // Tooltip que aparece al hacer hover — muestra estado, NDA y descripción
            const tooltipText = [
              `Estado: ${neg.status || "—"}`,
              `NDA: ${neg.nda || "—"}`,
              neg.description ? `Descripción: ${neg.description}` : null,
            ]
              .filter(Boolean)
              .join("\n");

            return (
              <div
                key={neg.id}
                className="db-recent-row"
                onClick={() => navigate("/negotiations")}
                title={tooltipText}
              >
                <div
                  className="db-recent-dot"
                  style={{ backgroundColor: cfg?.color || "#9ca3af" }}
                />
                <div className="db-recent-body">
                  <p className="db-recent-title">{neg.product || neg.title}</p>
                  <p className="db-recent-sub">{entityNames}</p>
                </div>
                <span className="db-recent-date">
                  {timeAgo(neg.updated_at)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Componente del gráfico donut — dibuja un SVG con los estados de los proyectos
function DonutChart({ stateCounts }) {
  const total = stateCounts.reduce((a, s) => a + s.count, 0);

  if (total === 0)
    return (
      <svg viewBox="0 0 120 120" width="100%" height="100%">
        <circle
          cx="60"
          cy="60"
          r="45"
          fill="none"
          stroke="#f3f4f6"
          strokeWidth="18"
        />
      </svg>
    );

  const r = 45;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const slices = stateCounts
    .filter((s) => s.count > 0)
    .map((s) => {
      const pct = s.count / total;
      const slice = {
        ...s,
        pct,
        offset,
        dash: pct * circumference,
        gap: circumference,
      };
      offset += pct * circumference;
      return slice;
    });

  return (
    <svg
      viewBox="0 0 120 120"
      width="100%"
      height="100%"
      style={{ transform: "rotate(-90deg)" }}
    >
      <circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        stroke="#f3f4f6"
        strokeWidth="18"
      />
      {slices.map((s) => (
        <circle
          key={s.name}
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={s.color}
          strokeWidth="18"
          strokeDasharray={`${s.dash} ${s.gap}`}
          strokeDashoffset={-s.offset}
        />
      ))}
    </svg>
  );
}
