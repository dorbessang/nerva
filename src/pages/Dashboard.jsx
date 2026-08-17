// Dashboard.jsx — Página principal con métricas generales del workspace

import { useState, useEffect } from "react";
import { BarChart3, PieChart } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { useNavigate } from "react-router-dom";
import { sumMilestonesByCurrency } from "../lib/pipeline";
import { timeAgo as sharedTimeAgo } from "../lib/timeAgo";
import { lowActivityWindow, isLowActivityAlert } from "../lib/lowActivity";
import { terminalStatusNames } from "../lib/customStates";
import "./Dashboard.css";

export default function Dashboard() {
  const { activeWorkspace } = useAuth()
  if (activeWorkspace?.type === 'personal') return <PersonalDashboard />
  return <TeamDashboard />
}

function TeamDashboard() {
  const { user, workspaceId, activeWorkspace } = useAuth()
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

  // Desglose de proyectos completados por cada estado final (puede haber
  // más de uno: Ganado, Perdido, etc. — no se suman en un solo número).
  const [completedByState, setCompletedByState] = useState([]);

  // Tareas asignadas al usuario logueado
  const [myTasks, setMyTasks] = useState([]);

  // Proyectos modificados recientemente
  const [recentActivity, setRecentActivity] = useState([]);

  // Valor de pipeline — suma de hitos de pago de proyectos en curso, agrupado por moneda
  const [pipelineValue, setPipelineValue] = useState([]);

  // Valor de pipeline desglosado por estado (no terminal), agrupado por moneda dentro de cada uno
  const [pipelineByState, setPipelineByState] = useState({});

  // Tiempo promedio (en días) que llevan en su estado actual los proyectos activos, por estado
  const [avgDaysByState, setAvgDaysByState] = useState([]);

  // Tasa de cierre por tipo de entidad vinculada — % de proyectos que llegaron a un estado final
  const [closeRateByEntityType, setCloseRateByEntityType] = useState([]);

  // % de todos los proyectos del workspace que llegaron a un estado final (cualquiera)
  const [closeRateOverallPct, setCloseRateOverallPct] = useState(0);

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
          .select("id, status, activity_status, last_activity_at, currency, created_at")
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
        id, product, title, status, updated_at, description,
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

    const endOfWeek = new Date();
    endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
    const endOfWeekStr = endOfWeek.toISOString().split("T")[0];

    const terminalNames = terminalStatusNames(statesRes.data);

    // Proyectos en zona de alerta: activos, no en estado final, sin actividad entre alertDays e inactiveDays
    const alertWindow = lowActivityWindow(new Date(), activeWorkspace?.low_activity_alert_days, activeWorkspace?.low_activity_inactive_days);
    const alert = negotiations.filter(n => isLowActivityAlert(n, alertWindow, terminalNames));
    setAlertProjects(alert);

    setStats({
      activeProjects: negotiations.filter(n => n.activity_status === 'active' && !terminalNames.has(n.status)).length,
      completedProjects: negotiations.filter(n => terminalNames.has(n.status)).length,
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

    const activeNegs = negotiations.filter(n => n.activity_status === 'active' && !terminalNames.has(n.status));

    // Sumamos los hitos de pago de los proyectos en curso, agrupados por moneda
    // (sin conversión automática — cada moneda se muestra por separado)
    const activeNegIds = new Set(activeNegs.map(n => n.id));
    const currencyByNegId = Object.fromEntries(negotiations.map(n => [n.id, n.currency || 'USD']));
    setPipelineValue(
      sumMilestonesByCurrency((milestonesRes.data || []).filter(m => activeNegIds.has(m.negotiation_id)), currencyByNegId)
    );
    // Cada estado final se muestra por separado — pueden significar cosas
    // distintas (Ganado, Perdido, etc.), agruparlos bajo uno solo escondería
    // esa diferencia.
    const terminalStates = (statesRes.data || []).filter(s => s.is_terminal);
    setStateCounts([
      ...(statesRes.data || [])
        .filter(s => !s.is_terminal)
        .map(s => ({
          name: s.name,
          color: s.color,
          count: activeNegs.filter(n => n.status === s.name).length,
          total: activeNegs.length,
        })),
      ...terminalStates.map(s => ({
        name: s.name,
        color: s.color,
        count: negotiations.filter(n => n.status === s.name).length,
        total: negotiations.length,
      })),
    ]);
    setCompletedByState(terminalStates.map(s => ({
      name: s.name,
      count: negotiations.filter(n => n.status === s.name).length,
    })));
    setCloseRateOverallPct(
      negotiations.length > 0
        ? Math.round((negotiations.filter(n => terminalNames.has(n.status)).length / negotiations.length) * 100)
        : 0
    );

    // Pipeline por etapa — mismo criterio que el total (sin conversión entre
    // monedas), pero desglosado por cada estado no-terminal en curso.
    const milestones = milestonesRes.data || [];
    const pipelineByStateMap = {};
    for (const s of (statesRes.data || []).filter(s => !s.is_terminal)) {
      const idsInState = new Set(activeNegs.filter(n => n.status === s.name).map(n => n.id));
      const value = sumMilestonesByCurrency(milestones.filter(m => idsInState.has(m.negotiation_id)), currencyByNegId);
      if (value.length > 0) pipelineByStateMap[s.name] = value;
    }
    setPipelineByState(pipelineByStateMap);

    // Tiempo en etapa actual — para cada proyecto activo, hace cuánto está en
    // su estado actual (última vez que cambió de estado según activity_log;
    // si nunca cambió, desde que se creó). Promediado por estado.
    const allNegIds = negotiations.map(n => n.id);
    let lastStatusChangeByNeg = {};
    if (allNegIds.length > 0) {
      const { data: statusChanges } = await supabase
        .from("activity_log")
        .select("negotiation_id, created_at")
        .eq("workspace_id", workspaceId)
        .eq("type", "status_changed")
        .in("negotiation_id", allNegIds);
      for (const row of statusChanges || []) {
        const prev = lastStatusChangeByNeg[row.negotiation_id];
        if (!prev || row.created_at > prev) lastStatusChangeByNeg[row.negotiation_id] = row.created_at;
      }
    }
    const now = Date.now();
    const daysByState = {};
    for (const n of activeNegs) {
      const since = lastStatusChangeByNeg[n.id] || n.created_at;
      if (!since) continue;
      const days = (now - new Date(since).getTime()) / (1000 * 60 * 60 * 24);
      if (!daysByState[n.status]) daysByState[n.status] = [];
      daysByState[n.status].push(days);
    }
    setAvgDaysByState(
      (statesRes.data || [])
        .filter(s => !s.is_terminal && daysByState[s.name]?.length)
        .map(s => ({
          name: s.name,
          color: s.color,
          avgDays: Math.round(daysByState[s.name].reduce((a, d) => a + d, 0) / daysByState[s.name].length),
          count: daysByState[s.name].length,
        }))
    );

    // Tasa de cierre por tipo de entidad vinculada — de los proyectos
    // conectados a cada tipo, cuántos llegaron a algún estado final (no
    // distingue Ganado/Perdido, la app no tiene ese dato estructurado hoy).
    if (allNegIds.length > 0) {
      const [{ data: negEntitiesAll }, { data: entityTypesData }] = await Promise.all([
        supabase.from("negotiation_entities").select("negotiation_id, entity:entity_id ( entity_type_id )").in("negotiation_id", allNegIds),
        supabase.from("entity_types").select("id, name, plural").eq("workspace_id", workspaceId),
      ]);
      const statusByNegId = Object.fromEntries(negotiations.map(n => [n.id, n.status]));
      const typeStats = {};
      for (const row of negEntitiesAll || []) {
        const typeId = row.entity?.entity_type_id;
        if (!typeId) continue;
        if (!typeStats[typeId]) typeStats[typeId] = { total: 0, closed: 0 };
        typeStats[typeId].total += 1;
        if (terminalNames.has(statusByNegId[row.negotiation_id])) typeStats[typeId].closed += 1;
      }
      setCloseRateByEntityType(
        (entityTypesData || [])
          .filter(t => typeStats[t.id]?.total > 0)
          .map(t => ({
            name: t.plural || t.name,
            total: typeStats[t.id].total,
            closed: typeStats[t.id].closed,
            pct: Math.round((typeStats[t.id].closed / typeStats[t.id].total) * 100),
          }))
      );
    } else {
      setCloseRateByEntityType([]);
    }

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

  function timeAgo(dateStr) {
    return sharedTimeAgo(dateStr, { showNow: false, showYesterday: true, daySuffix: ' días' });
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
          <p className="db-metric-detail">
            {completedByState.length <= 1
              ? `${stats.completedProjects} completados`
              : completedByState.map(s => `${s.count} ${s.name}`).join(' · ')}
          </p>
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
                <BarChart3 size={14} />
              </button>
              <button
                className={`db-toggle-btn ${chartView === "donut" ? "active" : ""}`}
                onClick={() => setChartView("donut")}
                title="Vista donut"
              >
                <PieChart size={14} />
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
                  {pipelineByState[s.name] && (
                    <span className="db-state-value">
                      {pipelineByState[s.name].map(p => `${p.currency} ${p.total.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`).join(" · ")}
                    </span>
                  )}
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
                        : new Date(task.due_date + 'T00:00:00').toLocaleDateString("es-AR")}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Grid de 2 columnas: tiempo en etapa + tasa de cierre */}
      <div className="db-grid2" style={{ marginTop: 16 }}>
        <div className="db-section-card">
          <p className="db-section-title">Tiempo en etapa actual</p>
          {avgDaysByState.length === 0 ? (
            <p className="db-empty">Sin datos suficientes todavía.</p>
          ) : (
            avgDaysByState.map((s) => (
              <div key={s.name} className="db-state-row" onClick={() => navigate("/negotiations")}>
                <span className="db-state-label">{s.name}</span>
                <div className="db-state-bar-bg">
                  <div
                    className="db-state-bar-fill"
                    style={{
                      width: `${Math.min(100, (s.avgDays / Math.max(...avgDaysByState.map(x => x.avgDays), 1)) * 100)}%`,
                      backgroundColor: s.color,
                    }}
                  />
                </div>
                <span className="db-state-count">{s.avgDays}d</span>
              </div>
            ))
          )}
        </div>

        <div className="db-section-card">
          <p className="db-section-title">Tasa de cierre</p>
          <p className="db-close-rate-total">
            {closeRateOverallPct}%
            <span className="db-close-rate-total-label">de los proyectos llegó a un estado final</span>
          </p>
          {closeRateByEntityType.length === 0 ? (
            <p className="db-empty">Sin entidades vinculadas todavía.</p>
          ) : (
            closeRateByEntityType.map((t) => (
              <div key={t.name} className="db-state-row" onClick={() => navigate("/entities")}>
                <span className="db-state-label">{t.name}</span>
                <div className="db-state-bar-bg">
                  <div className="db-state-bar-fill" style={{ width: `${t.pct}%`, backgroundColor: "#0B1F3A" }} />
                </div>
                <span className="db-state-count">{t.pct}%</span>
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

            // Tooltip que aparece al hacer hover — muestra estado y descripción
            const tooltipText = [
              `Estado: ${neg.status || "—"}`,
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

// Dashboard del workspace personal — nada de proyectos/pipeline, solo un
// resumen de las tareas sueltas de la Agenda (hoy / esta semana / vencidas)
function PersonalDashboard() {
  const { workspaceId } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    if (workspaceId) fetchTasks();
  }, [workspaceId]);

  async function fetchTasks() {
    setLoading(true);
    const { data } = await supabase
      .from("tasks")
      .select("id, title, due_date, status")
      .eq("workspace_id", workspaceId)
      .is("negotiation_id", null)
      .is("entity_id", null)
      .neq("status", "done")
      .order("due_date", { ascending: true, nullsFirst: false });
    setTasks(data || []);
    setLoading(false);
  }

  const today = new Date().toISOString().split("T")[0];
  const endOfWeek = new Date();
  endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()));
  const endOfWeekStr = endOfWeek.toISOString().split("T")[0];

  const todayTasks = tasks.filter((t) => t.due_date === today);
  const weekTasks = tasks.filter((t) => t.due_date && t.due_date > today && t.due_date <= endOfWeekStr);
  const overdueTasks = tasks.filter((t) => t.due_date && t.due_date < today);

  if (loading) return <div className="db-loading">Cargando...</div>;

  return (
    <div className="db-container">
      <div className="db-header">
        <p className="db-date">
          {new Date()
            .toLocaleDateString("es-AR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
            .toLowerCase()
            .replace(/^\w/, (l) => l.toUpperCase())}
        </p>
      </div>

      <div className="db-metrics db-metrics--personal">
        <div className="db-metric-card" style={{ cursor: "pointer" }} onClick={() => navigate("/agenda")}>
          <p className="db-metric-label">Hoy</p>
          <p className="db-metric-value">{todayTasks.length}</p>
          <p className="db-metric-detail">tarea{todayTasks.length !== 1 ? "s" : ""} para hoy</p>
        </div>
        <div className="db-metric-card" style={{ cursor: "pointer" }} onClick={() => navigate("/agenda")}>
          <p className="db-metric-label">Esta semana</p>
          <p className="db-metric-value">{weekTasks.length}</p>
          <p className="db-metric-detail">próximas</p>
        </div>
        <div className="db-metric-card" style={{ cursor: "pointer" }} onClick={() => navigate("/agenda")}>
          <p className="db-metric-label">Vencidas</p>
          <p className={`db-metric-value ${overdueTasks.length > 0 ? "danger" : ""}`}>{overdueTasks.length}</p>
          <p className="db-metric-detail">{overdueTasks.length > 0 ? "Requieren atención" : "Todo al día"}</p>
        </div>
      </div>

      <div className="db-section-card">
        <p className="db-section-title">Próximas tareas</p>
        {tasks.length === 0 ? (
          <p className="db-empty">Sin tareas pendientes. ¡Buen trabajo!</p>
        ) : (
          tasks.slice(0, 10).map((task) => (
            <div key={task.id} className="db-task-row" onClick={() => navigate("/agenda")}>
              <div className="db-task-body">
                <p className="db-task-title">{task.title}</p>
              </div>
              {task.due_date && (
                <span className={`db-task-date ${task.due_date < today ? "overdue" : ""}`}>
                  {task.due_date < today ? "Vencida" : new Date(task.due_date + "T00:00:00").toLocaleDateString("es-AR")}
                </span>
              )}
            </div>
          ))
        )}
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
