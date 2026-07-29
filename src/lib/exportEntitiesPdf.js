import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from './supabase'
import { getCountryName } from '../components/CountrySelector'
import { formatAmount } from '../components/DealMilestones'
import {
  NAVY, ACCENT, GRAY_BG, GRAY_TEXT, BORDER, INK, PAGE_W,
  setText, setFill, stateColorRgb, drawPill,
  drawCover, drawFooter, drawStatCards, drawStateBarChart,
} from './pdfTheme'

const MARGIN = 20

// Todo lo que la lista de Entidades no trae ya cargado (territorios, tareas
// pendientes por proyecto, hitos de pago) se busca acá con queries puntuales,
// solo cuando se genera el PDF — mismo patrón que exportPdf.js.
async function fetchExtraData(negIds) {
  if (negIds.length === 0) return { territoriesByNeg: {}, pendingByNeg: {}, milestones: [] }
  const [{ data: negs }, { data: tasks }, { data: milestones }] = await Promise.all([
    supabase.from('negotiations').select('id, territories, currency').in('id', negIds),
    supabase.from('tasks').select('id, status, negotiation_id').in('negotiation_id', negIds),
    supabase.from('deal_milestones').select('negotiation_id, amount').in('negotiation_id', negIds),
  ])
  const territoriesByNeg = {}
  const currencyByNeg = {}
  for (const n of negs || []) {
    territoriesByNeg[n.id] = n.territories || []
    currencyByNeg[n.id] = n.currency || 'USD'
  }
  const pendingByNeg = {}
  for (const t of tasks || []) {
    if (t.status === 'done') continue
    pendingByNeg[t.negotiation_id] = (pendingByNeg[t.negotiation_id] || 0) + 1
  }
  return { territoriesByNeg, pendingByNeg, milestones: milestones || [], currencyByNeg }
}

function pipelineByCurrency(negIds, milestones, currencyByNeg) {
  const idSet = new Set(negIds)
  const totals = {}
  for (const m of milestones) {
    if (!idSet.has(m.negotiation_id)) continue
    const cur = currencyByNeg[m.negotiation_id] || 'USD'
    totals[cur] = (totals[cur] || 0) + Number(m.amount)
  }
  return Object.entries(totals).map(([currency, total]) => ({ currency, total })).sort((a, b) => b.total - a.total)
}

function drawSummary(doc, { entities, negotiations, customStates, pipeline, entityLabelPlural }) {
  setText(doc, NAVY)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('Resumen general', MARGIN, 20)

  const completedCount = negotiations.filter(n => n.status === 'Completado').length

  let y = drawStatCards(doc, [
    { value: entities.length, label: entityLabelPlural, color: NAVY },
    { value: negotiations.length, label: 'Proyectos', color: [29, 78, 216] },
    { value: completedCount, label: 'Completados', color: [5, 150, 105] },
    { value: negotiations.length - completedCount, label: 'En curso', color: [217, 119, 6] },
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

function drawProviderPage(doc, entity, { index, customStates, negotiations, territoriesByNeg, pendingByNeg, entityLabelSingular }) {
  const countryName = entity.country_code ? getCountryName(entity.country_code) : ''

  setFill(doc, NAVY)
  doc.rect(0, 0, PAGE_W, 26, 'F')
  setText(doc, [255, 255, 255])
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.text(entity.name, MARGIN, 14)
  doc.text(`#${index}`, PAGE_W - MARGIN, 14, { align: 'right' })
  setText(doc, ACCENT)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(countryName || entityLabelSingular, MARGIN, 21)

  let y = 36

  const contacts = [...(entity.contacts || [])].sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0))
  if (contacts.length > 0) {
    setText(doc, GRAY_TEXT)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('CONTACTOS', MARGIN, y)
    y += 5
    contacts.forEach(c => {
      const parts = [c.role ? `${c.name} (${c.role})` : c.name, c.email, c.phone].filter(Boolean)
      setText(doc, INK)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.text(parts.join('  —  '), MARGIN, y)
      y += 5.5
    })
    y += 3
  }

  const counts = {}
  negotiations.forEach(n => { counts[n.status] = (counts[n.status] || 0) + 1 })
  if (Object.keys(counts).length > 0) {
    let px = MARGIN
    Object.entries(counts).forEach(([status, count]) => {
      const cfg = customStates.find(s => s.name === status)
      const rgb = cfg?.color ? stateColorRgb(cfg.color) : NAVY
      const bgRgb = cfg?.bg_color ? stateColorRgb(cfg.bg_color) : GRAY_BG
      px = drawPill(doc, px, y, `${count} ${status}`, rgb, bgRgb) + 4
    })
    y += 12
  }

  const body = negotiations.map(n => [
    n.product || n.title || 'Sin nombre',
    n.status || '—',
    n.nda || '—',
    (territoriesByNeg[n.id] || []).join(', ') || '—',
    pendingByNeg[n.id] ? String(pendingByNeg[n.id]) : '—',
  ])

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, bottom: 18 },
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 3, valign: 'top', textColor: INK },
    headStyles: { fontStyle: 'bold', textColor: NAVY, fillColor: GRAY_BG },
    head: [['Producto', 'Estado', 'NDA', 'Territorios', 'Pend.']],
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 38 },
      2: { cellWidth: 30 },
      3: { cellWidth: 'auto' },
      4: { cellWidth: 16, halign: 'center' },
    },
    body,
    didParseCell: (data) => {
      data.cell.styles.lineWidth = { top: 0, right: 0, bottom: 0.15, left: 0 }
      data.cell.styles.lineColor = BORDER
    },
  })
}

export async function exportEntitiesPdf({ entities, customStates, entityLabelPlural, entityLabelSingular, workspaceName }) {
  const negByEntity = {}
  const negIndex = {}
  entities.forEach(entity => {
    const negs = (entity.negotiation_entities || []).map(ne => ne.negotiation).filter(Boolean)
    negByEntity[entity.id] = negs
    negs.forEach(n => { negIndex[n.id] = n })
  })
  const allNegotiations = Object.values(negIndex)
  const negIds = allNegotiations.map(n => n.id)

  const { territoriesByNeg, pendingByNeg, milestones, currencyByNeg } = await fetchExtraData(negIds)
  const pipeline = pipelineByCurrency(negIds, milestones, currencyByNeg)

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  const pluralLower = entityLabelPlural.toLowerCase()
  drawCover(doc, {
    title: `Resumen de ${pluralLower}`,
    subtitle: workspaceName ? `Pipeline de licencias y negociaciones — ${workspaceName}` : `Pipeline de licencias y negociaciones con ${pluralLower}`,
    statsLine: `${entities.length} ${pluralLower}  ·  ${allNegotiations.length} proyectos`,
  })

  doc.addPage()
  drawSummary(doc, { entities, negotiations: allNegotiations, customStates, pipeline, entityLabelPlural })

  const sorted = [...entities].sort((a, b) => a.name.localeCompare(b.name, 'es'))
  sorted.forEach((entity, idx) => {
    doc.addPage()
    drawProviderPage(doc, entity, {
      index: idx + 1,
      customStates,
      negotiations: negByEntity[entity.id] || [],
      territoriesByNeg,
      pendingByNeg,
      entityLabelSingular,
    })
  })

  const pageCount = doc.internal.getNumberOfPages()
  const footerLabel = `NERVA${workspaceName ? ' · ' + workspaceName : ''} · Resumen de ${pluralLower}`
  for (let i = 2; i <= pageCount; i++) {
    doc.setPage(i)
    drawFooter(doc, { label: footerLabel, page: i - 1, total: pageCount - 1 })
  }

  doc.save(`nerva-${pluralLower.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`)
}
