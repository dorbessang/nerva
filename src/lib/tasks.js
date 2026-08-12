// Helpers compartidos para tareas encadenadas (predecessor_task_id)

import { isNotificationEnabled } from './notifications'
import { logActivity } from './activity'

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

function dedupeTasks(tasks) {
  const seen = new Set()
  return tasks.filter(t => (seen.has(t.id) ? false : (seen.add(t.id), true)))
}

// Pool de tareas candidatas a predecesora, para el desplegable "Depende
// de" (al crear una tarea) o el de edición (TaskDrawer). Antes cada
// formulario lo armaba a su manera — uno recibía la lista por prop del
// padre (podía quedar desactualizada), otro consultaba directo pero sin
// cubrir más que "mismo proyecto". Ahora es un único fetch, y el alcance
// es: tareas del mismo proyecto/entidad + tareas de las entidades
// vinculadas a ese proyecto (o el/los proyecto/s vinculado/s a esa
// entidad) + tareas sueltas (sin proyecto ni entidad), que siempre entran
// sin importar el tipo de la tarea que se está creando/editando. Si ese
// pool acotado da vacío (proyecto nuevo sin nada relacionado todavía), en
// vez de dejar el campo sin candidatas cae a cualquier tarea del
// workspace — la idea es acotar cuando hay algo relevante para ofrecer,
// nunca esconder la función entera por falta de candidatas "relacionadas".
// Una tarea suelta no tiene ningún contexto propio que la acote, así que
// para ella el pool es directamente todo el workspace.
export async function fetchPredecessorCandidates(supabase, { workspaceId, negotiationId, entityId }) {
  const cols = 'id, title, status, predecessor_task_id'
  const standaloneQuery = supabase.from('tasks').select(cols)
    .eq('workspace_id', workspaceId).is('negotiation_id', null).is('entity_id', null)
  async function wholeWorkspace() {
    const { data } = await supabase.from('tasks').select(cols).eq('workspace_id', workspaceId)
    return data || []
  }

  if (negotiationId) {
    const { data: links } = await supabase.from('negotiation_entities').select('entity_id').eq('negotiation_id', negotiationId)
    const entityIds = (links || []).map(l => l.entity_id)
    const [{ data: sameProject }, entityTasksRes, { data: standalone }] = await Promise.all([
      supabase.from('tasks').select(cols).eq('negotiation_id', negotiationId),
      entityIds.length > 0 ? supabase.from('tasks').select(cols).in('entity_id', entityIds) : Promise.resolve({ data: [] }),
      standaloneQuery,
    ])
    const pool = dedupeTasks([...(sameProject || []), ...(entityTasksRes.data || []), ...(standalone || [])])
    return pool.length > 0 ? pool : wholeWorkspace()
  }

  if (entityId) {
    const { data: links } = await supabase.from('negotiation_entities').select('negotiation_id').eq('entity_id', entityId)
    const negIds = (links || []).map(l => l.negotiation_id)
    const [{ data: sameEntity }, negTasksRes, { data: standalone }] = await Promise.all([
      supabase.from('tasks').select(cols).eq('entity_id', entityId),
      negIds.length > 0 ? supabase.from('tasks').select(cols).in('negotiation_id', negIds) : Promise.resolve({ data: [] }),
      standaloneQuery,
    ])
    const pool = dedupeTasks([...(sameEntity || []), ...(negTasksRes.data || []), ...(standalone || [])])
    return pool.length > 0 ? pool : wholeWorkspace()
  }

  return wholeWorkspace()
}

// Al completar una tarea, avisa in-app a los asignados de las tareas que
// dependían de ella y que ahora quedan desbloqueadas.
export async function notifySuccessors(supabase, completedTask, workspaceId) {
  const { data: successors } = await supabase
    .from('tasks')
    .select('id, title, assigned_to')
    .eq('predecessor_task_id', completedTask.id)

  const candidates = (successors || []).filter(s => s.assigned_to)
  if (candidates.length === 0) return

  const enabledChecks = await Promise.all(
    candidates.map(async (s) => ({ s, ok: await isNotificationEnabled(supabase, { userId: s.assigned_to, workspaceId, type: 'task_unblocked' }) }))
  )
  const toNotify = enabledChecks.filter(c => c.ok).map(c => c.s)
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

// Avisa in-app cuando se le asigna una tarea a alguien, incluido uno mismo.
// `task` necesita al menos { id, title }.
export async function notifyTaskAssigned(supabase, { workspaceId, task, assignedTo, actingUserId }) {
  if (!assignedTo) return
  if (!(await isNotificationEnabled(supabase, { userId: assignedTo, workspaceId, type: 'task_assigned' }))) return
  await supabase.from('notifications').insert({
    workspace_id: workspaceId,
    user_id: assignedTo,
    type: 'task_assigned',
    title: 'Nueva tarea asignada',
    body: `Te asignaron "${task.title}".`,
    task_id: task.id,
  })
}

// Crea una tarea: insert + notificación al asignado (si aplica) + log de
// actividad (si cuelga de un proyecto o una entidad). Comparte esta lógica
// TaskModal.jsx, el modal inline de un proyecto (Negotiations.jsx) y el
// form inline de una entidad (Entities.jsx) — antes cada uno la
// reimplementaba a mano, con diferencias que se habían colado sin querer
// (el de proyecto no chequeaba si el insert fallaba, y no guardaba quién
// creó la tarea).
export async function createTask(supabase, {
  workspaceId, title, description, priority = 'medium', dueDate, assignedTo,
  negotiationId, entityId, predecessorId, createdBy, actorId,
}) {
  const { data, error } = await supabase.from('tasks').insert({
    workspace_id: workspaceId,
    title: title.trim(),
    description: description?.trim() || null,
    priority,
    due_date: dueDate || null,
    assigned_to: assignedTo || null,
    negotiation_id: negotiationId || null,
    entity_id: entityId || null,
    predecessor_task_id: predecessorId || null,
    status: 'pending',
    created_by: createdBy || null,
  }).select('id, title').single()

  if (error) return { error }

  await notifyTaskAssigned(supabase, { workspaceId, task: data, assignedTo, actingUserId: actorId })
  if (negotiationId || entityId) {
    await logActivity(supabase, {
      workspaceId, negotiationId, entityId, type: 'task_created',
      title: `Tarea creada: "${data.title}"`, actorId,
    })
  }
  return { data }
}

// Si la tarea ya se resolvió (se completó, sin importar si fue desde la
// notificación o navegando directo), las notificaciones sobre ella quedan
// obsoletas — las borramos.
export async function dismissNotificationsForTask(supabase, taskId) {
  await supabase.from('notifications').delete().eq('task_id', taskId)
}
