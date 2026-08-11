// Suma un conjunto de hitos de pago (deal_milestones) agrupados por moneda,
// sin conversión automática — cada moneda se muestra por separado. Antes
// esta misma lógica estaba copiada en Negotiations.jsx, Dashboard.jsx,
// Entities.jsx (scorecard de EntityDetailModal) y exportEntitiesPdf.js.
export function sumMilestonesByCurrency(milestones, currencyByNegotiationId) {
  const totals = {}
  for (const m of milestones) {
    const cur = currencyByNegotiationId[m.negotiation_id] || 'USD'
    totals[cur] = (totals[cur] || 0) + Number(m.amount)
  }
  return Object.entries(totals).map(([currency, total]) => ({ currency, total })).sort((a, b) => b.total - a.total)
}
