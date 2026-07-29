import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from './supabase'
import { getCountryName } from '../components/CountrySelector'
import { formatAmount } from '../components/DealMilestones'

const NAVY = [11, 31, 58]
const ACCENT = [147, 197, 253]
const MUTED = [148, 163, 184]
const GRAY_BG = [241, 245, 249]
const GRAY_TEXT = [100, 116, 139]
const BORDER = [226, 232, 240]
const INK = [31, 41, 55]

const PAGE_W = 297
const PAGE_H = 210
const MARGIN = 20

function setText(doc, rgb) { doc.setTextColor(rgb[0], rgb[1], rgb[2]) }
function setFill(doc, rgb) { doc.setFillColor(rgb[0], rgb[1], rgb[2]) }
function setDraw(doc, rgb) { doc.setDrawColor(rgb[0], rgb[1], rgb[2]) }

function formatDatePdf(d) {
  if (!d) return ''
  const date = new Date(d.length === 10 ? d + 'T00:00:00' : d)
  if (isNaN(date)) return d
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${date.getFullYear()}`
}

async function fetchTasksByNegotiation(negIds) {
  if (negIds.length === 0) return {}
  const { data } = await supabase
    .from('tasks')
    .select('id, title, status, due_date, negotiation_id, profile:assigned_to(full_name)')
    .in('negotiation_id', negIds)
    .order('created_at', { ascending: true })
  const map = {}
  for (const t of data || []) {
    if (!map[t.negotiation_id]) map[t.negotiation_id] = []
    map[t.negotiation_id].push(t)
  }
  return map
}

function drawCover(doc, { negotiations, getPrimaryEntity, workspaceName }) {
  setFill(doc, NAVY)
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F')

  const providerCount = new Set(
    negotiations.map(n => getPrimaryEntity(n)?.id).filter(Boolean)
  ).size

  setText(doc, ACCENT)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('NERVA', MARGIN, 98)

  setText(doc, [255, 255, 255])
  doc.setFontSize(30)
  doc.text('Resumen de proyectos', MARGIN, 114)

  setText(doc, [203, 213, 225])
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  doc.text(
    workspaceName ? `Pipeline de licencias y negociaciones — ${workspaceName}` : 'Pipeline de licencias y negociaciones con proveedores',
    MARGIN, 123
  )

  setText(doc, MUTED)
  doc.setFontSize(10)
  const dateStr = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
  doc.text(`${negotiations.length} proyectos  ·  ${providerCount} proveedores  ·  ${dateStr}`, MARGIN, 144)
}

function drawSummary(doc, { negotiations, customStates, tasksByNeg, pipeline, getPrimaryEntity }) {
  setText(doc, NAVY)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('Resumen general', MARGIN, 20)

  const providerIds = new Set(negotiations.map(n => getPrimaryEntity(n)?.id).filter(Boolean))
  const completedCount = negotiations.filter(n => n.status === 'Completado').length
  const pendingTasks = negotiations.reduce(
    (sum, n) => sum + (tasksByNeg[n.id] || []).filter(t => t.status !== 'done').length, 0
  )

  const cards = [
    { value: negotiations.length, label: 'Proyectos', color: NAVY },
    { value: providerIds.size, label: 'Proveedores', color: [29, 78, 216] },
    { value: completedCount, label: 'Completados', color: [5, 150, 105] },
    { value: pendingTasks, label: 'Tareas pend.', color: [217, 119, 6] },
  ]
  const cardW = 62, cardH = 28, gap = 6, startX = MARGIN, startY = 30
  cards.forEach((c, i) => {
    const x = startX + i * (cardW + gap)
    setFill(doc, GRAY_BG)
    doc.roundedRect(x, startY, cardW, cardH, 2, 2, 'F')
    setText(doc, c.color)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.text(String(c.value), x + cardW / 2, startY + 15, { align: 'center' })
    setText(doc, GRAY_TEXT)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(c.label, x + cardW / 2, startY + 23, { align: 'center' })
  })

  let y = startY + cardH + 14
  if (pipeline.length > 0) {
    setText(doc, GRAY_TEXT)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('VALOR DE PIPELINE', MARGIN, y)
    setText(doc, NAVY)
    doc.setFontSize(13)
    doc.text(pipeline.map(p => `${formatAmount(p.total)} ${p.currency}`).join('   ·   '), MARGIN, y + 8)
    y += 18
  }

  setText(doc, NAVY)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('Pipeline por estado', MARGIN, y)
  y += 8

  const counts = customStates.map(s => ({
    ...s,
    count: negotiations.filter(n => n.status === s.name).length,
  }))
  const maxCount = Math.max(1, ...counts.map(c => c.count))
  const barMaxW = 160, labelW = 42, barX = MARGIN + labelW, barH = 6, rowGap = 10

  counts.forEach((s, i) => {
    const rowY = y + i * rowGap
    setText(doc, NAVY)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(s.name, MARGIN + labelW - 3, rowY + barH - 1.5, { align: 'right' })
    const w = s.count > 0 ? Math.max((s.count / maxCount) * barMaxW, 2) : 0
    if (w > 0) {
      setFill(doc, stateColorRgb(s.color))
      doc.rect(barX, rowY, w, barH, 'F')
    }
    setText(doc, NAVY)
    doc.setFont('helvetica', 'bold')
    doc.text(String(s.count), barX + w + 3, rowY + barH - 1.5)
  })

  y = y + counts.length * rowGap + 10

  const ndaCounts = {}
  negotiations.forEach(n => { const k = n.nda || '—'; ndaCounts[k] = (ndaCounts[k] || 0) + 1 })
  const ndaStr = Object.entries(ndaCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join('   ·   ')
  setText(doc, GRAY_TEXT)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.text(`NDA:   ${ndaStr}`, MARGIN, y)
}

function stateColorRgb(hex) {
  if (!hex) return GRAY_TEXT
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function drawPill(doc, x, y, text, textRgb, bgRgb) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  const textW = doc.getTextWidth(text)
  const padX = 3.5, h = 6.5
  const w = textW + padX * 2
  setFill(doc, bgRgb)
  setDraw(doc, textRgb)
  doc.setLineWidth(0.15)
  doc.roundedRect(x, y, w, h, h / 2, h / 2, 'FD')
  setText(doc, textRgb)
  doc.text(text, x + padX, y + h - 2)
  return x + w
}

function drawProjectPage(doc, neg, { index, total, customStates, getPrimaryEntity, tasks }) {
  const cfg = customStates.find(s => s.name === neg.status)
  const stateRgb = cfg?.color ? stateColorRgb(cfg.color) : NAVY
  const stateBgRgb = cfg?.bg_color ? stateColorRgb(cfg.bg_color) : GRAY_BG
  const primary = getPrimaryEntity(neg)
  const countryName = primary?.country_code ? getCountryName(primary.country_code) : ''
  const providerLine = [primary?.name, countryName].filter(Boolean).join('  ·  ') || 'Sin proveedor asignado'

  setFill(doc, NAVY)
  doc.rect(0, 0, PAGE_W, 26, 'F')
  setText(doc, [255, 255, 255])
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.text(neg.product || neg.title || 'Sin nombre', MARGIN, 14)
  doc.text(`#${index}`, PAGE_W - MARGIN, 14, { align: 'right' })
  setText(doc, ACCENT)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(providerLine, MARGIN, 21)

  let px = MARGIN
  const pillY = 34
  px = drawPill(doc, px, pillY, neg.status || '—', stateRgb, stateBgRgb) + 4
  px = drawPill(doc, px, pillY, `NDA: ${neg.nda || '—'}`, GRAY_TEXT, GRAY_BG) + 4
  if (neg.target_date) {
    drawPill(doc, px, pillY, `Fecha: ${formatDatePdf(neg.target_date)}`, GRAY_TEXT, GRAY_BG)
  }

  const rows = []
  rows.push(['Proveedor', providerLine])
  if (neg.territories?.length) rows.push(['Territorios', neg.territories.join(', ')])
  if (neg.participants?.length) rows.push(['Participantes', neg.participants.join(', ')])
  if (neg.companies?.length) rows.push(['Empresas', neg.companies.join(', ')])
  if (neg.description) rows.push(['Descripción', neg.description])
  if (neg.notes_list?.length) {
    rows.push(['Notas', neg.notes_list.map(n => `${formatDatePdf(n.note_date)}: ${n.content}`).join('\n')])
  }
  if (neg.observations) rows.push(['Observaciones', neg.observations])
  if (tasks.length) {
    const pending = tasks.filter(t => t.status !== 'done').length
    rows.push([`Tareas (${pending} pend.)`, tasks.map(t =>
      `• ${t.title} — ${t.profile?.full_name || 'Sin asignar'}${t.due_date ? ` · vence ${formatDatePdf(t.due_date)}` : ''}${t.status === 'done' ? '  (hecha)' : ''}`
    ).join('\n')])
  }

  autoTable(doc, {
    startY: 45,
    margin: { left: MARGIN, right: MARGIN, bottom: 18 },
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 3, valign: 'top', textColor: INK },
    columnStyles: {
      0: { cellWidth: 42, fontStyle: 'bold', textColor: NAVY, fillColor: GRAY_BG },
      1: { cellWidth: 'auto' },
    },
    body: rows,
    didParseCell: (data) => {
      data.cell.styles.lineWidth = { top: 0, right: 0, bottom: 0.15, left: 0 }
      data.cell.styles.lineColor = BORDER
    },
  })
}

function drawFooter(doc, { workspaceName, page, total }) {
  setDraw(doc, BORDER)
  doc.setLineWidth(0.2)
  doc.line(MARGIN, 202, PAGE_W - MARGIN, 202)
  setText(doc, GRAY_TEXT)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(`NERVA${workspaceName ? ' · ' + workspaceName : ''} · Resumen de proyectos`, MARGIN, 207)
  doc.text(`${page} / ${total}`, PAGE_W - MARGIN, 207, { align: 'right' })
}

export async function exportNegotiationsPdf({ negotiations, customStates, getPrimaryEntity, getEntityName, pipeline, workspaceName }) {
  const negIds = negotiations.map(n => n.id)
  const tasksByNeg = await fetchTasksByNegotiation(negIds)

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  drawCover(doc, { negotiations, getPrimaryEntity, workspaceName })

  doc.addPage()
  drawSummary(doc, { negotiations, customStates, tasksByNeg, pipeline, getPrimaryEntity })

  const sorted = [...negotiations].sort((a, b) => {
    const pa = getEntityName(a) || ''
    const pb = getEntityName(b) || ''
    if (pa !== pb) return pa.localeCompare(pb, 'es')
    return (a.product || a.title || '').localeCompare(b.product || b.title || '', 'es')
  })

  sorted.forEach((neg, idx) => {
    doc.addPage()
    drawProjectPage(doc, neg, {
      index: idx + 1,
      total: sorted.length,
      customStates,
      getPrimaryEntity,
      tasks: tasksByNeg[neg.id] || [],
    })
  })

  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 2; i <= pageCount; i++) {
    doc.setPage(i)
    drawFooter(doc, { workspaceName, page: i - 1, total: pageCount - 1 })
  }

  doc.save(`nerva-proyectos-${new Date().toISOString().slice(0, 10)}.pdf`)
}
