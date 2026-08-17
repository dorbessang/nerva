// Catálogo de reglas de autorización por workspace — cada una vive como una
// fila en approval_rules (rule_type + enabled + approver_id +
// threshold_numeric opcional), leída desde activeWorkspace.approval_rules
// (fetcheada en AuthContext junto con el resto del workspace).

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
