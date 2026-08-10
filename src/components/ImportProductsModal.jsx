import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { parseSpreadsheet, getCell, getCellRaw, downloadTemplate } from '../lib/importXlsx'
import { getCountryCode } from './CountrySelector'
import { renderCustomFieldDisplay } from '../lib/customFields'
import { matchEntity } from '../lib/entityMatching'
import './ImportModal.css'

function parseDate(v) {
  if (!v) return null
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

function resolveChoiceId(def, text) {
  const choices = def.options?.choices || []
  const match = choices.find(c => c.label.toLowerCase() === text.toLowerCase() || c.id.toLowerCase() === text.toLowerCase())
  if (match) return { value: match.id, warning: null }
  return { value: text, warning: `"${def.label}": "${text}" no coincide con ninguna opción configurada` }
}

// A diferencia de Entidades (donde el tipo ya está implícito en qué pestaña
// se importa), Productos es una sola página unificada — el tipo y el
// vendedor van como columnas de texto en cada fila, resueltas por nombre
// contra lo ya configurado en el workspace (mismo criterio que país/select).
function parseFieldValue(def, cell, cellRaw, { productTypes, entities }) {
  const type = def.field_type === 'tracked' ? def.options?.underlying_type : def.field_type

  if (type === 'product_type') {
    if (!cell) return { value: null, warning: null }
    const match = productTypes.find(t => t.name.toLowerCase() === cell.toLowerCase())
    return { value: match?.id || null, warning: match ? null : `"${def.label}": "${cell}" no coincide con ningún tipo configurado` }
  }
  if (type === 'product_entity') {
    if (!cell) return { value: null, warning: null }
    const { exact, fuzzy } = matchEntity(cell, entities)
    if (exact) return { value: exact.id, warning: null }
    if (fuzzy.length > 0) return { value: null, warning: null, dup: { key: def.key, label: def.label, text: cell, candidates: fuzzy } }
    return { value: null, warning: `"${def.label}": entidad "${cell}" no encontrada` }
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
  if (type === 'country') {
    if (def.options?.multiple) {
      if (!cell) return { value: [], warning: null }
      const tokens = cell.split(',').map(t => t.trim()).filter(Boolean)
      const warnings = []
      const codes = tokens.map(t => {
        const code = getCountryCode(t)
        if (!code) warnings.push(`"${def.label}": país "${t}" no reconocido`)
        return code
      }).filter(Boolean)
      return { value: codes, warning: warnings.join('; ') || null }
    }
    if (!cell) return { value: null, warning: null }
    const code = getCountryCode(cell)
    return { value: code, warning: code ? null : `"${def.label}": país "${cell}" no reconocido` }
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

function buildRows(raw, importFields, ctx) {
  const seen = new Set()
  return raw.map((r, idx) => {
    const values = {}
    const warnings = []
    const dupFields = []
    for (const def of importFields) {
      const header = def.label.toLowerCase()
      const type = def.field_type === 'tracked' ? def.options?.underlying_type : def.field_type
      const cell = type === 'date' ? '' : getCell(r, header)
      const cellRaw = type === 'date' ? getCellRaw(r, header) : ''
      const { value, warning, dup } = parseFieldValue(def, cell, cellRaw, ctx)
      values[def.key] = value
      if (warning) warnings.push(warning)
      if (dup) dupFields.push(dup)
    }
    const nameDef = importFields.find(d => d.storage_column === 'name')
    const name = nameDef ? values[nameDef.key] : null
    const typeDef = importFields.find(d => d.field_type === 'product_type')

    const errors = []
    if (!name) errors.push('Falta el nombre')
    if (typeDef && !values[typeDef.key]) errors.push('Falta o no coincide el tipo de producto')
    if (name && seen.has(name.toLowerCase())) warnings.push('Nombre repetido en el archivo')
    if (name) seen.add(name.toLowerCase())

    return { idx, values, name, errors, warnings, dupFields }
  })
}

// Vista previa de una celda — product_type/product_entity se guardan como
// id (resuelto contra lo cargado en el workspace), acá se muestra el
// nombre matcheado en vez del id crudo para que la previsualización sea legible.
function previewValue(def, row, { productTypes, entities }, resolvedId) {
  if (def.field_type === 'product_type') return productTypes.find(t => t.id === row.values[def.key])?.name || '—'
  if (def.field_type === 'product_entity') return entities.find(e => e.id === (resolvedId ?? row.values[def.key]))?.name || '—'
  return renderCustomFieldDisplay(def, row.values[def.key])
}

export default function ImportProductsModal({ workspaceId, productFieldDefs = [], onClose, onImported }) {
  const [step, setStep] = useState('upload') // upload | preview
  const [rows, setRows] = useState([])
  const [fileError, setFileError] = useState('')
  const [importing, setImporting] = useState(false)
  const [productTypes, setProductTypes] = useState([])
  const [entities, setEntities] = useState([])
  // `${idx}:${fieldKey}` -> 'unlinked' | `link:<id>` — default 'unlinked' (igual
  // que hoy: si no se resuelve, el campo queda vacío, no bloquea el import).
  const [dupResolutions, setDupResolutions] = useState({})

  useEffect(() => {
    supabase.from('product_types').select('id, name').order('sort_order').then(({ data }) => setProductTypes(data || []))
    supabase.from('entities').select('id, name').order('name').then(({ data }) => setEntities(data || []))
  }, [])

  const importFields = productFieldDefs
  const headers = importFields.map(d => d.label)
  const ctx = { productTypes, entities }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileError('')
    try {
      const raw = await parseSpreadsheet(file)
      if (raw.length === 0) { setFileError('El archivo no tiene filas.'); return }
      setRows(buildRows(raw, importFields, ctx))
      setDupResolutions({})
      setStep('preview')
    } catch {
      setFileError('No se pudo leer el archivo. ¿Es un .xlsx o .csv válido?')
    }
    e.target.value = ''
  }

  function dupResolutionOf(idx, key) {
    return dupResolutions[`${idx}:${key}`] || 'unlinked'
  }

  function setDupResolution(idx, key, value) {
    setDupResolutions(prev => ({ ...prev, [`${idx}:${key}`]: value }))
  }

  // Aplica lo elegido en el preview para los campos que quedaron dudosos
  // (product_entity con parecidos) antes de insertar.
  function resolvedValues(r) {
    if (r.dupFields.length === 0) return r.values
    const values = { ...r.values }
    for (const dup of r.dupFields) {
      const res = dupResolutionOf(r.idx, dup.key)
      values[dup.key] = res.startsWith('link:') ? res.slice(5) : null
    }
    return values
  }

  const validRows = rows.filter(r => r.errors.length === 0)

  async function handleImport() {
    setImporting(true)
    const now = new Date().toISOString()
    await supabase.from('products').insert(validRows.map(r => {
      const row = { workspace_id: workspaceId }
      const customFields = {}
      const values = resolvedValues(r)
      for (const def of importFields) {
        const v = values[def.key]
        if (def.storage_column) {
          row[def.storage_column] = v
        } else if (v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) {
          customFields[def.key] = { value: v, updated_at: now }
        }
      }
      row.custom_fields = customFields
      return row
    }))
    setImporting(false)
    onImported()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="import-modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Importar productos</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="import-modal-body">
          {step === 'upload' && (
            <>
              <p className="import-hint">
                Subí un Excel (.xlsx) o CSV con una fila por producto. La primera fila tiene que tener los encabezados:
              </p>
              <div className="import-headers-list">
                {importFields.map(d => (
                  <span key={d.key} className={`import-header-chip ${d.required || d.field_type === 'product_type' ? 'required' : ''}`}>
                    {d.label}{(d.required || d.field_type === 'product_type') && ' *'}
                  </span>
                ))}
              </div>
              <p className="import-hint">
                "Tipo de producto" y "Proveedor/Vendedor" van como texto — se resuelven por nombre contra lo ya configurado en el workspace.
              </p>
              <button
                className="import-template-btn"
                onClick={() => downloadTemplate(headers, 'plantilla-productos.xlsx')}
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
                      <th>Estado del import</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.idx} className={r.errors.length > 0 ? 'import-row-error' : r.dupFields.length > 0 ? 'import-row-duplicate' : r.warnings.length > 0 ? 'import-row-warning' : ''}>
                        <td>{r.idx + 1}</td>
                        {importFields.map(d => {
                          const dup = r.dupFields.find(x => x.key === d.key)
                          const res = dup ? dupResolutionOf(r.idx, dup.key) : null
                          const resolvedId = res && res.startsWith('link:') ? res.slice(5) : null
                          return <td key={d.key}>{previewValue(d, r, ctx, resolvedId)}</td>
                        })}
                        <td>
                          {r.errors.length > 0 ? (
                            <span className="import-status import-status--error">✗ {r.errors.join(', ')}</span>
                          ) : r.dupFields.length > 0 ? (
                            <div className="import-dup-cell">
                              {r.dupFields.map(dup => (
                                <div key={dup.key}>
                                  <span className="import-status import-status--duplicate">⚠ "{dup.label}": "{dup.text}" parecido a "{dup.candidates[0].candidate.name}"</span>
                                  <select
                                    className="import-dup-select"
                                    value={dupResolutionOf(r.idx, dup.key)}
                                    onChange={e => setDupResolution(r.idx, dup.key, e.target.value)}
                                  >
                                    <option value="unlinked">Dejar sin vincular</option>
                                    {dup.candidates.map(fc => (
                                      <option key={fc.candidate.id} value={`link:${fc.candidate.id}`}>Usar: {fc.candidate.name}</option>
                                    ))}
                                  </select>
                                </div>
                              ))}
                              {r.warnings.length > 0 && <span className="import-status import-status--warning">⚠ {r.warnings.join(', ')}</span>}
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
