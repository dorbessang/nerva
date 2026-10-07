import '../../Negotiations.css'

function daysInState(neg) {
  if (!neg.status_since) return null
  return Math.floor((Date.now() - new Date(neg.status_since).getTime()) / (1000 * 60 * 60 * 24))
}

export default function StatusDaysBadge({ neg }) {
  const days = daysInState(neg)
  if (days === null) return null
  return <span className="neg-status-days" title="Días en este estado">{days === 0 ? 'hoy' : `${days}d`}</span>
}
