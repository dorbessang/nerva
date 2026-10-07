import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { logActivity } from '../lib/activity'
import { notifyTaskAssigned } from '../lib/tasks'
import { useEscapeToClose } from '../lib/useEscapeToClose'
import '../styles/modal.css'
import '../styles/forms.css'
import '../styles/buttons.css'
import '../styles/toggle.css'

// Trigger manual para registrar una llamada/reunión que ya pasó (queda en
// la Bitácora de actividad) o programar una a futuro (crea una tarea con
// fecha/hora, que además ya aparece en la Agenda). Un mismo formulario
// cubre los dos pedidos del usuario: "registrar rápido" y "programar rápido".
export default function LogMeetingModal({ workspaceId, negotiationId, entityId, members = [], onClose, onSaved }) {
  const { user } = useAuth()
  useEscapeToClose(onClose)
  const [mode, setMode] = useState('log') // 'log' (ya pasó) | 'schedule' (a futuro)
  const [kind, setKind] = useState('call') // 'call' | 'meeting'
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [time, setTime] = useState('')
  const [withWho, setWithWho] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [summary, setSummary] = useState('')
  const [saving, setSaving] = useState(false)

  const kindLabel = kind === 'call' ? 'Llamada' : 'Reunión'

  async function handleSave() {
    if (!date) return
    setSaving(true)
    const withPart = withWho.trim() ? ` con ${withWho.trim()}` : ''
    const summaryPart = summary.trim() ? `: ${summary.trim()}` : ''

    if (mode === 'log') {
      await logActivity(supabase, {
        workspaceId, negotiationId, entityId,
        type: kind === 'call' ? 'call_logged' : 'meeting_logged',
        title: `${kindLabel}${withPart}${summaryPart}`,
        actorId: user?.id,
      })
    } else {
      const icon = kind === 'call' ? '📞' : '🤝'
      const { data: task } = await supabase.from('tasks').insert({
        workspace_id: workspaceId,
        negotiation_id: negotiationId || null,
        entity_id: entityId || null,
        title: `${icon} ${kindLabel}${withPart}${summaryPart}`,
        status: 'pending',
        priority: 'medium',
        due_date: date,
        due_time: time || null,
        assigned_to: assignedTo || user?.id || null,
        created_by: user?.id,
      }).select('id, title, assigned_to').single()
      if (task) await notifyTaskAssigned(supabase, { workspaceId, task, assignedTo: task.assigned_to, actingUserId: user?.id })
      await logActivity(supabase, {
        workspaceId, negotiationId, entityId,
        type: kind === 'call' ? 'call_logged' : 'meeting_logged',
        title: `${kindLabel} programada${withPart}${summaryPart} — ${new Date(date + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}${time ? ` ${time}` : ''}`,
        actorId: user?.id,
      })
    }
    setSaving(false)
    onSaved?.()
    onClose()
  }

  function handleSubmit(e) {
    e.preventDefault()
    handleSave()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Registrar / Programar</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit} className="modal-form">
          <div className="log-meeting-toggles">
            <div className="settings-type-toggle">
              <button type="button" className={`settings-toggle-btn ${kind === 'call' ? 'active' : ''}`} onClick={() => setKind('call')}>📞 Llamada</button>
              <button type="button" className={`settings-toggle-btn ${kind === 'meeting' ? 'active' : ''}`} onClick={() => setKind('meeting')}>🤝 Reunión</button>
            </div>
            <div className="settings-type-toggle">
              <button type="button" className={`settings-toggle-btn ${mode === 'log' ? 'active' : ''}`} onClick={() => setMode('log')}>Ya pasó</button>
              <button type="button" className={`settings-toggle-btn ${mode === 'schedule' ? 'active' : ''}`} onClick={() => setMode('schedule')}>Programar</button>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>FECHA</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div className="form-group">
              <label>HORA {mode === 'log' ? '(opcional)' : ''}</label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label>CON QUIÉN (opcional)</label>
            <input type="text" value={withWho} onChange={e => setWithWho(e.target.value)} placeholder="Nombre del contacto..." />
          </div>

          {mode === 'schedule' && members.length > 0 && (
            <div className="form-group">
              <label>ASIGNAR A</label>
              <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
                <option value="">Yo</option>
                {members.map(m => <option key={m.user_id} value={m.user_id}>{m.profile?.full_name || m.profile?.email || 'Usuario'}</option>)}
              </select>
            </div>
          )}

          <div className="form-group">
            <label>{mode === 'log' ? 'RESUMEN (opcional)' : 'MOTIVO (opcional)'}</label>
            <textarea rows={2} value={summary} onChange={e => setSummary(e.target.value)} placeholder={mode === 'log' ? 'De qué se habló...' : 'Para qué es la reunión...'} />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={saving || !date}>
              {saving ? 'Guardando...' : mode === 'log' ? 'Registrar' : 'Programar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
