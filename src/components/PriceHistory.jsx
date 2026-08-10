import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { logActivity } from '../lib/activity'
// Mismo patrón que DealMilestones.jsx — reusa .neg-note-input/.neg-milestone-*
// ya definidas en Negotiations.css.

function formatAmount(n) {
  return Number(n).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

// Historial de precio negociado: fecha + valor (+ cantidad, si el workspace
// usa "Volumen") + motivo del cambio — separado de los Hitos (que son pagos
// parciales) porque esto es la evolución del precio/cantidad acordados, no
// el cronograma de cobro.
export default function PriceHistory({ negotiationId, workspaceId, currency, unit, showQuantity, canEdit, onChanged }) {
  const { user } = useAuth()
  const [entries, setEntries] = useState([])
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0])
  const [newValue, setNewValue] = useState('')
  const [newQuantity, setNewQuantity] = useState('')
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(null)

  useEffect(() => { fetchEntries() }, [negotiationId])

  async function fetchEntries() {
    const { data, error } = await supabase.from('negotiation_price_history').select('*')
      .eq('negotiation_id', negotiationId)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) console.error('fetchPriceHistory error:', error.message)
    if (data) setEntries(data)
  }

  async function handleAdd() {
    const value = parseFloat(newValue)
    if (!newDate || Number.isNaN(value)) return
    const quantity = showQuantity && newQuantity ? parseFloat(newQuantity) : null
    setSaving(true)
    const { error } = await supabase.from('negotiation_price_history').insert({
      workspace_id: workspaceId,
      negotiation_id: negotiationId,
      entry_date: newDate,
      value,
      quantity,
      note: newNote.trim() || null,
    })
    if (error) { console.error('addPriceHistory error:', error.message); setSaving(false); return }
    await logActivity(supabase, {
      workspaceId, negotiationId, type: 'price_updated',
      title: `Precio actualizado: ${formatAmount(value)}${currency ? ` ${currency}` : ''}${unit ? `/${unit}` : ''}`,
      actorId: user?.id,
    })
    setNewValue('')
    setNewQuantity('')
    setNewNote('')
    setSaving(false)
    fetchEntries()
    onChanged?.()
  }

  async function handleDelete(id) {
    await supabase.from('negotiation_price_history').delete().eq('id', id)
    setEntries(prev => prev.filter(e => e.id !== id))
    onChanged?.()
  }

  function startEdit(e) {
    setEditingId(e.id)
    setEditForm({
      entry_date: e.entry_date,
      value: String(e.value),
      quantity: e.quantity !== null ? String(e.quantity) : '',
      note: e.note || '',
    })
  }

  async function handleSaveEdit(id) {
    const value = parseFloat(editForm.value)
    if (!editForm.entry_date || Number.isNaN(value)) return
    const patch = {
      entry_date: editForm.entry_date,
      value,
      quantity: showQuantity && editForm.quantity ? parseFloat(editForm.quantity) : null,
      note: editForm.note.trim() || null,
    }
    await supabase.from('negotiation_price_history').update(patch).eq('id', id)
    setEntries(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e).sort((a, b) => b.entry_date.localeCompare(a.entry_date)))
    setEditingId(null)
    setEditForm(null)
    onChanged?.()
  }

  const latest = entries[0]
  const oldest = entries[entries.length - 1]
  const pctChange = latest && oldest && latest.id !== oldest.id && Number(oldest.value) !== 0
    ? ((Number(latest.value) - Number(oldest.value)) / Number(oldest.value)) * 100
    : null

  return (
    <div>
      {latest && (
        <div className="price-history-summary">
          <div>
            <span className="price-history-current">
              {formatAmount(latest.value)}{currency ? ` ${currency}` : ''}{unit ? ` / ${unit}` : ''}
            </span>
            {showQuantity && latest.quantity && (
              <span className="price-history-total">
                {formatAmount(latest.quantity)}{unit ? ` ${unit}` : ''} → {formatAmount(latest.value * latest.quantity)}{currency ? ` ${currency}` : ''} de este cierre
              </span>
            )}
          </div>
          {pctChange !== null && (
            <span className={`price-history-delta ${pctChange < 0 ? 'price-history-delta--down' : pctChange > 0 ? 'price-history-delta--up' : ''}`}>
              {pctChange < 0 ? '▼' : pctChange > 0 ? '▲' : '·'} {Math.abs(pctChange).toFixed(1)}% desde la primera entrada
            </span>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <p className="detail-empty">Sin cambios de precio registrados todavía.</p>
      ) : (
        <div className="neg-tasks-list">
          {entries.map(e => {
            const isEditing = editingId === e.id
            if (isEditing) {
              return (
                <div key={e.id} className="neg-task-row neg-milestone-edit-row">
                  <input
                    type="date"
                    className="neg-note-date-input neg-milestone-date-input"
                    value={editForm.entry_date}
                    onChange={ev => setEditForm(f => ({ ...f, entry_date: ev.target.value }))}
                  />
                  <input
                    type="number"
                    className="neg-note-date-input neg-milestone-amount-input"
                    value={editForm.value}
                    onChange={ev => setEditForm(f => ({ ...f, value: ev.target.value }))}
                    step="0.01"
                  />
                  {showQuantity && (
                    <input
                      type="number"
                      className="neg-note-date-input neg-milestone-amount-input"
                      placeholder={`Cantidad (${unit || ''})`}
                      value={editForm.quantity}
                      onChange={ev => setEditForm(f => ({ ...f, quantity: ev.target.value }))}
                      step="0.01"
                    />
                  )}
                  <input
                    type="text"
                    className="neg-note-input neg-milestone-timing-input"
                    placeholder="Motivo del cambio..."
                    value={editForm.note}
                    onChange={ev => setEditForm(f => ({ ...f, note: ev.target.value }))}
                  />
                  <button className="neg-add-task-btn" onClick={() => handleSaveEdit(e.id)}>Guardar</button>
                  <button className="neg-milestone-delete" onClick={() => { setEditingId(null); setEditForm(null) }} title="Cancelar">✕</button>
                </div>
              )
            }
            return (
              <div key={e.id} className="neg-task-row">
                <span className="neg-task-date">{new Date(e.entry_date + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}</span>
                <span className="neg-milestone-amount">
                  {formatAmount(e.value)}{currency ? ` ${currency}` : ''}{unit ? `/${unit}` : ''}
                </span>
                <div className="neg-task-body">
                  <span className="neg-task-title">
                    {showQuantity && e.quantity ? `${formatAmount(e.quantity)} ${unit || ''} — ` : ''}{e.note || '—'}
                  </span>
                </div>
                {canEdit && (
                  <>
                    <button className="neg-milestone-edit" onClick={() => startEdit(e)} title="Editar">✏️</button>
                    <button className="neg-milestone-delete" onClick={() => handleDelete(e.id)} title="Eliminar">✕</button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {canEdit && (
        <div className="neg-milestone-add">
          <input
            type="date"
            className="neg-note-date-input neg-milestone-date-input"
            value={newDate}
            onChange={e => setNewDate(e.target.value)}
          />
          <input
            type="number"
            className="neg-note-date-input neg-milestone-amount-input"
            placeholder="Valor"
            value={newValue}
            onChange={e => setNewValue(e.target.value)}
            step="0.01"
          />
          {showQuantity && (
            <input
              type="number"
              className="neg-note-date-input neg-milestone-amount-input"
              placeholder={`Cantidad (${unit || 'unidad de medida'})`}
              value={newQuantity}
              onChange={e => setNewQuantity(e.target.value)}
              step="0.01"
            />
          )}
          <input
            type="text"
            className="neg-note-input neg-milestone-timing-input"
            placeholder="Motivo del cambio..."
            value={newNote}
            onChange={e => setNewNote(e.target.value)}
          />
          <button className="neg-add-task-btn" onClick={handleAdd} disabled={saving || !newDate || !newValue}>
            + Agregar
          </button>
        </div>
      )}
    </div>
  )
}
