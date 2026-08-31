import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { logActivity } from '../lib/activity'
import { notifyTaskAssigned } from '../lib/tasks'
import { getApprovalRule, isApprover as isApproverFor } from '../lib/approvals'
import SearchableSelect from './SearchableSelect'
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
export default function PriceHistory({ negotiationId, workspaceId, negotiationTitle, currency, unit, showQuantity, products = [], canEdit, onChanged }) {
  const { user, activeWorkspace } = useAuth()
  const commissionRule = getApprovalRule(activeWorkspace, 'commission')
  const approvalThreshold = commissionRule?.threshold_numeric
  const approverId = commissionRule?.approver_id
  const approvalEnabled = !!(commissionRule?.enabled && approvalThreshold !== null && approvalThreshold !== undefined && approverId)
  const isApprover = isApproverFor(activeWorkspace, 'commission', user?.id)
  const [entries, setEntries] = useState([])
  // Fecha/producto/motivo son compartidos por toda la cotización — una
  // misma cotización puede traer varias presentaciones (líneas) del mismo
  // producto, cada una con su propio precio/volumen/presentación.
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0])
  const [newProductId, setNewProductId] = useState('')
  const [newNote, setNewNote] = useState('')
  const [lineValue, setLineValue] = useState('')
  const [lineQuantity, setLineQuantity] = useState('')
  const [linePresentation, setLinePresentation] = useState('')
  const [lineCommission, setLineCommission] = useState('')
  const [stagedLines, setStagedLines] = useState([]) // [{ value, quantity, presentation, commissionPct }]
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const needsProductPicker = products.length > 1
  const presentationSuggestions = [...new Set(entries.map(e => e.presentation).filter(Boolean))]

  useEffect(() => { fetchEntries() }, [negotiationId])

  function computeApprovalStatus(commissionPct) {
    if (!approvalEnabled || commissionPct === null || commissionPct === undefined) return null
    return commissionPct > approvalThreshold ? 'pending' : null
  }

  async function createApprovalTask(priceHistoryId, commissionPct) {
    const { data: task } = await supabase.from('tasks')
      .insert({
        workspace_id: workspaceId,
        negotiation_id: negotiationId,
        price_history_id: priceHistoryId,
        title: `Aprobar comisión ${formatAmount(commissionPct)}%${negotiationTitle ? ` — ${negotiationTitle}` : ''}`,
        assigned_to: approverId,
        status: 'pending',
        priority: 'high',
        created_by: user?.id,
      })
      .select('id, title, assigned_to').single()
    if (task) await notifyTaskAssigned(supabase, { workspaceId, task, assignedTo: task.assigned_to, actingUserId: user?.id })
    await logActivity(supabase, {
      workspaceId, negotiationId, type: 'commission_approval_requested',
      title: `Comisión ${formatAmount(commissionPct)}% pendiente de aprobación`, actorId: user?.id,
    })
  }

  async function handleApprove(entry) {
    await supabase.from('negotiation_price_history')
      .update({ commission_approval_status: 'approved', commission_approved_by: user?.id, commission_approved_at: new Date().toISOString() })
      .eq('id', entry.id)
    await supabase.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('price_history_id', entry.id).eq('status', 'pending')
    await logActivity(supabase, {
      workspaceId, negotiationId, type: 'commission_approval_resolved',
      title: `Comisión ${formatAmount(entry.commission_pct)}% aprobada`, actorId: user?.id,
    })
    setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, commission_approval_status: 'approved', commission_approved_by: user?.id } : e))
    onChanged?.()
  }

  async function handleReject(entry) {
    await supabase.from('negotiation_price_history')
      .update({ commission_approval_status: 'rejected', commission_approved_by: user?.id, commission_approved_at: new Date().toISOString() })
      .eq('id', entry.id)
    await supabase.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('price_history_id', entry.id).eq('status', 'pending')
    await logActivity(supabase, {
      workspaceId, negotiationId, type: 'commission_approval_resolved',
      title: `Comisión ${formatAmount(entry.commission_pct)}% rechazada`, actorId: user?.id,
    })
    setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, commission_approval_status: 'rejected', commission_approved_by: user?.id } : e))
    onChanged?.()
  }

  async function fetchEntries() {
    const { data, error } = await supabase.from('negotiation_price_history').select('*')
      .eq('negotiation_id', negotiationId)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) console.error('fetchPriceHistory error:', error.message)
    if (data) setEntries(data)
  }

  function addLine() {
    const value = parseFloat(lineValue)
    if (Number.isNaN(value)) return
    setStagedLines(prev => [...prev, {
      value,
      quantity: showQuantity && lineQuantity ? parseFloat(lineQuantity) : null,
      presentation: linePresentation.trim() || null,
      commissionPct: lineCommission ? parseFloat(lineCommission) : null,
    }])
    setLineValue('')
    setLineQuantity('')
    setLinePresentation('')
    setLineCommission('')
  }

  function removeLine(idx) {
    setStagedLines(prev => prev.filter((_, i) => i !== idx))
  }

  function clearCotizacion() {
    setStagedLines([])
    setLineValue('')
    setLineQuantity('')
    setLinePresentation('')
    setLineCommission('')
    setNewNote('')
    setNewProductId('')
  }

  async function handleSave() {
    // La línea que quedó escrita pero sin "+ Agregar" todavía cuenta —
    // así el caso de una sola presentación sigue siendo "completar y
    // guardar" sin el paso extra de apilarla primero.
    const lines = [...stagedLines]
    const pendingValue = parseFloat(lineValue)
    if (!Number.isNaN(pendingValue)) {
      lines.push({
        value: pendingValue,
        quantity: showQuantity && lineQuantity ? parseFloat(lineQuantity) : null,
        presentation: linePresentation.trim() || null,
        commissionPct: lineCommission ? parseFloat(lineCommission) : null,
      })
    }
    if (!newDate || lines.length === 0) return
    if (needsProductPicker && !newProductId) return
    setSaving(true)
    const { data: inserted, error } = await supabase.from('negotiation_price_history').insert(lines.map(l => ({
      workspace_id: workspaceId,
      negotiation_id: negotiationId,
      entry_date: newDate,
      value: l.value,
      quantity: l.quantity,
      note: newNote.trim() || null,
      product_id: newProductId || null,
      presentation: l.presentation,
      commission_pct: l.commissionPct,
      commission_approval_status: computeApprovalStatus(l.commissionPct),
    }))).select('id, commission_pct, commission_approval_status')
    if (error) { console.error('addPriceHistory error:', error.message); setSaving(false); return }
    for (const row of inserted || []) {
      if (row.commission_approval_status === 'pending') await createApprovalTask(row.id, row.commission_pct)
    }
    const title = lines.length === 1
      ? `Precio actualizado: ${formatAmount(lines[0].value)}${currency ? ` ${currency}` : ''}${unit ? `/${unit}` : ''}`
      : `Cotización actualizada: ${lines.length} presentaciones`
    await logActivity(supabase, { workspaceId, negotiationId, type: 'price_updated', title, actorId: user?.id })
    clearCotizacion()
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
      commission_pct: e.commission_pct !== null && e.commission_pct !== undefined ? String(e.commission_pct) : '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditForm(null)
  }

  function clearLine() {
    setLineValue('')
    setLineQuantity('')
    setLinePresentation('')
    setLineCommission('')
  }

  // Enter apila la línea actual (para seguir cargando otra presentación de
  // la misma cotización); Esc descarta solo la línea en curso, no las que
  // ya se apilaron — stopPropagation para que no se propague y cierre de
  // paso el modal grande que contiene esto.
  function handleLineKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); addLine() }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); clearLine() }
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
      commission_pct: editForm.commission_pct ? parseFloat(editForm.commission_pct) : null,
    }
    const previous = entries.find(e => e.id === id)
    const newStatus = computeApprovalStatus(patch.commission_pct)
    // Solo se re-evalúa si cambió el % — si ya estaba aprobada/rechazada y
    // el % no se tocó, no hace falta pedir aprobación de nuevo por editar
    // otro campo (fecha, nota, etc.)
    if (previous && Number(previous.commission_pct) !== Number(patch.commission_pct)) {
      patch.commission_approval_status = newStatus
      patch.commission_approved_by = null
      patch.commission_approved_at = null
    }
    await supabase.from('negotiation_price_history').update(patch).eq('id', id)
    if (patch.commission_approval_status === 'pending' && previous?.commission_approval_status !== 'pending') {
      await createApprovalTask(id, patch.commission_pct)
    }
    setEntries(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e).sort((a, b) => b.entry_date.localeCompare(a.entry_date)))
    setEditingId(null)
    setEditForm(null)
    onChanged?.()
  }

  // Una cotización es una sola, tenga 1 o 20 productos/presentaciones —
  // "el precio vigente" no puede ser solo la fila más nueva del historial
  // completo, porque si se actualiza el precio de UN producto/presentación,
  // los demás quedan con su último precio vigente igual y tienen que
  // seguir viéndose acá (antes se perdían de la vista al quedar "atrás"
  // en el historial). Se agrupa por (product_id, presentation) y de cada
  // grupo se toma la entrada más nueva y la más vieja — entries ya viene
  // ordenado entry_date desc/created_at desc (fetchEntries).
  function groupKey(e) { return `${e.product_id || 'none'}::${e.presentation || ''}` }
  const current = []
  const seenCurrent = new Set()
  for (const e of entries) {
    const key = groupKey(e)
    if (!seenCurrent.has(key)) { seenCurrent.add(key); current.push(e) }
  }
  const oldestByGroup = new Map()
  for (let i = entries.length - 1; i >= 0; i--) {
    const key = groupKey(entries[i])
    if (!oldestByGroup.has(key)) oldestByGroup.set(key, entries[i])
  }
  function pctChangeFor(e) {
    const oldest = oldestByGroup.get(groupKey(e))
    if (!oldest || oldest.id === e.id || Number(oldest.value) === 0) return null
    return ((Number(e.value) - Number(oldest.value)) / Number(oldest.value)) * 100
  }
  function labelFor(e) {
    const productName = e.product_id ? products.find(p => p.id === e.product_id)?.name : null
    return [productName, e.presentation].filter(Boolean).join(' — ')
  }

  return (
    <div>
      {current.length > 0 && (
        <div className="price-history-summary">
          {current.length > 1 && <p className="price-history-summary-title">Precio vigente ({current.length} presentaciones)</p>}
          {current.map(e => {
            const pctChange = pctChangeFor(e)
            const label = labelFor(e)
            return (
              <div key={e.id} className="price-history-current-row">
                <div>
                  {label && <span className="price-history-current-label">{label}</span>}
                  <span className="price-history-current">
                    {formatAmount(e.value)}{currency ? ` ${currency}` : ''}{unit ? ` / ${unit}` : ''}
                  </span>
                  {showQuantity && e.quantity && (
                    <span className="price-history-total">
                      A partir de {formatAmount(e.quantity)}{unit ? ` ${unit}` : ''} — mínimo de compra: {formatAmount(e.value * e.quantity)}{currency ? ` ${currency}` : ''}
                    </span>
                  )}
                </div>
                {pctChange !== null && (
                  <span className={`price-history-delta ${pctChange < 0 ? 'price-history-delta--down' : pctChange > 0 ? 'price-history-delta--up' : ''}`}>
                    {pctChange < 0 ? '▼' : pctChange > 0 ? '▲' : '·'} {Math.abs(pctChange).toFixed(1)}% desde la primera entrada
                  </span>
                )}
              </div>
            )
          })}
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
                    <SearchableSelect
                      style={{ width: 160, minWidth: 160, flexShrink: 0 }}
                      value={editForm.product_id}
                      onChange={v => setEditForm(f => ({ ...f, product_id: v }))}
                      options={products.map(p => ({ value: p.id, label: p.name }))}
                      placeholder="Producto..."
                      emptyLabel="Sin producto"
                    />
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
                    type="number"
                    className="neg-note-date-input neg-milestone-amount-input"
                    placeholder="Comisión %"
                    value={editForm.commission_pct}
                    onChange={ev => setEditForm(f => ({ ...f, commission_pct: ev.target.value }))}
                    onKeyDown={ev => handleEditKeyDown(ev, e.id)}
                    step="0.01"
                    min="0"
                    max="100"
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
                  {e.commission_pct !== null && e.commission_pct !== undefined && (
                    <span className="neg-milestone-timing-inline">
                      Comisión {formatAmount(e.commission_pct)}%
                      {e.commission_approval_status === 'pending' && <span className="commission-approval-badge commission-approval-badge--pending">⏳ Pendiente de aprobación</span>}
                      {e.commission_approval_status === 'approved' && <span className="commission-approval-badge commission-approval-badge--approved">✓ Aprobada</span>}
                      {e.commission_approval_status === 'rejected' && <span className="commission-approval-badge commission-approval-badge--rejected">✕ Rechazada</span>}
                    </span>
                  )}
                </span>
                <div className="neg-task-body">
                  <span className="neg-task-title">
                    {e.presentation ? `${e.presentation} — ` : ''}
                    {showQuantity && e.quantity ? `A partir de ${formatAmount(e.quantity)} ${unit || ''} — ` : ''}{e.note || '—'}
                  </span>
                </div>
                {isApprover && e.commission_approval_status === 'pending' && (
                  <>
                    <button className="neg-milestone-edit" onClick={() => handleApprove(e)} title="Aprobar">✓ Aprobar</button>
                    <button className="neg-milestone-delete" onClick={() => handleReject(e)} title="Rechazar">✕ Rechazar</button>
                  </>
                )}
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
          El precio es por unidad ({unit || 'unidad de medida'}); el volumen mínimo es a partir de cuánto aplica ese precio. Si en la misma cotización hay más de una presentación (ej: x20 comp, x10 comp...), agregalas todas antes de guardar — quedan con la misma fecha y motivo.
        </p>
      )}
      {canEdit && (
        <div className="price-history-cotizacion">
          <div className="neg-milestone-add">
            <input
              type="date"
              className="neg-note-date-input neg-milestone-date-input"
              value={newDate}
              onChange={e => setNewDate(e.target.value)}
            />
            {needsProductPicker && (
              <SearchableSelect
                style={{ width: 160, minWidth: 160, flexShrink: 0 }}
                value={newProductId}
                onChange={setNewProductId}
                options={products.map(p => ({ value: p.id, label: p.name }))}
                placeholder="Producto..."
                emptyLabel="Sin producto"
              />
            )}
            <input
              type="text"
              className="neg-note-input neg-milestone-timing-input"
              placeholder="Motivo del cambio (aplica a toda la cotización)..."
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
            />
          </div>

          {stagedLines.length > 0 && (
            <div className="price-history-staged-list">
              {stagedLines.map((l, idx) => (
                <div key={idx} className="price-history-staged-row">
                  <span className="price-history-staged-presentation">{l.presentation || 'Sin presentación'}</span>
                  <span className="price-history-staged-value">
                    {formatAmount(l.value)}{currency ? ` ${currency}` : ''}{unit ? `/${unit}` : ''}
                    {showQuantity && l.quantity ? ` · desde ${formatAmount(l.quantity)} ${unit || ''}` : ''}
                    {l.commissionPct !== null && l.commissionPct !== undefined ? ` · Comisión ${formatAmount(l.commissionPct)}%` : ''}
                  </span>
                  <button type="button" className="neg-milestone-delete" onClick={() => removeLine(idx)} title="Quitar">✕</button>
                </div>
              ))}
            </div>
          )}

          <div className="neg-milestone-add">
            <input
              type="number"
              className="neg-note-date-input neg-milestone-amount-input"
              placeholder={`Precio${unit ? ` por ${unit}` : ' por unidad'}`}
              value={lineValue}
              onChange={e => setLineValue(e.target.value)}
              onKeyDown={handleLineKeyDown}
              step="0.01"
            />
            {showQuantity && (
              <input
                type="number"
                className="neg-note-date-input neg-milestone-amount-input"
                placeholder={`Volumen mínimo (${unit || 'unidad de medida'})`}
                value={lineQuantity}
                onChange={e => setLineQuantity(e.target.value)}
                onKeyDown={handleLineKeyDown}
                step="0.01"
              />
            )}
            <input
              type="text"
              className="neg-note-input neg-milestone-timing-input"
              placeholder="Presentación (opcional)"
              list="price-history-presentations"
              value={linePresentation}
              onChange={e => setLinePresentation(e.target.value)}
              onKeyDown={handleLineKeyDown}
            />
            <input
              type="number"
              className="neg-note-date-input neg-milestone-amount-input"
              placeholder="Comisión % (opcional)"
              value={lineCommission}
              onChange={e => setLineCommission(e.target.value)}
              onKeyDown={handleLineKeyDown}
              step="0.01"
              min="0"
              max="100"
            />
            <datalist id="price-history-presentations">
              {presentationSuggestions.map(p => <option key={p} value={p} />)}
            </datalist>
            <button type="button" className="price-history-add-line-btn" onClick={addLine} disabled={!lineValue} title="Agregar otra presentación a esta cotización">
              + Otra presentación
            </button>
            <button
              className="neg-add-task-btn"
              onClick={handleSave}
              disabled={saving || !newDate || (stagedLines.length === 0 && !lineValue) || (needsProductPicker && !newProductId)}
            >
              Guardar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
