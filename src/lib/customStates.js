// Resuelve el color de un estado (negociación) contra la lista de
// custom_states del workspace — si no lo encuentra (estado borrado, dato
// viejo), cae a un gris neutro en vez de romper. Antes esta misma lógica
// estaba copiada igual en Negotiations.jsx, Entities.jsx y Products.jsx.
export function resolveStateConfig(states, name) {
  const found = (states || []).find(s => s.name === name)
  return found || { color: '#64748B', bg_color: '#F1F5F9' }
}

// Nombres de los estados marcados "final" (is_terminal) — para decidir qué
// cuenta como proyecto cerrado sin comparar contra un nombre fijo como
// 'Completado' (que ahora se puede renombrar libremente por workspace).
export function terminalStatusNames(states) {
  return new Set((states || []).filter(s => s.is_terminal).map(s => s.name))
}
