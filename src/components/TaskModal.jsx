import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { createTask, fetchPredecessorCandidates } from '../lib/tasks'
import { useEscapeToClose } from '../lib/useEscapeToClose'
import SearchableSelect from './SearchableSelect'
import './TaskModal.css'

export default function TaskModal({ onClose, onCreated }) {
  const { user, workspaceId } = useAuth()
  useEscapeToClose(onClose)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('medium')
  const [dueDate, setDueDate] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [negotiationId, setNegotiationId] = useState('')
  const [predecessorId, setPredecessorId] = useState('')
  const [members, setMembers] = useState([])
  const [negotiations, setNegotiations] = useState([])
  const [negotiationTasks, setNegotiationTasks] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchMembers()
    fetchNegotiations()
  }, [])

  useEffect(() => {
    setPredecessorId('')
    if (!workspaceId) return
    fetchPredecessorCandidates(supabase, { workspaceId, negotiationId }).then(setNegotiationTasks)
  }, [negotiationId, workspaceId])

  async function fetchMembers() {
    const { data } = await supabase
      .from('workspace_members')
      .select(`user_id, profile:user_id ( full_name, email )`)
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
    if (data) setMembers(data)
  }

  async function fetchNegotiations() {
    const { data } = await supabase
      .from('negotiations')
      .select('id, title, product')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
    if (data) setNegotiations(data)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (!title.trim()) { setError('El título es obligatorio'); return }
    setLoading(true)
    const { error } = await createTask(supabase, {
      workspaceId, title, description, priority, dueDate, assignedTo,
      negotiationId, predecessorId, createdBy: user.id, actorId: user.id,
    })
    setLoading(false)
    if (error) { setError('Error al crear la tarea. Intentá de nuevo.'); return }
    onCreated()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Nueva tarea</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-group">
            <label>TÍTULO *</label>
            <input type="text" placeholder="¿Qué hay que hacer?" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
          </div>

          <div className="form-group">
            <label>DESCRIPCIÓN</label>
            <textarea placeholder="Detalles opcionales..." value={description} onChange={e => setDescription(e.target.value)} rows={3} />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>PRIORIDAD</label>
              <select value={priority} onChange={e => setPriority(e.target.value)}>
                <option value="low">Baja</option>
                <option value="medium">Media</option>
                <option value="high">Alta</option>
                <option value="urgent">Urgente</option>
              </select>
            </div>
            <div className="form-group">
              <label>FECHA LÍMITE</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label>ASIGNAR A</label>
            <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
              <option value="">Sin asignar</option>
              {members.map(m => (
                <option key={m.user_id} value={m.user_id}>
                  {m.profile?.full_name || m.profile?.email || 'Usuario'}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>PROYECTO (opcional)</label>
            <SearchableSelect
              value={negotiationId}
              onChange={setNegotiationId}
              options={negotiations.map(n => ({ value: n.id, label: n.product || n.title }))}
              placeholder="Buscar proyecto..."
              emptyLabel="Sin proyecto"
            />
          </div>

          {negotiationTasks.length > 0 && (
            <div className="form-group">
              <label>DEPENDE DE (opcional)</label>
              <select value={predecessorId} onChange={e => setPredecessorId(e.target.value)}>
                <option value="">Ninguna</option>
                {negotiationTasks.map(t => (
                  <option key={t.id} value={t.id}>{t.title}{t.status === 'done' ? ' (hecha)' : ''}</option>
                ))}
              </select>
            </div>
          )}

          {error && <p className="form-error">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Creando...' : 'Crear tarea'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}