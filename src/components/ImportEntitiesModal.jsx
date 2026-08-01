import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { parseSpreadsheet, getCell, downloadTemplate } from '../lib/importXlsx'
import { getCountryCode, getCountryName } from './CountrySelector'
import './ImportModal.css'

const HEADERS = ['Nombre', 'País', 'Sitio web', 'Tipo de empresa']

function buildRows(raw) {
  const seen = new Set()
  return raw.map((r, idx) => {
    const name = getCell(r, 'nombre')
    const countryRaw = getCell(r, 'país') || getCell(r, 'pais')
    const website = getCell(r, 'sitio web')
    const companyType = getCell(r, 'tipo de empresa')
    const countryCode = countryRaw ? getCountryCode(countryRaw) : null

    const errors = []
    if (!name) errors.push('Falta el nombre')

    const warnings = []
    if (countryRaw && !countryCode) warnings.push(`País "${countryRaw}" no reconocido`)
    if (name && seen.has(name.toLowerCase())) warnings.push('Nombre repetido en el archivo')
    if (name) seen.add(name.toLowerCase())

    return { idx, name, countryRaw, countryCode, website, companyType, errors, warnings }
  })
}

export default function ImportEntitiesModal({ entityTypeId, entityTypeSingular, entityTypeName, workspaceId, onClose, onImported }) {
  const [step, setStep] = useState('upload') // upload | preview
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
      setRows(buildRows(raw))
      setStep('preview')
    } catch (err) {
      setFileError('No se pudo leer el archivo. ¿Es un .xlsx o .csv válido?')
    }
    e.target.value = ''
  }

  const validRows = rows.filter(r => r.errors.length === 0)

  async function handleImport() {
    setImporting(true)
    await supabase.from('entities').insert(validRows.map(r => ({
      workspace_id: workspaceId,
      entity_type_id: entityTypeId,
      name: r.name,
      country_code: r.countryCode || null,
      website: r.website || null,
      custom_fields: r.companyType ? { company_type: { value: r.companyType, updated_at: new Date().toISOString() } } : {},
      status: 'active',
    })))
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
                {HEADERS.map(h => <span key={h} className={`import-header-chip ${h === 'Nombre' ? 'required' : ''}`}>{h}{h === 'Nombre' && ' *'}</span>)}
              </div>
              <button
                className="import-template-btn"
                onClick={() => downloadTemplate(HEADERS, `plantilla-${pluralLower.replace(/\s+/g, '-')}.xlsx`)}
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
                      <th>#</th><th>Nombre</th><th>País</th><th>Sitio web</th><th>Tipo</th><th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.idx} className={r.errors.length > 0 ? 'import-row-error' : r.warnings.length > 0 ? 'import-row-warning' : ''}>
                        <td>{r.idx + 1}</td>
                        <td>{r.name || '—'}</td>
                        <td>{r.countryCode ? getCountryName(r.countryCode) : (r.countryRaw || '—')}</td>
                        <td>{r.website || '—'}</td>
                        <td>{r.companyType || '—'}</td>
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
