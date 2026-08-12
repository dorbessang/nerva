// Detecta proyectos activos sin actividad reciente — entre 90 y 120 días.
// Pasado los 120 ya se marcan 'inactive' solos (mark_inactive_negotiations,
// cron en Supabase); esta ventana es la de "alerta todavía no automática".
// Antes esta misma regla (con los mismos 90/120 sueltos) estaba copiada en
// Layout.jsx (banner global) y Dashboard.jsx (card de alerta).
const LOW_ACTIVITY_MIN_DAYS = 90
const LOW_ACTIVITY_MAX_DAYS = 120

export function lowActivityWindow(now = new Date()) {
  return {
    since: new Date(now - LOW_ACTIVITY_MIN_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    until: new Date(now - LOW_ACTIVITY_MAX_DAYS * 24 * 60 * 60 * 1000).toISOString(),
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
