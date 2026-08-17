// Catálogo de reglas de autorización por workspace — cada una vive como una
// fila en approval_rules (rule_type + enabled + approver_id +
// threshold_numeric opcional), leída desde activeWorkspace.approval_rules
// (fetcheada en AuthContext junto con el resto del workspace).

import { isNotificationEnabled } from './notifications'
import { logActivity } from './activity'

export const APPROVAL_RULE_TYPES = [
  { key: 'commission', label: 'Comisión fuera de rango', hasThreshold: true, thresholdLabel: 'Umbral (%)', thresholdMax: 100 },
  { key: 'task', label: 'Tareas que requieren autorización', hasThreshold: true, thresholdLabel: 'Monto a partir del cual pide autorización (opcional)', thresholdMax: null },
  { key: 'negotiation_close', label: 'Confirmar el cierre de un proyecto', hasThreshold: false },
]

export function getApprovalRule(workspace, ruleType) {
  return workspace?.approval_rules?.find(r => r.rule_type === ruleType) ?? null
}

export function isApprovalRuleEnabled(workspace, ruleType) {
  const rule = getApprovalRule(workspace, ruleType)
  return !!(rule?.enabled && rule?.approver_id)
}

export function isApprover(workspace, ruleType, userId) {
  const rule = getApprovalRule(workspace, ruleType)
  return !!(rule?.enabled && rule?.approver_id && rule.approver_id === userId)
}

// Una tarea pide autorización si se tildó a mano, o si el monto cargado
// supera el umbral configurado (cuando hay uno) — cualquiera de las dos
// alcanza. Sin regla activa (rule === null/enabled === false), nunca.
export function shouldRequireTaskApproval(rule, manuallyChecked, amount) {
  if (!rule?.enabled || !rule?.approver_id) return false
  if (manuallyChecked) return true
  return rule.threshold_numeric != null && amount != null && amount > rule.threshold_numeric
}

// Al llamarse DESPUÉS de aplicar un cambio de estado a un estado terminal,
// marca el proyecto como "cierre pendiente de confirmación" si la regla
// está activa — no bloquea nada (el estado ya se aplicó), solo lo deja
// marcado hasta que el aprobador lo confirme o lo revierta. Se invoca desde
// los 4 lugares que cambian negotiations.status (inline, modal, Kanban,
// bulk) — todos comparten este único punto en vez de duplicar la lógica.
export async function requestNegotiationCloseApproval(supabase, { workspace, workspaceId, negotiation, prevStatus, newStatus, terminalNames, actorId }) {
  if (!terminalNames.has(newStatus)) return
  const rule = getApprovalRule(workspace, 'negotiation_close')
  if (!rule?.enabled || !rule?.approver_id) return
  await supabase.from('negotiations').update({
    close_confirmation_status: 'pending',
    close_requested_from_status: prevStatus,
  }).eq('id', negotiation.id)
  if (await isNotificationEnabled(supabase, { userId: rule.approver_id, workspaceId, type: 'negotiation_close_requested' })) {
    await supabase.from('notifications').insert({
      workspace_id: workspaceId,
      user_id: rule.approver_id,
      type: 'negotiation_close_requested',
      title: 'Cierre de proyecto pendiente de confirmación',
      body: `"${negotiation.product || negotiation.title}" se marcó como "${newStatus}" — confirmalo o revertilo.`,
      negotiation_id: negotiation.id,
    })
  }
  await logActivity(supabase, {
    workspaceId, negotiationId: negotiation.id, type: 'negotiation_close_requested',
    title: `Cierre a "${newStatus}" pendiente de confirmación`, actorId,
  })
}
