// Parsing compartido para import desde Excel/CSV — usa la misma librería
// `xlsx` (SheetJS) que ya se usa para exportar, cargada con import()
// dinámico (mismo motivo que en los exports: evitar sumarla al bundle
// inicial por una acción ocasional).

export async function parseSpreadsheet(file) {
  const XLSX = await import('xlsx')
  const isCsv = file.name.toLowerCase().endsWith('.csv')
  const wb = isCsv
    ? XLSX.read(await file.text(), { type: 'string', cellDates: true })
    : XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json(sheet, { defval: '' })
}

// Lee una columna de una fila ya parseada sin importar mayúsculas/espacios
// extra en el header exacto que haya puesto quien armó la planilla.
export function getCell(row, header) {
  const key = Object.keys(row).find(k => k.trim().toLowerCase() === header)
  return key ? String(row[key]).trim() : ''
}

// Igual que getCell pero sin forzar a string — para columnas de fecha,
// donde con cellDates:true la celda ya viene como objeto Date y stringificarla
// de entrada la vuelve inutilizable para parsear.
export function getCellRaw(row, header) {
  const key = Object.keys(row).find(k => k.trim().toLowerCase() === header)
  return key ? row[key] : ''
}

export async function downloadTemplate(headers, filename) {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.aoa_to_sheet([headers])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Plantilla')
  XLSX.writeFile(wb, filename)
}
