import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { logActivity } from '../lib/activity'
import Field from './FieldLabel'
import '../styles/detail-panel.css'
import '../styles/detail-tabs.css'

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

// A qué año del deal cae una fecha, contando desde la fecha de inicio (Año 1
// = primeros 365 días desde la firma). Es solo una sugerencia — el período
// real de cada hito se guarda aparte y se puede pisar a mano.
function suggestPeriod(dateStr, startDateStr, duration) {
  if (!dateStr || !startDateStr || !duration) return null
  const start = new Date(startDateStr + 'T00:00:00')
  const d = new Date(dateStr + 'T00:00:00')
  if (Number.isNaN(start.getTime()) || Number.isNaN(d.getTime())) return null
  const diffYears = (d - start) / (1000 * 60 * 60 * 24 * 365.25)
  let period = Math.floor(diffYears) + 1
  if (period < 1) period = 1
  if (period > duration) period = duration
  return period
}

// Desglose de hitos de pago de un proyecto (upfront, milestones, royalties,
// pagos a terceros, lo que sea) — cada uno es una fila libre con nombre +
// monto + fecha (o referencia de texto, si no hay fecha exacta). El monto
// admite negativos (pagos que salen, no solo cobros) para que el total
// refleje el valor neto del deal.
//
// Cuando `showProjection` está prendido (Configuración → Financiero →
// "Valor estimado del deal"), se suma la proyección por año de vida del
// deal: duración + un monto neto esperado por año, contra la cual se
// comparan los hitos reales agrupados por el período que se les asignó.
export default function DealMilestones({ negotiationId, workspaceId, currency, canEdit, onChanged, showProjection, dealStartDate, dealDurationYears, dealTargetValue, onSaveDealMeta }) {
  const { user } = useAuth()
  const [milestones, setMilestones] = useState([])
  const [newName, setNewName] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [newDate, setNewDate] = useState('')
  const [newTiming, setNewTiming] = useState('')
  const [newPeriod, setNewPeriod] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [actionError, setActionError] = useState('')

  const [projections, setProjections] = useState([])
  const [yearInputs, setYearInputs] = useState({})
  const [localTargetValue, setLocalTargetValue] = useState(dealTargetValue != null ? String(dealTargetValue) : '')
  const [localStartDate, setLocalStartDate] = useState(dealStartDate || '')
  const [localDuration, setLocalDuration] = useState(dealDurationYears ? String(dealDurationYears) : '')

  const duration = parseInt(localDuration, 10) || 0
  const periodRange = Array.from({ length: duration }, (_, i) => i + 1)
  const projectedByPeriod = Object.fromEntries(projections.map(p => [p.period_index, Number(p.amount)]))
  const projectedTotal = projections.reduce((sum, p) => sum + Number(p.amount), 0)
  const targetValueNum = localTargetValue !== '' ? parseFloat(localTargetValue) : null
  // Margen chico para no marcar diferencia por puro redondeo de centavos.
  const targetMismatch = targetValueNum != null && !Number.isNaN(targetValueNum) && Math.abs(targetValueNum - projectedTotal) > 0.01

  useEffect(() => {
    fetchMilestones()
    if (showProjection) fetchProjections()
  }, [negotiationId])

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

  async function fetchProjections() {
    const { data, error } = await supabase.from('negotiation_value_projections').select('*')
      .eq('negotiation_id', negotiationId)
    if (error) console.error('fetchProjections error:', error.message)
    if (data) {
      setProjections(data)
      const inputs = {}
      for (const row of data) inputs[row.period_index] = String(row.amount)
      setYearInputs(inputs)
    }
  }

  async function saveProjectionAmount(periodIndex, rawValue) {
    const amount = rawValue === '' || rawValue == null ? 0 : parseFloat(rawValue)
    if (Number.isNaN(amount)) return
    const { error } = await supabase.from('negotiation_value_projections')
      .upsert({ workspace_id: workspaceId, negotiation_id: negotiationId, period_index: periodIndex, amount }, { onConflict: 'negotiation_id,period_index' })
    if (error) { console.error('saveProjection error:', error.message); return }
    setProjections(prev => [...prev.filter(p => p.period_index !== periodIndex), { period_index: periodIndex, amount }])
    onChanged?.()
  }

  // Reparte el total en partes iguales como punto de partida — el ajuste por
  // redondeo se absorbe en el último año para que la suma cierre exacto con
  // el total cargado.
  async function handleSplitEvenly() {
    const total = parseFloat(localTargetValue)
    if (Number.isNaN(total) || duration <= 0) return
    const per = Math.round((total / duration) * 100) / 100
    const amounts = periodRange.map((_, i) =>
      i === periodRange.length - 1 ? Math.round((total - per * (duration - 1)) * 100) / 100 : per
    )
    setYearInputs(v => {
      const next = { ...v }
      periodRange.forEach((p, i) => { next[p] = String(amounts[i]) })
      return next
    })
    for (let i = 0; i < periodRange.length; i++) {
      await saveProjectionAmount(periodRange[i], amounts[i])
    }
  }

  function handleSaveDuration() {
    const parsed = localDuration ? parseInt(localDuration, 10) : null
    onSaveDealMeta?.('deal_duration_years', parsed)
  }

  function handleSaveStartDate() {
    onSaveDealMeta?.('deal_start_date', localStartDate || null)
  }

  function handleSaveTargetValue() {
    onSaveDealMeta?.('deal_target_value', localTargetValue === '' ? null : parseFloat(localTargetValue))
  }

  function handleNewDateChange(value) {
    setNewDate(value)
    const suggested = suggestPeriod(value, localStartDate, duration)
    if (suggested) setNewPeriod(String(suggested))
  }

  function handleEditDateChange(value) {
    setEditForm(f => {
      const suggested = suggestPeriod(value, localStartDate, duration)
      return { ...f, estimated_date: value, period_index: suggested ? String(suggested) : f.period_index }
    })
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
      period_index: newPeriod ? parseInt(newPeriod, 10) : null,
      sort_order: milestones.length,
    })
    if (error) { console.error('addMilestone error:', error.message); setSaving(false); return }
    await logActivity(supabase, {
      workspaceId, negotiationId, type: 'milestone_added',
      title: `Pago agregado: "${newName.trim()}" (${formatAmount(amount)}${currency ? ' ' + currency : ''})`,
      actorId: user?.id,
    })
    setNewName('')
    setNewAmount('')
    setNewDate('')
    setNewTiming('')
    setNewPeriod('')
    setSaving(false)
    fetchMilestones()
    onChanged?.()
  }

  async function handleDelete(id) {
    setActionError('')
    const { error } = await supabase.from('deal_milestones').delete().eq('id', id)
    if (error) { console.error('deleteMilestone error:', error.message); setActionError('No se pudo eliminar el pago. Intentá de nuevo.'); return }
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
      period_index: m.period_index ? String(m.period_index) : '',
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
    setNewPeriod('')
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
    setActionError('')
    const patch = {
      name: editForm.name.trim(),
      amount,
      estimated_date: editForm.estimated_date || null,
      timing_note: editForm.timing_note.trim() || null,
      period_index: editForm.period_index ? parseInt(editForm.period_index, 10) : null,
    }
    const { error } = await supabase.from('deal_milestones').update(patch).eq('id', id)
    if (error) { console.error('saveMilestone error:', error.message); setActionError('No se pudo guardar el pago. Intentá de nuevo.'); return }
    setEditingId(null)
    setEditForm(null)
    fetchMilestones() // re-fetch en vez de patchear en memoria: puede haber cambiado la fecha, y con eso el orden
    onChanged?.()
  }

  const total = milestones.reduce((sum, m) => sum + Number(m.amount), 0)
  const grouped = showProjection && duration > 0
  const groupsByPeriod = {}
  const ungrouped = []
  if (grouped) {
    for (const m of milestones) {
      const p = m.period_index
      if (p >= 1 && p <= duration) (groupsByPeriod[p] = groupsByPeriod[p] || []).push(m)
      else ungrouped.push(m)
    }
  }

  function periodSelect(value, onChange) {
    return (
      <Field label="Período" style={{ width: 130, flexShrink: 0 }}>
        <select className="neg-note-date-input neg-milestone-amount-input" value={value} onChange={e => onChange(e.target.value)}>
          <option value="">Sin período</option>
          {periodRange.map(p => <option key={p} value={p}>Año {p}</option>)}
        </select>
      </Field>
    )
  }

  function renderMilestoneRow(m) {
    const isEditing = editingId === m.id
    if (isEditing) {
      return (
        <div key={m.id} className="neg-task-row neg-milestone-edit-row">
          <Field label="Nombre del pago" style={{ flex: 1.5, minWidth: 160 }}>
            <input
              type="text"
              className="neg-note-input neg-milestone-name-input"
              value={editForm.name}
              onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
              onKeyDown={e => handleEditKeyDown(e, m.id)}
              autoFocus
            />
          </Field>
          <Field label="Monto" style={{ width: 120, flexShrink: 0 }}>
            <input
              type="number"
              className="neg-note-date-input neg-milestone-amount-input"
              value={editForm.amount}
              onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))}
              onKeyDown={e => handleEditKeyDown(e, m.id)}
              step="0.01"
            />
          </Field>
          <Field label="Fecha estimada" style={{ width: 150, flexShrink: 0 }}>
            <input
              type="date"
              className="neg-note-date-input neg-milestone-date-input"
              value={editForm.estimated_date}
              onChange={e => handleEditDateChange(e.target.value)}
              onKeyDown={e => handleEditKeyDown(e, m.id)}
            />
          </Field>
          {grouped && periodSelect(editForm.period_index, v => setEditForm(f => ({ ...f, period_index: v })))}
          <Field label="Momento" style={{ flex: 1.5, minWidth: 160 }}>
            <input
              type="text"
              className="neg-note-input neg-milestone-timing-input"
              placeholder="Si no hay fecha exacta"
              value={editForm.timing_note}
              onChange={e => setEditForm(f => ({ ...f, timing_note: e.target.value }))}
              onKeyDown={e => handleEditKeyDown(e, m.id)}
            />
          </Field>
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
            <button className="neg-milestone-edit" onClick={() => startEdit(m)} title="Editar pago">✏️</button>
            <button className="neg-milestone-delete" onClick={() => handleDelete(m.id)} title="Eliminar pago">✕</button>
          </>
        )}
      </div>
    )
  }

  return (
    <div>
      {showProjection && (
        <div className="neg-projection-section">
          <div className="neg-projection-meta">
            <Field label="Fecha de inicio del deal" style={{ width: 170 }}>
              <input
                type="date"
                className="neg-note-date-input"
                value={localStartDate}
                onChange={e => setLocalStartDate(e.target.value)}
                onBlur={handleSaveStartDate}
                disabled={!canEdit}
              />
            </Field>
            <Field label="Duración (años)" style={{ width: 120 }}>
              <input
                type="number"
                min="1"
                max="50"
                className="neg-note-date-input"
                placeholder="Ej: 5"
                value={localDuration}
                onChange={e => setLocalDuration(e.target.value)}
                onBlur={handleSaveDuration}
                disabled={!canEdit}
              />
            </Field>
          </div>

          {duration > 0 && (
            <>
              <div className="neg-projection-split">
                <Field label="Valor total del deal" style={{ flex: 1, minWidth: 160 }}>
                  <input
                    type="number"
                    step="0.01"
                    className="neg-note-date-input"
                    placeholder="Ej: 5.000.000"
                    value={localTargetValue}
                    onChange={e => setLocalTargetValue(e.target.value)}
                    onBlur={handleSaveTargetValue}
                    disabled={!canEdit}
                  />
                </Field>
                <button type="button" className="btn-secondary" disabled={!canEdit || !localTargetValue} onClick={handleSplitEvenly}>
                  Repartir en partes iguales
                </button>
              </div>
              <div className="neg-projection-years">
                {periodRange.map(p => (
                  <Field key={p} label={`Año ${p}`} style={{ width: 130 }}>
                    <input
                      type="number"
                      step="0.01"
                      className="neg-note-date-input"
                      value={yearInputs[p] ?? ''}
                      onChange={e => setYearInputs(v => ({ ...v, [p]: e.target.value }))}
                      onBlur={() => saveProjectionAmount(p, yearInputs[p])}
                      disabled={!canEdit}
                    />
                  </Field>
                ))}
              </div>
              <div className="neg-projection-total">
                Total proyectado (suma de los años): {formatAmount(projectedTotal)}{currency ? ` ${currency}` : ''}
              </div>
              {targetMismatch && (
                <p className="neg-projection-mismatch">
                  ⚠ No coincide con el valor total del deal cargado arriba ({formatAmount(targetValueNum)}{currency ? ` ${currency}` : ''}) — diferencia de {formatAmount(Math.abs(targetValueNum - projectedTotal))}{currency ? ` ${currency}` : ''}.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {actionError && <p className="form-error">{actionError}</p>}
      {canEdit && (
        <div className="neg-milestone-add">
          <Field label="Nombre del pago" style={{ flex: 1.5, minWidth: 160 }}>
            <input
              type="text"
              className="neg-note-input neg-milestone-name-input"
              placeholder="Ej: Upfront, Milestone Fase 2..."
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={handleAddKeyDown}
            />
          </Field>
          <Field label="Monto" style={{ width: 120, flexShrink: 0 }}>
            <input
              type="number"
              className="neg-note-date-input neg-milestone-amount-input"
              placeholder="Negativo = pago"
              value={newAmount}
              onChange={e => setNewAmount(e.target.value)}
              onKeyDown={handleAddKeyDown}
              step="0.01"
            />
          </Field>
          <Field label="Fecha estimada" style={{ width: 150, flexShrink: 0 }}>
            <input
              type="date"
              className="neg-note-date-input neg-milestone-date-input"
              value={newDate}
              onChange={e => handleNewDateChange(e.target.value)}
              onKeyDown={handleAddKeyDown}
            />
          </Field>
          {grouped && periodSelect(newPeriod, setNewPeriod)}
          <Field label="Momento" style={{ flex: 1.5, minWidth: 160 }}>
            <input
              type="text"
              className="neg-note-input neg-milestone-timing-input"
              placeholder="Si no hay fecha exacta, ej: al lanzamiento"
              value={newTiming}
              onChange={e => setNewTiming(e.target.value)}
              onKeyDown={handleAddKeyDown}
            />
          </Field>
          <button className="neg-add-task-btn" onClick={handleAdd} disabled={saving || !newName.trim() || !newAmount}>
            + Agregar
          </button>
        </div>
      )}

      {milestones.length === 0 ? (
        <p className="detail-empty">Sin pagos cargados todavía.</p>
      ) : grouped ? (
        <div className="neg-milestone-groups">
          {periodRange.map(p => {
            const items = groupsByPeriod[p] || []
            const real = items.reduce((sum, m) => sum + Number(m.amount), 0)
            const proj = projectedByPeriod[p] || 0
            const diff = real - proj
            const diffPct = proj !== 0 ? Math.round((diff / Math.abs(proj)) * 100) : null
            return (
              <div key={p} className="neg-milestone-group">
                <div className="neg-milestone-group-header">
                  <span className="neg-milestone-group-title">Año {p}</span>
                  <span className="neg-milestone-group-stats">
                    <span>Proyectado: {formatAmount(proj)}{currency ? ` ${currency}` : ''}</span>
                    <span>Real: {formatAmount(real)}{currency ? ` ${currency}` : ''}</span>
                    <span className={`neg-milestone-group-diff ${diff < 0 ? 'neg-milestone-group-diff--negative' : diff > 0 ? 'neg-milestone-group-diff--positive' : ''}`}>
                      Diferencia: {diff > 0 ? '+' : ''}{formatAmount(diff)}{currency ? ` ${currency}` : ''}{diffPct !== null ? ` (${diffPct > 0 ? '+' : ''}${diffPct}%)` : ''}
                    </span>
                  </span>
                </div>
                {items.length > 0 && (
                  <div className="neg-tasks-list">
                    {items.map(renderMilestoneRow)}
                    <div className="neg-milestone-group-total">
                      Total: {formatAmount(real)}{currency ? ` ${currency}` : ''}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {ungrouped.length > 0 && (
            <div className="neg-milestone-group">
              <div className="neg-milestone-group-header">
                <span className="neg-milestone-group-title">Sin período asignado</span>
              </div>
              <div className="neg-tasks-list">
                {ungrouped.map(renderMilestoneRow)}
                <div className="neg-milestone-group-total">
                  Total: {formatAmount(ungrouped.reduce((sum, m) => sum + Number(m.amount), 0))}{currency ? ` ${currency}` : ''}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="neg-tasks-list">{milestones.map(renderMilestoneRow)}</div>
      )}

      {milestones.length > 0 && (
        <div className={`neg-milestone-total ${total < 0 ? 'neg-milestone-total--negative' : ''}`}>
          Total real: {formatAmount(total)}{currency ? ` ${currency}` : ''}
        </div>
      )}
    </div>
  )
}
