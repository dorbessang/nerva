// Aplica un playbook (lista de tareas precargadas) a un proyecto: crea una
// tarea real por cada ítem, con la fecha calculada a partir de `baseDate`
// (hoy, salvo que se pase otra) + el offset de días de cada ítem. Se puede
// aplicar al crear el proyecto o después, cualquier cantidad de veces.
export async function applyPlaybook(supabase, { playbookId, workspaceId, negotiationId, entityId, userId, baseDate }) {
  const { data: items, error } = await supabase
    .from('task_playbook_items')
    .select('title, days_offset, priority')
    .eq('playbook_id', playbookId)
    .order('sort_order')
  if (error || !items?.length) return { error }

  const base = baseDate ? new Date(baseDate) : new Date()
  const rows = items.map(item => {
    let dueDate = null
    if (item.days_offset !== null && item.days_offset !== undefined) {
      const d = new Date(base)
      d.setDate(d.getDate() + item.days_offset)
      dueDate = d.toISOString().split('T')[0]
    }
    return {
      workspace_id: workspaceId,
      negotiation_id: negotiationId || null,
      entity_id: entityId || null,
      title: item.title,
      status: 'pending',
      priority: item.priority || 'medium',
      due_date: dueDate,
      assigned_to: userId || null,
      created_by: userId || null,
    }
  })

  return supabase.from('tasks').insert(rows).select('id')
}
