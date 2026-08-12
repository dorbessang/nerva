// Convierte una fecha en texto relativo ("hace 2h", "ayer", etc.) — antes
// copiado en Dashboard.jsx, NotificationBell.jsx y ActivityTimeline.jsx,
// cada uno con reglas levemente distintas entre sí (no por descuido: cada
// pantalla lo necesitaba un poco distinto). Los parámetros reproducen
// exacto el comportamiento que ya tenía cada uno — no se unifica el
// comportamiento, solo el código.
export function timeAgo(dateStr, { showNow = true, showYesterday = false, daySuffix = 'd', maxDays = Infinity } = {}) {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (showNow && mins < 1) return 'ahora'
  if (mins < 60) return `hace ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `hace ${hours}h`
  const days = Math.floor(hours / 24)
  if (showYesterday && days === 1) return 'ayer'
  if (days < maxDays) return `hace ${days}${daySuffix}`
  return new Date(dateStr).toLocaleDateString('es-AR')
}
