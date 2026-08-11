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
//
// `products` (opcional) es la lista de productos vinculados a esta
// negociación — si hay más de uno, cada entrada tiene que aclarar a cuál
// corresponde (si no, quedaría ambiguo para el panorama comercial del
// producto). `presentation` es texto libre siempre disponible — variantes/
// SKUs concurrentes del mismo producto en el mismo cierre (ej. "x20 comp"
// vs "x10 comp" de Ibupirac), no una fecha distinta.
export default function PriceHistory({ negotiationId, workspaceId, currency, unit, showQuantity, products = [], canEdit, onChanged }) {
  const { user } = useAuth()
  const [entries, setEntries] = useState([])
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0])
  const [newValue, setNewValue] = useState('')
  const [newQuantity, setNewQuantity] = useState('')
  const [newNote, setNewNote] = useState('')
  const [newProductId, setNewProductId] = useState('')
  const [newPresentation, setNewPresentation] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const needsProductPicker = products.length > 1
  const presentationSuggestions = [...new Set(entries.map(e => e.presentation).filter(Boolean))]

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
    if (needsProductPicker && !newProductId) return
    const quantity = showQuantity && newQuantity ? parseFloat(newQuantity) : null
    setSaving(true)
    const { error } = await supabase.from('negotiation_price_history').insert({
      workspace_id: workspaceId,
      negotiation_id: negotiationId,
      entry_date: newDate,
      value,
      quantity,
      note: newNote.trim() || null,
      product_id: newProductId || null,
      presentation: newPresentation.trim() || null,
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
    setNewProductId('')
    setNewPresentation('')
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
      product_id: e.product_id || '',
      presentation: e.presentation || '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditForm(null)
  }

  function clearAddForm() {
    setNewValue('')
    setNewQuantity('')
    setNewNote('')
    setNewProductId('')
    setNewPresentation('')
  }

  // Enter guarda, Esc cancela sin guardar — stopPropagation para que el Esc
  // no se propague y cierre de paso el modal grande que contiene esto.
  function handleAddKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); handleAdd() }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); clearAddForm() }
  }

  function handleEditKeyDown(e, id) {
    if (e.key === 'Enter') { e.preventDefault(); handleSaveEdit(id) }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit() }
  }

  async function handleSaveEdit(id) {
    const value = parseFloat(editForm.value)
    if (!editForm.entry_date || Number.isNaN(value)) return
    if (needsProductPicker && !editForm.product_id) return
    const patch = {
      entry_date: editForm.entry_date,
      value,
      quantity: showQuantity && editForm.quantity ? parseFloat(editForm.quantity) : null,
      note: editForm.note.trim() || null,
      product_id: editForm.product_id || null,
      presentation: editForm.presentation.trim() || null,
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
                A partir de {formatAmount(latest.quantity)}{unit ? ` ${unit}` : ''} — mínimo de compra: {formatAmount(latest.value * latest.quantity)}{currency ? ` ${currency}` : ''}
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
                    onKeyDown={ev => handleEditKeyDown(ev, e.id)}
                    autoFocus
                  />
                  {needsProductPicker && (
                    <select
                      className="neg-note-date-input"
                      value={editForm.product_id}
                      onChange={ev => setEditForm(f => ({ ...f, product_id: ev.target.value }))}
                    >
                      <option value="">Producto...</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  )}
                  <input
                    type="number"
                    className="neg-note-date-input neg-milestone-amount-input"
                    placeholder={`Precio${unit ? ` por ${unit}` : ''}`}
                    value={editForm.value}
                    onChange={ev => setEditForm(f => ({ ...f, value: ev.target.value }))}
                    onKeyDown={ev => handleEditKeyDown(ev, e.id)}
                    step="0.01"
                  />
                  {showQuantity && (
                    <input
                      type="number"
                      className="neg-note-date-input neg-milestone-amount-input"
                      placeholder={`Volumen mínimo${unit ? ` (${unit})` : ''}`}
                      value={editForm.quantity}
                      onChange={ev => setEditForm(f => ({ ...f, quantity: ev.target.value }))}
                      onKeyDown={ev => handleEditKeyDown(ev, e.id)}
                      step="0.01"
                    />
                  )}
                  <input
                    type="text"
                    className="neg-note-input neg-milestone-timing-input"
                    placeholder="Presentación (opcional)"
                    list="price-history-presentations"
                    value={editForm.presentation}
                    onChange={ev => setEditForm(f => ({ ...f, presentation: ev.target.value }))}
                    onKeyDown={ev => handleEditKeyDown(ev, e.id)}
                  />
                  <input
                    type="text"
                    className="neg-note-input neg-milestone-timing-input"
                    placeholder="Motivo del cambio..."
                    value={editForm.note}
                    onChange={ev => setEditForm(f => ({ ...f, note: ev.target.value }))}
                    onKeyDown={ev => handleEditKeyDown(ev, e.id)}
                  />
                  <button className="neg-add-task-btn" onClick={() => handleSaveEdit(e.id)}>Guardar</button>
                  <button className="neg-milestone-delete" onClick={cancelEdit} title="Cancelar">✕</button>
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
                    {e.presentation ? `${e.presentation} — ` : ''}
                    {showQuantity && e.quantity ? `A partir de ${formatAmount(e.quantity)} ${unit || ''} — ` : ''}{e.note || '—'}
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

      {canEdit && showQuantity && (
        <p className="neg-financiero-meta">
          El precio es por unidad ({unit || 'unidad de medida'}); el volumen mínimo es a partir de cuánto aplica ese precio — cargá una fila por cada quiebre de precio (ej: 1 {unit || 'kg'} → 500 {unit || 'kg'} → 1.000 {unit || 'kg'}).
        </p>
      )}
      {canEdit && (
        <div className="neg-milestone-add">
          <input
            type="date"
            className="neg-note-date-input neg-milestone-date-input"
            value={newDate}
            onChange={e => setNewDate(e.target.value)}
            onKeyDown={handleAddKeyDown}
          />
          {needsProductPicker && (
            <select
              className="neg-note-date-input"
              value={newProductId}
              onChange={e => setNewProductId(e.target.value)}
            >
              <option value="">Producto...</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <input
            type="number"
            className="neg-note-date-input neg-milestone-amount-input"
            placeholder={`Precio${unit ? ` por ${unit}` : ' por unidad'}`}
            value={newValue}
            onChange={e => setNewValue(e.target.value)}
            onKeyDown={handleAddKeyDown}
            step="0.01"
          />
          {showQuantity && (
            <input
              type="number"
              className="neg-note-date-input neg-milestone-amount-input"
              placeholder={`Volumen mínimo (${unit || 'unidad de medida'})`}
              value={newQuantity}
              onChange={e => setNewQuantity(e.target.value)}
              onKeyDown={handleAddKeyDown}
              step="0.01"
            />
          )}
          <input
            type="text"
            className="neg-note-input neg-milestone-timing-input"
            placeholder="Presentación (opcional)"
            list="price-history-presentations"
            value={newPresentation}
            onChange={e => setNewPresentation(e.target.value)}
            onKeyDown={handleAddKeyDown}
          />
          <datalist id="price-history-presentations">
            {presentationSuggestions.map(p => <option key={p} value={p} />)}
          </datalist>
          <input
            type="text"
            className="neg-note-input neg-milestone-timing-input"
            placeholder="Motivo del cambio..."
            value={newNote}
            onChange={e => setNewNote(e.target.value)}
            onKeyDown={handleAddKeyDown}
          />
          <button className="neg-add-task-btn" onClick={handleAdd} disabled={saving || !newDate || !newValue || (needsProductPicker && !newProductId)}>
            + Agregar
          </button>
        </div>
      )}
    </div>
  )
}
