import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { wouldCreateCycle, isTaskBlocked, notifyTaskAssigned, createTask } from '../lib/tasks'
import { useEscapeToClose } from '../lib/useEscapeToClose'
import './TaskDrawer.css'

export default function TaskDrawer({ task, onClose, onUpdated }) {
  const { user, workspaceId } = useAuth()
  useEscapeToClose(onClose)
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description || '')
  const [status, setStatus] = useState(task.status)
  const [priority, setPriority] = useState(task.priority)
  const [dueDate, setDueDate] = useState(task.due_date || '')
  const [assignedTo, setAssignedTo] = useState(task.assigned_to || '')
  const [predecessorId, setPredecessorId] = useState(task.predecessor_task_id || '')
  const [members, setMembers] = useState([])
  const [siblingTasks, setSiblingTasks] = useState([])
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showSubtaskForm, setShowSubtaskForm] = useState(false)
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [subtaskAssignee, setSubtaskAssignee] = useState('')
  const [subtaskDue, setSubtaskDue] = useState('')
  const [savingSubtask, setSavingSubtask] = useState(false)

  useEffect(() => {
    fetchMembers()
    fetchSiblingTasks()
  }, [])

  async function fetchMembers() {
    const { data } = await supabase
      .from('workspace_members')
      .select(`
        user_id,
        profile:user_id (
          full_name
        )
      `)
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
    if (data) setMembers(data)
  }

  // El "pool" de candidatas a predecesora es del mismo tipo que la tarea:
  // si es de un proyecto, otras tareas de ese proyecto; si es de una
  // entidad, otras tareas de esa entidad; si es suelta (sin ninguna de las
  // dos), otras tareas sueltas del workspace.
  async function fetchSiblingTasks() {
    let query = supabase.from('tasks').select('id, title, status, predecessor_task_id').eq('workspace_id', workspaceId)
    query = task.negotiation_id
      ? query.eq('negotiation_id', task.negotiation_id)
      : task.entity_id
      ? query.eq('entity_id', task.entity_id)
      : query.is('negotiation_id', null).is('entity_id', null)
    const { data } = await query
    if (data) setSiblingTasks(data)
  }

  const predecessorOptions = siblingTasks.filter(
    t => t.id !== task.id && !wouldCreateCycle(siblingTasks, task.id, t.id)
  )

  async function handleAddSubtask() {
    if (!subtaskTitle.trim()) return
    setSavingSubtask(true)
    const { error } = await createTask(supabase, {
      workspaceId, title: subtaskTitle, assignedTo: subtaskAssignee, dueDate: subtaskDue,
      negotiationId: task.negotiation_id, entityId: task.entity_id,
      predecessorId: task.id, createdBy: user?.id, actorId: user?.id,
    })
    setSavingSubtask(false)
    if (error) return
    setSubtaskTitle('')
    setSubtaskAssignee('')
    setSubtaskDue('')
    setShowSubtaskForm(false)
    onUpdated()
  }

  async function handleSave() {
    setSaving(true)
    const newDueDate = dueDate || null
    const dueDateChanged = newDueDate !== (task.due_date || null)
    const { error } = await supabase
      .from('tasks')
      .update({
        title: title.trim(),
        description: description.trim() || null,
        status,
        priority,
        due_date: newDueDate,
        assigned_to: assignedTo || null,
        predecessor_task_id: predecessorId || null,
        // Si cambia la fecha límite, el aviso de "por vencer/vencida" tiene
        // que poder volver a dispararse para la nueva fecha
        ...(dueDateChanged ? { due_soon_notified_at: null, overdue_notified_at: null } : {}),
      })
      .eq('id', task.id)
    setSaving(false)
    if (!error) {
      if (assignedTo && assignedTo !== task.assigned_to) {
        await notifyTaskAssigned(supabase, { workspaceId: task.workspace_id, task, assignedTo, actingUserId: user?.id })
      }
      onUpdated()
      onClose()
    }
  }

  async function handleDelete() {
    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', task.id)
    if (!error) {
      onUpdated()
      onClose()
    }
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-header">
          <h2 className="drawer-title">Detalle de tarea</h2>
          <button className="drawer-close" onClick={onClose}>✕</button>
        </div>

        <div className="drawer-body">
          <div className="form-group">
            <label>TÍTULO</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>DESCRIPCIÓN</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              placeholder="Sin descripción..."
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>ESTADO</label>
              <select value={status} onChange={e => setStatus(e.target.value)}>
                <option value="pending">Pendiente</option>
                <option value="in_progress">En progreso</option>
              </select>
            </div>

            <div className="form-group">
              <label>PRIORIDAD</label>
              <select value={priority} onChange={e => setPriority(e.target.value)}>
                <option value="low">Baja</option>
                <option value="medium">Media</option>
                <option value="high">Alta</option>
                <option value="urgent">Urgente</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>FECHA LÍMITE</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>RESPONSABLE</label>
              <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
                <option value="">Sin asignar</option>
                {members.map(m => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.profile?.full_name || 'Usuario'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {predecessorOptions.length > 0 && (
            <div className="form-group">
              <label>DEPENDE DE (opcional)</label>
              <select value={predecessorId} onChange={e => setPredecessorId(e.target.value)}>
                <option value="">Ninguna</option>
                {predecessorOptions.map(t => (
                  <option key={t.id} value={t.id}>{t.title}{t.status === 'done' ? ' (hecha)' : ''}</option>
                ))}
              </select>
            </div>
          )}

          {isTaskBlocked(task) && (
            <p className="drawer-blocked-note">
              🔒 Depende de "{task.predecessor.title}" — no se puede completar hasta que esa se marque como hecha.
            </p>
          )}

          <div className="form-group">
            {!showSubtaskForm ? (
              <button type="button" className="btn-secondary" onClick={() => setShowSubtaskForm(true)}>
                + Crear tarea dependiente
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, background: '#f9fafb', borderRadius: 8 }}>
                <label>NUEVA TAREA QUE DEPENDE DE ESTA</label>
                <input
                  type="text"
                  placeholder="¿Qué hay que hacer?"
                  value={subtaskTitle}
                  onChange={e => setSubtaskTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddSubtask() }}
                  autoFocus
                />
                <div className="form-row">
                  <select value={subtaskAssignee} onChange={e => setSubtaskAssignee(e.target.value)}>
                    <option value="">Sin asignar</option>
                    {members.map(m => (
                      <option key={m.user_id} value={m.user_id}>{m.profile?.full_name || 'Usuario'}</option>
                    ))}
                  </select>
                  <input type="date" value={subtaskDue} onChange={e => setSubtaskDue(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" className="btn-secondary" onClick={() => setShowSubtaskForm(false)}>Cancelar</button>
                  <button type="button" className="btn-primary" onClick={handleAddSubtask} disabled={savingSubtask || !subtaskTitle.trim()}>
                    {savingSubtask ? 'Creando...' : 'Crear'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="drawer-footer">
          {!confirmDelete ? (
            <button className="btn-delete" onClick={() => setConfirmDelete(true)}>
              Eliminar tarea
            </button>
          ) : (
            <div className="delete-confirm">
              <span>¿Seguro?</span>
              <button className="btn-delete-confirm" onClick={handleDelete}>
                Sí, eliminar
              </button>
              <button className="btn-secondary" onClick={() => setConfirmDelete(false)}>
                Cancelar
              </button>
            </div>
          )}

          <div className="drawer-actions">
            <button className="btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}