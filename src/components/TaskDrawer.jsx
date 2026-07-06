import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { wouldCreateCycle, isTaskBlocked, notifyTaskAssigned } from '../lib/tasks'
import './TaskDrawer.css'

export default function TaskDrawer({ task, onClose, onUpdated }) {
  const { user } = useAuth()
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
    if (data) setMembers(data)
  }

  async function fetchSiblingTasks() {
    if (!task.negotiation_id) return
    const { data } = await supabase
      .from('tasks')
      .select('id, title, status, predecessor_task_id')
      .eq('negotiation_id', task.negotiation_id)
    if (data) setSiblingTasks(data)
  }

  const predecessorOptions = siblingTasks.filter(
    t => t.id !== task.id && !wouldCreateCycle(siblingTasks, task.id, t.id)
  )

  async function handleSave() {
    setSaving(true)
    const { error } = await supabase
      .from('tasks')
      .update({
        title: title.trim(),
        description: description.trim() || null,
        status,
        priority,
        due_date: dueDate || null,
        assigned_to: assignedTo || null,
        predecessor_task_id: predecessorId || null,
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