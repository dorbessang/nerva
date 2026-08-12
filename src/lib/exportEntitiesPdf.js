import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from './supabase'
import { getCountryName } from '../components/CountrySelector'
import { formatAmount } from '../components/DealMilestones'
import { sumMilestonesByCurrency } from './pipeline'
import { terminalStatusNames } from './customStates'
import {
  NAVY, ACCENT, GRAY_BG, GRAY_TEXT, BORDER, INK, PAGE_W,
  setText, setFill, stateColorRgb, drawPill,
  drawCover, drawFooter, drawStatCards, drawStateBarChart,
} from './pdfTheme'

const MARGIN = 20

// Tareas pendientes e hitos de pago no vienen precargados en ningún lado —
// se buscan acá con queries puntuales, solo cuando se genera el PDF.
async function fetchExtraData(negIds) {
  if (negIds.length === 0) return { pendingByNeg: {}, milestones: [] }
  const [{ data: tasks }, { data: milestones }] = await Promise.all([
    supabase.from('tasks').select('id, status, negotiation_id').in('negotiation_id', negIds),
    supabase.from('deal_milestones').select('negotiation_id, amount').in('negotiation_id', negIds),
  ])
  const pendingByNeg = {}
  for (const t of tasks || []) {
    if (t.status === 'done') continue
    pendingByNeg[t.negotiation_id] = (pendingByNeg[t.negotiation_id] || 0) + 1
  }
  return { pendingByNeg, milestones: milestones || [] }
}

function drawSummary(doc, { entities, negotiations, customStates, pipeline, typeBreakdown }) {
  setText(doc, NAVY)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('Resumen general', MARGIN, 20)

  const terminalNames = terminalStatusNames(customStates)
  const completedCount = negotiations.filter(n => terminalNames.has(n.status)).length

  let y = drawStatCards(doc, [
    { value: entities.length, label: 'Entidades', color: NAVY },
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
  y = drawStateBarChart(doc, counts, y) + 10

  if (typeBreakdown.length > 0) {
    const str = typeBreakdown.map(t => `${t.count} ${t.plural}`).join('   ·   ')
    setText(doc, GRAY_TEXT)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.text(`ENTIDADES POR TIPO:   ${str}`, MARGIN, y)
  }
}

function drawEntityPage(doc, entity, { index, customStates, negotiations, pendingByNeg, typeLabelSingular }) {
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
  doc.text(countryName || typeLabelSingular, MARGIN, 21)

  let y = 36

  if (entity.address) {
    setText(doc, INK)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(entity.address, MARGIN, y)
    y += 8
  }

  const contacts = [...(entity.contacts || [])].sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0))
  if (contacts.length > 0) {
    setText(doc, GRAY_TEXT)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('CONTACTOS', MARGIN, y)
    y += 5
    contacts.forEach(c => {
      const parts = [c.role ? `${c.name} (${c.role})` : c.name, c.email, c.phone, c.whatsapp ? `WhatsApp: ${c.whatsapp}` : null].filter(Boolean)
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
    pendingByNeg[n.id] ? String(pendingByNeg[n.id]) : '—',
  ])

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, bottom: 18 },
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 3, valign: 'top', textColor: INK },
    headStyles: { fontStyle: 'bold', textColor: NAVY, fillColor: GRAY_BG },
    head: [['Producto', 'Estado', 'Pend.']],
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 38 },
      2: { cellWidth: 16, halign: 'center' },
    },
    body,
    didParseCell: (data) => {
      data.cell.styles.lineWidth = { top: 0, right: 0, bottom: 0.15, left: 0 }
      data.cell.styles.lineColor = BORDER
    },
  })
}

// Un único PDF con TODAS las entidades del workspace, agrupadas por tipo
// (Proveedores, Clientes, etc.) — accesible desde cualquier pestaña de
// Entidades, no un archivo separado por tipo.
export async function exportAllEntitiesPdf({ workspaceId, customStates, workspaceName }) {
  const [{ data: entityTypes }, { data: entities }] = await Promise.all([
    supabase.from('entity_types').select('id, name, plural').eq('workspace_id', workspaceId).order('sort_order'),
    supabase.from('entities').select(`*, contacts ( id, name, role, email, phone, whatsapp, notes, is_primary )`).eq('workspace_id', workspaceId).order('name'),
  ])

  const entityIds = (entities || []).map(e => e.id)
  const { data: negEntities } = entityIds.length > 0
    ? await supabase.from('negotiation_entities').select('entity_id, negotiation_id').in('entity_id', entityIds)
    : { data: [] }

  const negIds = [...new Set((negEntities || []).map(ne => ne.negotiation_id))]
  const { data: negsData } = negIds.length > 0
    ? await supabase.from('negotiations').select('id, product, title, status, currency').in('id', negIds)
    : { data: [] }

  const negIndex = {}
  for (const n of negsData || []) negIndex[n.id] = n

  const negByEntity = {}
  for (const ne of negEntities || []) {
    const neg = negIndex[ne.negotiation_id]
    if (!neg) continue
    if (!negByEntity[ne.entity_id]) negByEntity[ne.entity_id] = []
    negByEntity[ne.entity_id].push(neg)
  }

  const currencyByNeg = {}
  for (const n of negsData || []) currencyByNeg[n.id] = n.currency || 'USD'

  const { pendingByNeg, milestones } = await fetchExtraData(negIds)
  const pipeline = sumMilestonesByCurrency(milestones, currencyByNeg)
  const allNegotiations = Object.values(negIndex)

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  const typeBreakdown = (entityTypes || [])
    .map(t => ({ ...t, count: (entities || []).filter(e => e.entity_type_id === t.id).length }))
    .filter(t => t.count > 0)

  drawCover(doc, {
    title: 'Resumen de entidades',
    subtitle: workspaceName ? `Pipeline de licencias y negociaciones — ${workspaceName}` : 'Pipeline de licencias y negociaciones',
    statsLine: `${(entities || []).length} entidades  ·  ${allNegotiations.length} proyectos`,
  })

  doc.addPage()
  drawSummary(doc, { entities: entities || [], negotiations: allNegotiations, customStates, pipeline, typeBreakdown })
  const footerPages = [doc.internal.getNumberOfPages()]

  for (const type of typeBreakdown) {
    const typeEntities = (entities || [])
      .filter(e => e.entity_type_id === type.id)
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))

    // Página divisoria navy (mismo estilo que la portada) — no lleva pie de
    // página, el texto gris del footer no se leería sobre fondo navy.
    doc.addPage()
    drawCover(doc, {
      title: type.plural || type.name,
      subtitle: workspaceName ? `Nerva — ${workspaceName}` : 'Nerva',
      statsLine: `${typeEntities.length} ${(type.plural || type.name).toLowerCase()}`,
    })

    typeEntities.forEach((entity, idx) => {
      doc.addPage()
      drawEntityPage(doc, entity, {
        index: idx + 1,
        customStates,
        negotiations: negByEntity[entity.id] || [],
        pendingByNeg,
        typeLabelSingular: type.name,
      })
      footerPages.push(doc.internal.getNumberOfPages())
    })
  }

  const footerLabel = `NERVA${workspaceName ? ' · ' + workspaceName : ''} · Resumen de entidades`
  footerPages.forEach((pageNum, i) => {
    doc.setPage(pageNum)
    drawFooter(doc, { label: footerLabel, page: i + 1, total: footerPages.length })
  })

  doc.save(`nerva-entidades-${new Date().toISOString().slice(0, 10)}.pdf`)
}
