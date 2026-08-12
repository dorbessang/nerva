// Detecta proyectos activos sin actividad reciente — entre alertDays e
// inactiveDays (configurables por workspace, workspaces.low_activity_*,
// default 90/120). Pasado inactiveDays ya se marcan 'inactive' solos
// (mark_inactive_negotiations, cron en Supabase, usa el mismo valor); esta
// ventana es la de "alerta todavía no automática". Antes esta misma regla
// (con 90/120 fijos) estaba copiada en Layout.jsx y Dashboard.jsx.
export function lowActivityWindow(now = new Date(), alertDays = 90, inactiveDays = 120) {
  return {
    since: new Date(now - alertDays * 24 * 60 * 60 * 1000).toISOString(),
    until: new Date(now - inactiveDays * 24 * 60 * 60 * 1000).toISOString(),
  }
}

// Mismo criterio que lowActivityWindow, aplicado a un proyecto ya cargado
// en memoria (evita otra ida a la base cuando ya se tiene la lista).
export function isLowActivityAlert(neg, window = lowActivityWindow()) {
  return neg.activity_status === 'active' &&
    neg.status !== 'Completado' &&
    neg.last_activity_at < window.since &&
    neg.last_activity_at >= window.until
}
