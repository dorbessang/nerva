import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import './TaskModal.css'

export default function TaskModal({ onClose, onCreated }) {
  const { user } = useAuth()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('medium')
  const [dueDate, setDueDate] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [negotiationId, setNegotiationId] = useState('')
  const [members, setMembers] = useState([])
  const [negotiations, setNegotiations] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchMembers()
    fetchNegotiations()
  }, [])

  async function fetchMembers() {
    const { data } = await supabase
      .from('workspace_members')
      .select(`user_id, profile:user_id ( full_name, email )`)
    if (data) setMembers(data)
  }

  async function fetchNegotiations() {
    const { data } = await supabase
      .from('negotiations')
      .select('id, title, product')
      .order('created_at', { ascending: false })
    if (data) setNegotiations(data)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (!title.trim()) { setError('El título es obligatorio'); return }
    setLoading(true)
    const { error } = await supabase.from('tasks').insert({
      workspace_id: 'aaaaaaaa-0000-0000-0000-000000000001',
      title: title.trim(),
      description: description.trim() || null,
      priority,
      due_date: dueDate || null,
      assigned_to: assignedTo || null,
      negotiation_id: negotiationId || null,
      status: 'pending',
      created_by: user.id,
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
            <select value={negotiationId} onChange={e => setNegotiationId(e.target.value)}>
              <option value="">Sin proyecto</option>
              {negotiations.map(n => (
                <option key={n.id} value={n.id}>{n.product || n.title}</option>
              ))}
            </select>
          </div>

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