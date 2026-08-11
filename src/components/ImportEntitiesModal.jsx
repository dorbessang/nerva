import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { parseSpreadsheet, getCell, getCellRaw, downloadTemplate } from '../lib/importXlsx'
import { getCountryCode } from './CountrySelector'
import { renderCustomFieldDisplay } from '../lib/customFields'
import { matchEntity } from '../lib/entityMatching'
import { useEscapeToClose } from '../lib/useEscapeToClose'
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

// Campos que no tiene sentido pedir por planilla: Tipo ya está implícito en
// qué pestaña de Entidades se importa, Contactos es un sub-formulario
// repetible (no una celda), y Usuario requeriría mapear texto libre contra
// miembros reales del workspace — se deja fuera por ahora, ninguno de los
// presets de Entidades lo usa hoy.
const SKIP_TYPES = ['entity_type', 'contacts', 'user']

function importFieldsOf(entityFieldDefs) {
  return (entityFieldDefs || []).filter(d => !SKIP_TYPES.includes(d.field_type))
}

function resolveChoiceId(def, text) {
  const choices = def.options?.choices || []
  const match = choices.find(c => c.label.toLowerCase() === text.toLowerCase() || c.id.toLowerCase() === text.toLowerCase())
  if (match) return { value: match.id, warning: null }
  return { value: text, warning: `"${def.label}": "${text}" no coincide con ninguna opción configurada` }
}

function parseFieldValue(def, cell, cellRaw) {
  const type = def.field_type === 'tracked' ? def.options?.underlying_type : def.field_type

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

// El contacto principal se ofrece como columnas planas aparte de los
// custom_field_definitions — Contactos es un sub-formulario repetible, no
// un campo con opciones, así que no encaja en el mismo mecanismo genérico
// de arriba. Solo se importa uno (el principal); si hacen falta más, se
// agregan a mano después.
const CONTACT_FIELDS = [
  { key: 'contact_name', label: 'Contacto: Nombre' },
  { key: 'contact_role', label: 'Contacto: Cargo' },
  { key: 'contact_email', label: 'Contacto: Email' },
  { key: 'contact_phone', label: 'Contacto: Teléfono' },
]

function buildRows(raw, importFields, hasContacts, existingEntities) {
  const seen = new Set()
  return raw.map((r, idx) => {
    const values = {}
    const warnings = []
    for (const def of importFields) {
      const header = def.label.toLowerCase()
      const type = def.field_type === 'tracked' ? def.options?.underlying_type : def.field_type
      const cell = type === 'date' ? '' : getCell(r, header)
      const cellRaw = type === 'date' ? getCellRaw(r, header) : ''
      const { value, warning } = parseFieldValue(def, cell, cellRaw)
      values[def.key] = value
      if (warning) warnings.push(warning)
    }
    const nameDef = importFields.find(d => d.storage_column === 'name')
    const name = nameDef ? values[nameDef.key] : null

    let contact = null
    if (hasContacts) {
      const contactName = getCell(r, 'contacto: nombre')
      if (contactName) {
        contact = {
          name: contactName,
          role: getCell(r, 'contacto: cargo') || null,
          email: getCell(r, 'contacto: email') || null,
          phone: getCell(r, 'contacto: teléfono') || getCell(r, 'contacto: telefono') || null,
        }
      }
    }

    const errors = []
    if (!name) errors.push('Falta el nombre')
    if (name && seen.has(name.toLowerCase())) warnings.push('Nombre repetido en el archivo')
    if (name) seen.add(name.toLowerCase())

    // Coincidencia contra lo ya cargado: exacta (tras normalizar) se resuelve
    // sola más abajo; parecida queda marcada para que se decida en el preview.
    let duplicate = { exact: null, fuzzy: [] }
    if (name) duplicate = matchEntity(name, existingEntities)

    return { idx, values, name, contact, errors, warnings, duplicate }
  })
}

export default function ImportEntitiesModal({ entityTypeId, entityTypeSingular, entityTypeName, workspaceId, entityFieldDefs = [], onClose, onImported }) {
  useEscapeToClose(onClose)
  const [step, setStep] = useState('upload') // upload | preview
  const [rows, setRows] = useState([])
  const [fileError, setFileError] = useState('')
  const [importing, setImporting] = useState(false)
  const [existingEntities, setExistingEntities] = useState([])
  // idx -> 'create' | 'skip' | `link:<id>` — default es 'create' (fila dudosa sin
  // resolver se crea igual, ya se avisó en el preview).
  const [resolutions, setResolutions] = useState({})

  useEffect(() => {
    if (!entityTypeId) return
    supabase.from('entities').select('id, name').eq('workspace_id', workspaceId).eq('entity_type_id', entityTypeId).then(({ data }) => setExistingEntities(data || []))
  }, [entityTypeId])

  const importFields = importFieldsOf(entityFieldDefs)
  const contactsDef = entityFieldDefs.find(d => d.field_type === 'contacts')
  const headers = [...importFields.map(d => d.label), ...(contactsDef ? CONTACT_FIELDS.map(c => c.label) : [])]

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileError('')
    try {
      const raw = await parseSpreadsheet(file)
      if (raw.length === 0) { setFileError('El archivo no tiene filas.'); return }
      setRows(buildRows(raw, importFields, !!contactsDef, existingEntities))
      setResolutions({})
      setStep('preview')
    } catch (err) {
      setFileError('No se pudo leer el archivo. ¿Es un .xlsx o .csv válido?')
    }
    e.target.value = ''
  }

  function resolutionOf(idx) {
    return resolutions[idx] || 'create'
  }

  function setResolution(idx, value) {
    setResolutions(prev => ({ ...prev, [idx]: value }))
  }

  const okRows = rows.filter(r => r.errors.length === 0)
  // Filas que efectivamente crean una entidad nueva: sin error, sin match
  // exacto (esas ya existen), y no resueltas como "omitir" ni "usar la existente".
  const rowsToCreate = okRows.filter(r => !r.duplicate.exact && resolutionOf(r.idx) === 'create')
  // Filas cuyo contacto (si trae uno) hay que colgar de una entidad ya
  // existente en vez de una nueva: match exacto automático, o "usar la
  // existente" elegido a mano.
  const rowsToLink = okRows.flatMap(r => {
    if (r.duplicate.exact) return [{ row: r, entityId: r.duplicate.exact.id }]
    const res = resolutionOf(r.idx)
    if (res.startsWith('link:')) return [{ row: r, entityId: res.slice(5) }]
    return []
  })

  async function handleImport() {
    setImporting(true)
    const now = new Date().toISOString()
    const { data: inserted } = await supabase.from('entities').insert(rowsToCreate.map(r => {
      const row = { workspace_id: workspaceId, entity_type_id: entityTypeId, status: 'active' }
      const customFields = {}
      for (const def of importFields) {
        const v = r.values[def.key]
        if (def.storage_column) {
          row[def.storage_column] = v
        } else if (v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)) {
          customFields[def.key] = { value: v, updated_at: now }
        }
      }
      row.custom_fields = customFields
      return row
    })).select('id')

    const contactRows = []
    if (inserted) {
      rowsToCreate.forEach((r, i) => {
        if (r.contact && inserted[i]?.id) contactRows.push({ ...r.contact, entity_id: inserted[i].id })
      })
    }
    rowsToLink.forEach(({ row: r, entityId }) => {
      if (r.contact) contactRows.push({ ...r.contact, entity_id: entityId })
    })
    if (contactRows.length > 0) {
      await supabase.from('contacts').insert(contactRows.map(c => (
        { workspace_id: workspaceId, entity_id: c.entity_id, name: c.name, role: c.role, email: c.email, phone: c.phone, is_primary: true }
      )))
    }

    setImporting(false)
    onImported()
    onClose()
  }

  const singularLower = entityTypeSingular?.toLowerCase() || 'proveedor'
  const pluralLower = entityTypeName?.toLowerCase() || 'proveedores'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="import-modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Importar {pluralLower}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="import-modal-body">
          {step === 'upload' && (
            <>
              <p className="import-hint">
                Subí un Excel (.xlsx) o CSV con una fila por {singularLower}. La primera fila tiene que tener los encabezados:
              </p>
              <div className="import-headers-list">
                {importFields.map(d => <span key={d.key} className={`import-header-chip ${d.required ? 'required' : ''}`}>{d.label}{d.required && ' *'}</span>)}
                {contactsDef && CONTACT_FIELDS.map(c => <span key={c.key} className="import-header-chip">{c.label}</span>)}
              </div>
              <button
                className="import-template-btn"
                onClick={() => downloadTemplate(headers, `plantilla-${pluralLower.replace(/\s+/g, '-')}.xlsx`)}
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
                {rowsToCreate.length} de {rows.length} fila{rows.length !== 1 ? 's' : ''} van a crear un {singularLower} nuevo.
                {rowsToLink.length > 0 && ` ${rowsToLink.length} se vinculan a un ${singularLower} que ya existe.`}
                {rows.length !== okRows.length && ` Las filas con error no se van a importar.`}
              </p>
              <div className="import-preview-table-wrap">
                <table className="import-preview-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      {importFields.map(d => <th key={d.key}>{d.label}</th>)}
                      {contactsDef && CONTACT_FIELDS.map(c => <th key={c.key}>{c.label}</th>)}
                      <th>Estado del import</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.idx} className={r.errors.length > 0 ? 'import-row-error' : r.duplicate.exact || r.duplicate.fuzzy.length > 0 ? 'import-row-duplicate' : r.warnings.length > 0 ? 'import-row-warning' : ''}>
                        <td>{r.idx + 1}</td>
                        {importFields.map(d => (
                          <td key={d.key}>{renderCustomFieldDisplay(d, r.values[d.key])}</td>
                        ))}
                        {contactsDef && (
                          <>
                            <td>{r.contact?.name || '—'}</td>
                            <td>{r.contact?.role || '—'}</td>
                            <td>{r.contact?.email || '—'}</td>
                            <td>{r.contact?.phone || '—'}</td>
                          </>
                        )}
                        <td>
                          {r.errors.length > 0 ? (
                            <span className="import-status import-status--error">✗ {r.errors.join(', ')}</span>
                          ) : r.duplicate.exact ? (
                            <span className="import-status import-status--duplicate">= Ya existe "{r.duplicate.exact.name}", no se crea</span>
                          ) : r.duplicate.fuzzy.length > 0 ? (
                            <div className="import-dup-cell">
                              <span className="import-status import-status--duplicate">⚠ Parecido a "{r.duplicate.fuzzy[0].candidate.name}"</span>
                              <select
                                className="import-dup-select"
                                value={resolutionOf(r.idx)}
                                onChange={e => setResolution(r.idx, e.target.value)}
                              >
                                <option value="create">Crear {singularLower} nuevo</option>
                                {r.duplicate.fuzzy.map(fc => (
                                  <option key={fc.candidate.id} value={`link:${fc.candidate.id}`}>Usar: {fc.candidate.name}</option>
                                ))}
                                <option value="skip">Omitir esta fila</option>
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
                <button className="import-btn-confirm" disabled={(rowsToCreate.length + rowsToLink.length) === 0 || importing} onClick={handleImport}>
                  {importing ? 'Importando…' : `Importar ${rowsToCreate.length + rowsToLink.length} fila${(rowsToCreate.length + rowsToLink.length) !== 1 ? 's' : ''}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
