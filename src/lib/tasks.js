// Helpers compartidos para tareas encadenadas (predecessor_task_id)

export function isTaskBlocked(task) {
  return !!task.predecessor && task.predecessor.status !== 'done'
}

// Recorre la cadena de predecesoras de `candidatePredecessorId` para
// asegurarse de que no se termine llegando de vuelta a `taskId`.
export function wouldCreateCycle(allTasks, taskId, candidatePredecessorId) {
  if (!candidatePredecessorId) return false
  if (candidatePredecessorId === taskId) return true

  const byId = Object.fromEntries(allTasks.map(t => [t.id, t]))
  const seen = new Set()
  let current = byId[candidatePredecessorId]

  while (current?.predecessor_task_id) {
    if (current.predecessor_task_id === taskId) return true
    if (seen.has(current.id)) break
    seen.add(current.id)
    current = byId[current.predecessor_task_id]
  }
  return false
}

// Al completar una tarea, avisa in-app a los asignados de las tareas que
// dependían de ella y que ahora quedan desbloqueadas.
export async function notifySuccessors(supabase, completedTask, workspaceId) {
  const { data: successors } = await supabase
    .from('tasks')
    .select('id, title, assigned_to')
    .eq('predecessor_task_id', completedTask.id)

  const toNotify = (successors || []).filter(s => s.assigned_to)
  if (toNotify.length === 0) return

  await supabase.from('notifications').insert(
    toNotify.map(s => ({
      workspace_id: workspaceId,
      user_id: s.assigned_to,
      type: 'task_unblocked',
      title: 'Tarea desbloqueada',
      body: `"${s.title}" ya se puede completar (se resolvió "${completedTask.title}").`,
      task_id: s.id,
    }))
  )
}

// Avisa in-app cuando se le asigna una tarea a alguien (no notifica si uno
// se autoasigna). `task` necesita al menos { id, title }.
export async function notifyTaskAssigned(supabase, { workspaceId, task, assignedTo, actingUserId }) {
  if (!assignedTo || assignedTo === actingUserId) return
  await supabase.from('notifications').insert({
    workspace_id: workspaceId,
    user_id: assignedTo,
    type: 'task_assigned',
    title: 'Nueva tarea asignada',
    body: `Te asignaron "${task.title}".`,
    task_id: task.id,
  })
}
