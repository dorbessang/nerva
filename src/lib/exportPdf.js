import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from './supabase'
import { getCountryName } from '../components/CountrySelector'
import { formatAmount } from '../components/DealMilestones'
import { resolveMemberNames } from './customFields'
import {
  NAVY, ACCENT, GRAY_BG, GRAY_TEXT, BORDER, INK, PAGE_W,
  setText, setFill, formatDatePdf, stateColorRgb, drawPill,
  drawCover, drawFooter, drawStatCards, drawStateBarChart,
} from './pdfTheme'

const MARGIN = 20

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

  let y = drawStatCards(doc, [
    { value: negotiations.length, label: 'Proyectos', color: NAVY },
    { value: providerIds.size, label: 'Proveedores', color: [29, 78, 216] },
    { value: completedCount, label: 'Completados', color: [5, 150, 105] },
    { value: pendingTasks, label: 'Tareas pend.', color: [217, 119, 6] },
  ], 30) + 14

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

  const counts = customStates.map(s => ({ ...s, count: negotiations.filter(n => n.status === s.name).length }))
  drawStateBarChart(doc, counts, y)
}

function drawProjectPage(doc, neg, { index, customStates, getPrimaryEntity, tasks, members }) {
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
  if (neg.target_date) {
    drawPill(doc, px, pillY, `Fecha: ${formatDatePdf(neg.target_date)}`, GRAY_TEXT, GRAY_BG)
  }

  const rows = []
  rows.push(['Proveedor', providerLine])
  const participantNames = resolveMemberNames(members, neg.participants)
  if (participantNames.length) rows.push(['Participantes', participantNames.join(', ')])
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

export async function exportNegotiationsPdf({ negotiations, customStates, getPrimaryEntity, getEntityName, pipeline, workspaceName, members }) {
  const negIds = negotiations.map(n => n.id)
  const tasksByNeg = await fetchTasksByNegotiation(negIds)

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  const providerCount = new Set(negotiations.map(n => getPrimaryEntity(n)?.id).filter(Boolean)).size
  drawCover(doc, {
    title: 'Resumen de proyectos',
    subtitle: workspaceName ? `Pipeline de licencias y negociaciones — ${workspaceName}` : 'Pipeline de licencias y negociaciones con proveedores',
    statsLine: `${negotiations.length} proyectos  ·  ${providerCount} proveedores`,
  })

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
      customStates,
      getPrimaryEntity,
      tasks: tasksByNeg[neg.id] || [],
      members,
    })
  })

  const pageCount = doc.internal.getNumberOfPages()
  const footerLabel = `NERVA${workspaceName ? ' · ' + workspaceName : ''} · Resumen de proyectos`
  for (let i = 2; i <= pageCount; i++) {
    doc.setPage(i)
    drawFooter(doc, { label: footerLabel, page: i - 1, total: pageCount - 1 })
  }

  doc.save(`nerva-proyectos-${new Date().toISOString().slice(0, 10)}.pdf`)
}
