import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { parseSpreadsheet, getCell, getCellRaw, downloadTemplate } from '../lib/importXlsx'
import { renderCustomFieldDisplay } from '../lib/customFields'
import { matchEntity } from '../lib/entityMatching'
import './ImportModal.css'

function parseDate(v) {
  if (!v) return null
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

// Entidades vinculadas se maneja aparte (columna "Proveedor", matchea por
// nombre contra entidades ya cargadas — solo la principal, igual que
// siempre). Financiero es un compuesto (moneda + hitos), no una celda.
// Participantes (usuario) requeriría mapear texto libre contra miembros
// reales del workspace, igual que en el import de Entidades — se deja
// afuera hasta que algún preset lo necesite de verdad.
const SKIP_TYPES = ['entities_link', 'products_link', 'financial', 'user']

function importFieldsOf(negotiationFieldDefs) {
  return (negotiationFieldDefs || []).filter(d => !SKIP_TYPES.includes(d.field_type))
}

function resolveChoiceId(def, text) {
  const choices = def.options?.choices || []
  const match = choices.find(c => c.label.toLowerCase() === text.toLowerCase() || c.id.toLowerCase() === text.toLowerCase())
  if (match) return { value: match.id, warning: null }
  return { value: text, warning: `"${def.label}": "${text}" no coincide con ninguna opción configurada` }
}

function parseFieldValue(def, cell, cellRaw, customStates) {
  const type = def.field_type === 'tracked' ? def.options?.underlying_type : def.field_type

  if (type === 'status') {
    const fallback = customStates[0]?.name || 'Contactado'
    if (!cell) return { value: fallback, warning: null }
    const match = customStates.find(s => s.name.toLowerCase() === cell.toLowerCase())
    if (match) return { value: match.name, warning: null }
    return { value: fallback, warning: `"${def.label}": "${cell}" no reconocido, se usó "${fallback}"` }
  }
  if (type === 'select') {
    if (!cell) return { value: null, warning: null }
    return resolveChoiceId(def, cell)
  }
  if (type === 'multiselect') {
    if (!cell) return { value: [], warning: null }
    const tokens = cell.split(',').map(t => t.trim()).filter(Boolean)
    const warnings = []
    const ids = tokens.map(t => {
      const r = resolveChoiceId(def, t)
      if (r.warning) warnings.push(r.warning)
      return r.value
    })
    return { value: ids, warning: warnings.join('; ') || null }
  }
  if (type === 'boolean') {
    if (!cell) return { value: false, warning: null }
    return { value: ['si', 'sí', 'true', 'x', '1'].includes(cell.trim().toLowerCase()), warning: null }
  }
  if (type === 'number') {
    if (!cell) return { value: null, warning: null }
    const n = Number(cell)
    return { value: isNaN(n) ? null : n, warning: isNaN(n) ? `"${def.label}": "${cell}" no es un número` : null }
  }
  if (type === 'date') {
    const display = cellRaw instanceof Date ? cellRaw.toLocaleDateString('es-AR') : String(cellRaw || '').trim()
    if (!display) return { value: null, warning: null }
    const parsed = parseDate(cellRaw)
    return { value: parsed, warning: parsed ? null : `"${def.label}": fecha "${display}" no reconocida` }
  }
  // text, textarea, link, email, phone
  return { value: cell || null, warning: null }
}

function buildRows(raw, importFields, entities, customStates) {
  return raw.map((r, idx) => {
    const values = {}
    const warnings = []
    for (const def of importFields) {
      const header = def.label.toLowerCase()
      const type = def.field_type === 'tracked' ? def.options?.underlying_type : def.field_type
      const cell = type === 'date' ? '' : getCell(r, header)
      const cellRaw = type === 'date' ? getCellRaw(r, header) : ''
      const { value, warning } = parseFieldValue(def, cell, cellRaw, customStates)
      values[def.key] = value
      if (warning) warnings.push(warning)
    }
    const productDef = importFields.find(d => d.storage_column === 'product')
    const product = productDef ? values[productDef.key] : null

    const providerName = getCell(r, 'proveedor')
    let entityId = null
    let providerDup = null
    if (providerName) {
      const { exact, fuzzy } = matchEntity(providerName, entities)
      if (exact) {
        entityId = exact.id
      } else if (fuzzy.length > 0) {
        providerDup = { text: providerName, candidates: fuzzy }
      } else {
        warnings.push(`Proveedor "${providerName}" no encontrado`)
      }
    }

    const errors = []
    if (!product) errors.push('Falta el producto')

    return { idx, values, product, providerName, entityId, providerDup, errors, warnings }
  })
}

export default function ImportNegotiationsModal({ workspaceId, entities, customStates, negotiationFieldDefs = [], onClose, onImported }) {
  const [step, setStep] = useState('upload')
  const [rows, setRows] = useState([])
  const [fileError, setFileError] = useState('')
  const [importing, setImporting] = useState(false)
  // idx -> 'unlinked' | `link:<id>` — default 'unlinked' (igual que hoy: si no
  // se resuelve, el proveedor queda sin vincular, no bloquea el import).
  const [dupResolutions, setDupResolutions] = useState({})

  const importFields = importFieldsOf(negotiationFieldDefs)
  const hasEntitiesLink = negotiationFieldDefs.some(d => d.field_type === 'entities_link')
  const headers = [...importFields.map(d => d.label), ...(hasEntitiesLink ? ['Proveedor'] : [])]

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileError('')
    try {
      const raw = await parseSpreadsheet(file)
      if (raw.length === 0) { setFileError('El archivo no tiene filas.'); return }
      setRows(buildRows(raw, importFields, entities, customStates))
      setDupResolutions({})
      setStep('preview')
    } catch (err) {
      setFileError('No se pudo leer el archivo. ¿Es un .xlsx o .csv válido?')
    }
    e.target.value = ''
  }

  function dupResolutionOf(idx) {
    return dupResolutions[idx] || 'unlinked'
  }

  function setDupResolution(idx, value) {
    setDupResolutions(prev => ({ ...prev, [idx]: value }))
  }

  function resolvedEntityId(r) {
    if (!r.providerDup) return r.entityId
    const res = dupResolutionOf(r.idx)
    return res.startsWith('link:') ? res.slice(5) : null
  }

  const validRows = rows.filter(r => r.errors.length === 0)

  async function handleImport() {
    setImporting(true)
    const now = new Date().toISOString()
    const { data } = await supabase.from('negotiations').insert(validRows.map(r => {
      const row = {
        workspace_id: workspaceId,
        primary_entity_id: resolvedEntityId(r),
        currency: 'USD',
        participants: [],
        companies: [],
      }
      const customFields = {}
      for (const def of importFields) {
        const v = r.values[def.key]
        if (def.storage_column) {
          row[def.storage_column] = v
        } else if (v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) {
          customFields[def.key] = { value: v, updated_at: now }
        }
      }
      row.title = r.product
      row.custom_fields = customFields
      return row
    })).select('id')

    if (data) {
      const links = validRows
        .map((r, i) => resolvedEntityId(r) ? { negotiation_id: data[i].id, entity_id: resolvedEntityId(r), role: null } : null)
        .filter(Boolean)
      if (links.length > 0) await supabase.from('negotiation_entities').insert(links)
    }

    setImporting(false)
    onImported()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="import-modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Importar proyectos</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="import-modal-body">
          {step === 'upload' && (
            <>
              <p className="import-hint">
                Subí un Excel (.xlsx) o CSV con una fila por proyecto. La primera fila tiene que tener los encabezados:
              </p>
              <div className="import-headers-list">
                {importFields.map(d => <span key={d.key} className={`import-header-chip ${d.required ? 'required' : ''}`}>{d.label}{d.required && ' *'}</span>)}
                {hasEntitiesLink && <span className="import-header-chip">Proveedor</span>}
              </div>
              <p className="import-hint import-hint--small">
                "Proveedor" se resuelve por nombre contra las entidades ya cargadas — si no hay una coincidencia clara, se va a poder elegir en la vista previa. "Estado" tiene que coincidir con uno de los estados configurados en Settings — si no coincide o se deja vacío, se usa el primero de la lista.
              </p>
              <button
                className="import-template-btn"
                onClick={() => downloadTemplate(headers, 'plantilla-proyectos.xlsx')}
              >
                ⬇ Descargar plantilla vacía
              </button>
              <label className="import-dropzone">
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} hidden />
                <span>📄 Elegir archivo…</span>
              </label>
              {fileError && <p className="import-error">{fileError}</p>}
            </>
          )}

          {step === 'preview' && (
            <>
              <p className="import-hint">
                {validRows.length} de {rows.length} fila{rows.length !== 1 ? 's' : ''} lista{validRows.length !== 1 ? 's' : ''} para importar.
                {rows.length !== validRows.length && ` Las filas con error no se van a importar.`}
              </p>
              <div className="import-preview-table-wrap">
                <table className="import-preview-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      {importFields.map(d => <th key={d.key}>{d.label}</th>)}
                      {hasEntitiesLink && <th>Proveedor</th>}
                      <th>Estado del import</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.idx} className={r.errors.length > 0 ? 'import-row-error' : r.providerDup ? 'import-row-duplicate' : r.warnings.length > 0 ? 'import-row-warning' : ''}>
                        <td>{r.idx + 1}</td>
                        {importFields.map(d => (
                          <td key={d.key}>{renderCustomFieldDisplay(d, r.values[d.key])}</td>
                        ))}
                        {hasEntitiesLink && <td>{r.providerName || '—'}</td>}
                        <td>
                          {r.errors.length > 0 ? (
                            <span className="import-status import-status--error">✗ {r.errors.join(', ')}</span>
                          ) : r.providerDup ? (
                            <div className="import-dup-cell">
                              <span className="import-status import-status--duplicate">⚠ Proveedor "{r.providerDup.text}" parecido a "{r.providerDup.candidates[0].candidate.name}"</span>
                              <select
                                className="import-dup-select"
                                value={dupResolutionOf(r.idx)}
                                onChange={e => setDupResolution(r.idx, e.target.value)}
                              >
                                <option value="unlinked">Dejar sin vincular</option>
                                {r.providerDup.candidates.map(fc => (
                                  <option key={fc.candidate.id} value={`link:${fc.candidate.id}`}>Usar: {fc.candidate.name}</option>
                                ))}
                              </select>
                            </div>
                          ) : r.warnings.length > 0 ? (
                            <span className="import-status import-status--warning">⚠ {r.warnings.join(', ')}</span>
                          ) : (
                            <span className="import-status import-status--ok">✓ OK</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="import-actions">
                <button className="import-btn-cancel" onClick={() => setStep('upload')}>← Elegir otro archivo</button>
                <button className="import-btn-confirm" disabled={validRows.length === 0 || importing} onClick={handleImport}>
                  {importing ? 'Importando…' : `Importar ${validRows.length} fila${validRows.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
