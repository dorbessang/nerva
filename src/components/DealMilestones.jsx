import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { logActivity } from '../lib/activity'
// Reusa clases .neg-note-input/.neg-add-task-btn/.neg-tasks-list/.neg-task-row/.detail-empty
// ya definidas en Negotiations.css.

export function formatAmount(n) {
  return Number(n).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

// Desglose de hitos de pago de un proyecto (upfront, milestones, royalties,
// pagos a terceros, lo que sea) — cada uno es una fila libre con nombre +
// monto + fecha estimada. El monto admite negativos (pagos que salen,
// no solo cobros) para que el total refleje el valor neto del deal.
export default function DealMilestones({ negotiationId, workspaceId, currency, canEdit, onChanged }) {
  const { user } = useAuth()
  const [milestones, setMilestones] = useState([])
  const [newName, setNewName] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [newDate, setNewDate] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchMilestones() }, [negotiationId])

  async function fetchMilestones() {
    const { data, error } = await supabase.from('deal_milestones').select('*')
      .eq('negotiation_id', negotiationId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) console.error('fetchMilestones error:', error.message)
    if (data) setMilestones(data)
  }

  async function handleAdd() {
    const amount = parseFloat(newAmount)
    if (!newName.trim() || Number.isNaN(amount) || amount === 0) return
    setSaving(true)
    const { error } = await supabase.from('deal_milestones').insert({
      workspace_id: workspaceId,
      negotiation_id: negotiationId,
      name: newName.trim(),
      amount,
      estimated_date: newDate || null,
      sort_order: milestones.length,
    })
    if (error) { console.error('addMilestone error:', error.message); setSaving(false); return }
    await logActivity(supabase, {
      workspaceId, negotiationId, type: 'milestone_added',
      title: `Hito agregado: "${newName.trim()}" (${formatAmount(amount)}${currency ? ' ' + currency : ''})`,
      actorId: user?.id,
    })
    setNewName('')
    setNewAmount('')
    setNewDate('')
    setSaving(false)
    fetchMilestones()
    onChanged?.()
  }

  async function handleDelete(id) {
    await supabase.from('deal_milestones').delete().eq('id', id)
    setMilestones(prev => prev.filter(m => m.id !== id))
    onChanged?.()
  }

  const total = milestones.reduce((sum, m) => sum + Number(m.amount), 0)

  return (
    <div>
      {milestones.length === 0 ? (
        <p className="detail-empty">Sin hitos de pago todavía.</p>
      ) : (
        <div className="neg-tasks-list">
          {milestones.map(m => (
            <div key={m.id} className="neg-task-row">
              <div className="neg-task-body">
                <span className="neg-task-title">{m.name}</span>
              </div>
              <span className={`neg-milestone-amount ${Number(m.amount) < 0 ? 'neg-milestone-amount--negative' : ''}`}>
                {formatAmount(m.amount)}{currency ? ` ${currency}` : ''}
              </span>
              {m.estimated_date && (
                <span className="neg-task-date">{new Date(m.estimated_date + 'T00:00:00').toLocaleDateString('es-AR')}</span>
              )}
              {canEdit && (
                <button className="neg-milestone-delete" onClick={() => handleDelete(m.id)} title="Eliminar hito">✕</button>
              )}
            </div>
          ))}
        </div>
      )}
      {milestones.length > 0 && (
        <div className={`neg-milestone-total ${total < 0 ? 'neg-milestone-total--negative' : ''}`}>
          Total: {formatAmount(total)}{currency ? ` ${currency}` : ''}
        </div>
      )}
      {canEdit && (
        <div className="neg-milestone-add">
          <input
            type="text"
            className="neg-note-input neg-milestone-name-input"
            placeholder="Nombre del hito (ej: Upfront, Milestone Fase 2...)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
          />
          <input
            type="number"
            className="neg-note-date-input neg-milestone-amount-input"
            placeholder="Monto (negativo = pago a hacer)"
            value={newAmount}
            onChange={e => setNewAmount(e.target.value)}
            step="0.01"
          />
          <input
            type="date"
            className="neg-note-date-input neg-milestone-date-input"
            value={newDate}
            onChange={e => setNewDate(e.target.value)}
          />
          <button className="neg-add-task-btn" onClick={handleAdd} disabled={saving || !newName.trim() || !newAmount}>
            + Agregar
          </button>
        </div>
      )}
    </div>
  )
}
