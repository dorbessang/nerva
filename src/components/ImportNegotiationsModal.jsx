import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { parseSpreadsheet, getCell, getCellRaw, downloadTemplate } from '../lib/importXlsx'
import './ImportModal.css'

const HEADERS = ['Producto', 'Proveedor', 'Estado', 'NDA', 'Territorios', 'Fecha objetivo']

function parseDate(v) {
  if (!v) return null
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

function buildRows(raw, entities, customStates) {
  return raw.map((r, idx) => {
    const product = getCell(r, 'producto')
    const providerName = getCell(r, 'proveedor')
    const statusRaw = getCell(r, 'estado')
    const nda = getCell(r, 'nda')
    const territoriesRaw = getCell(r, 'territorios')
    const dateRaw = getCellRaw(r, 'fecha objetivo')
    const dateDisplay = dateRaw instanceof Date ? dateRaw.toLocaleDateString('es-AR') : String(dateRaw).trim()

    const errors = []
    if (!product) errors.push('Falta el producto')

    const warnings = []
    let entityMatch = null
    if (providerName) {
      entityMatch = entities.find(e => e.name.toLowerCase() === providerName.toLowerCase())
      if (!entityMatch) warnings.push(`Proveedor "${providerName}" no encontrado`)
    }

    let status = customStates[0]?.name || 'Contactado'
    if (statusRaw) {
      const match = customStates.find(s => s.name.toLowerCase() === statusRaw.toLowerCase())
      if (match) status = match.name
      else warnings.push(`Estado "${statusRaw}" no reconocido, se usó "${status}"`)
    }

    const territories = territoriesRaw ? territoriesRaw.split(',').map(t => t.trim()).filter(Boolean) : []
    const target_date = dateDisplay ? parseDate(dateRaw) : null
    if (dateDisplay && !target_date) warnings.push(`Fecha "${dateDisplay}" no reconocida, se omitió`)

    return { idx, product, providerName, entityId: entityMatch?.id || null, status, nda: nda || '—', territories, target_date, errors, warnings }
  })
}

export default function ImportNegotiationsModal({ workspaceId, entities, customStates, onClose, onImported }) {
  const [step, setStep] = useState('upload')
  const [rows, setRows] = useState([])
  const [fileError, setFileError] = useState('')
  const [importing, setImporting] = useState(false)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileError('')
    try {
      const raw = await parseSpreadsheet(file)
      if (raw.length === 0) { setFileError('El archivo no tiene filas.'); return }
      setRows(buildRows(raw, entities, customStates))
      setStep('preview')
    } catch (err) {
      setFileError('No se pudo leer el archivo. ¿Es un .xlsx o .csv válido?')
    }
    e.target.value = ''
  }

  const validRows = rows.filter(r => r.errors.length === 0)

  async function handleImport() {
    setImporting(true)
    const { data } = await supabase.from('negotiations').insert(validRows.map(r => ({
      workspace_id: workspaceId,
      title: r.product,
      product: r.product,
      status: r.status,
      nda: r.nda,
      target_date: r.target_date,
      territories: r.territories,
      companies: [],
      participants: [],
      primary_entity_id: r.entityId,
      currency: 'USD',
    }))).select('id')

    if (data) {
      const links = validRows
        .map((r, i) => r.entityId ? { negotiation_id: data[i].id, entity_id: r.entityId, role: null } : null)
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
                {HEADERS.map(h => <span key={h} className={`import-header-chip ${h === 'Producto' ? 'required' : ''}`}>{h}{h === 'Producto' && ' *'}</span>)}
              </div>
              <p className="import-hint import-hint--small">
                "Proveedor" tiene que coincidir con el nombre exacto de una entidad ya cargada. "Estado" tiene que coincidir con uno de los estados configurados en Settings — si no coincide o se deja vacío, se usa el primero de la lista.
              </p>
              <button
                className="import-template-btn"
                onClick={() => downloadTemplate(HEADERS, 'plantilla-proyectos.xlsx')}
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
                      <th>#</th><th>Producto</th><th>Proveedor</th><th>Estado</th><th>NDA</th><th>Territorios</th><th>Fecha</th><th>Estado del import</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.idx} className={r.errors.length > 0 ? 'import-row-error' : r.warnings.length > 0 ? 'import-row-warning' : ''}>
                        <td>{r.idx + 1}</td>
                        <td>{r.product || '—'}</td>
                        <td>{r.providerName || '—'}</td>
                        <td>{r.status}</td>
                        <td>{r.nda}</td>
                        <td>{r.territories.join(', ') || '—'}</td>
                        <td>{r.target_date || '—'}</td>
                        <td>
                          {r.errors.length > 0
                            ? <span className="import-status import-status--error">✗ {r.errors.join(', ')}</span>
                            : r.warnings.length > 0
                              ? <span className="import-status import-status--warning">⚠ {r.warnings.join(', ')}</span>
                              : <span className="import-status import-status--ok">✓ OK</span>}
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
