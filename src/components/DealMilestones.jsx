import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { logActivity } from '../lib/activity'
// Reusa clases .neg-note-input/.neg-add-task-btn/.neg-tasks-list/.neg-task-row/.detail-empty
// ya definidas en Negotiations.css.

export function formatAmount(n) {
  return Number(n).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

// Cuándo se espera un hito: fecha exacta si se conoce, o una referencia de
// texto libre si no ("al momento del lanzamiento", "a la firma del contrato")
export function formatTiming(m) {
  const parts = []
  if (m.estimated_date) parts.push(new Date(m.estimated_date + 'T00:00:00').toLocaleDateString('es-AR'))
  if (m.timing_note) parts.push(m.timing_note)
  return parts.join(' · ')
}

// Desglose de hitos de pago de un proyecto (upfront, milestones, royalties,
// pagos a terceros, lo que sea) — cada uno es una fila libre con nombre +
// monto + fecha (o referencia de texto, si no hay fecha exacta). El monto
// admite negativos (pagos que salen, no solo cobros) para que el total
// refleje el valor neto del deal.
export default function DealMilestones({ negotiationId, workspaceId, currency, canEdit, onChanged }) {
  const { user } = useAuth()
  const [milestones, setMilestones] = useState([])
  const [newName, setNewName] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [newDate, setNewDate] = useState('')
  const [newTiming, setNewTiming] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(null)

  useEffect(() => { fetchMilestones() }, [negotiationId])

  // Los que tienen fecha estimada van en orden cronológico; los que no,
  // detrás de esos, en el orden en que se cargaron (confirmado con el
  // usuario probando el feature).
  async function fetchMilestones() {
    const { data, error } = await supabase.from('deal_milestones').select('*')
      .eq('negotiation_id', negotiationId)
      .order('estimated_date', { ascending: true, nullsFirst: false })
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
      timing_note: newTiming.trim() || null,
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
    setNewTiming('')
    setSaving(false)
    fetchMilestones()
    onChanged?.()
  }

  async function handleDelete(id) {
    await supabase.from('deal_milestones').delete().eq('id', id)
    setMilestones(prev => prev.filter(m => m.id !== id))
    onChanged?.()
  }

  function startEdit(m) {
    setEditingId(m.id)
    setEditForm({
      name: m.name,
      amount: String(m.amount),
      estimated_date: m.estimated_date || '',
      timing_note: m.timing_note || '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditForm(null)
  }

  function clearAddForm() {
    setNewName('')
    setNewAmount('')
    setNewDate('')
    setNewTiming('')
  }

  // Enter guarda, Esc cancela sin guardar — el stopPropagation evita que el
  // Esc se propague y cierre de paso el modal grande que contiene esto.
  function handleAddKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); handleAdd() }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); clearAddForm() }
  }

  function handleEditKeyDown(e, id) {
    if (e.key === 'Enter') { e.preventDefault(); handleSaveEdit(id) }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit() }
  }

  async function handleSaveEdit(id) {
    const amount = parseFloat(editForm.amount)
    if (!editForm.name.trim() || Number.isNaN(amount) || amount === 0) return
    const patch = {
      name: editForm.name.trim(),
      amount,
      estimated_date: editForm.estimated_date || null,
      timing_note: editForm.timing_note.trim() || null,
    }
    await supabase.from('deal_milestones').update(patch).eq('id', id)
    setEditingId(null)
    setEditForm(null)
    fetchMilestones() // re-fetch en vez de patchear en memoria: puede haber cambiado la fecha, y con eso el orden
    onChanged?.()
  }

  const total = milestones.reduce((sum, m) => sum + Number(m.amount), 0)

  return (
    <div>
      {milestones.length === 0 ? (
        <p className="detail-empty">Sin hitos de pago todavía.</p>
      ) : (
        <div className="neg-tasks-list">
          {milestones.map(m => {
            const isEditing = editingId === m.id
            if (isEditing) {
              return (
                <div key={m.id} className="neg-task-row neg-milestone-edit-row">
                  <input
                    type="text"
                    className="neg-note-input neg-milestone-name-input"
                    value={editForm.name}
                    onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                    onKeyDown={e => handleEditKeyDown(e, m.id)}
                    autoFocus
                  />
                  <input
                    type="number"
                    className="neg-note-date-input neg-milestone-amount-input"
                    value={editForm.amount}
                    onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))}
                    onKeyDown={e => handleEditKeyDown(e, m.id)}
                    step="0.01"
                  />
                  <input
                    type="date"
                    className="neg-note-date-input neg-milestone-date-input"
                    value={editForm.estimated_date}
                    onChange={e => setEditForm(f => ({ ...f, estimated_date: e.target.value }))}
                    onKeyDown={e => handleEditKeyDown(e, m.id)}
                  />
                  <input
                    type="text"
                    className="neg-note-input neg-milestone-timing-input"
                    placeholder="Momento (si no hay fecha exacta)"
                    value={editForm.timing_note}
                    onChange={e => setEditForm(f => ({ ...f, timing_note: e.target.value }))}
                    onKeyDown={e => handleEditKeyDown(e, m.id)}
                  />
                  <button className="neg-add-task-btn" onClick={() => handleSaveEdit(m.id)}>Guardar</button>
                  <button className="neg-milestone-delete" onClick={cancelEdit} title="Cancelar">✕</button>
                </div>
              )
            }
            const timing = formatTiming(m)
            return (
              <div key={m.id} className="neg-task-row">
                <div className="neg-task-body">
                  <span className="neg-task-title">{m.name}</span>
                  {timing && <span className="neg-milestone-timing-inline">{timing}</span>}
                </div>
                <span className={`neg-milestone-amount ${Number(m.amount) < 0 ? 'neg-milestone-amount--negative' : ''}`}>
                  {formatAmount(m.amount)}{currency ? ` ${currency}` : ''}
                </span>
                {canEdit && (
                  <>
                    <button className="neg-milestone-edit" onClick={() => startEdit(m)} title="Editar hito">✏️</button>
                    <button className="neg-milestone-delete" onClick={() => handleDelete(m.id)} title="Eliminar hito">✕</button>
                  </>
                )}
              </div>
            )
          })}
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
            onKeyDown={handleAddKeyDown}
          />
          <input
            type="number"
            className="neg-note-date-input neg-milestone-amount-input"
            placeholder="Monto (negativo = pago a hacer)"
            value={newAmount}
            onChange={e => setNewAmount(e.target.value)}
            onKeyDown={handleAddKeyDown}
            step="0.01"
          />
          <input
            type="date"
            className="neg-note-date-input neg-milestone-date-input"
            value={newDate}
            onChange={e => setNewDate(e.target.value)}
            onKeyDown={handleAddKeyDown}
          />
          <input
            type="text"
            className="neg-note-input neg-milestone-timing-input"
            placeholder="Momento (si no hay fecha exacta, ej: al lanzamiento)"
            value={newTiming}
            onChange={e => setNewTiming(e.target.value)}
            onKeyDown={handleAddKeyDown}
          />
          <button className="neg-add-task-btn" onClick={handleAdd} disabled={saving || !newName.trim() || !newAmount}>
            + Agregar
          </button>
        </div>
      )}
    </div>
  )
}
