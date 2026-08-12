// Helpers y constantes visuales compartidas entre los distintos exports a PDF
// (Proyectos, Entidades/Proveedores) — mismo lenguaje visual en todos.

export const NAVY = [11, 31, 58]
export const ACCENT = [147, 197, 253]
export const MUTED = [148, 163, 184]
export const GRAY_BG = [241, 245, 249]
export const GRAY_TEXT = [100, 116, 139]
export const BORDER = [226, 232, 240]
export const INK = [31, 41, 55]

export const PAGE_W = 297
export const PAGE_H = 210
export const MARGIN = 20

export function setText(doc, rgb) { doc.setTextColor(rgb[0], rgb[1], rgb[2]) }
export function setFill(doc, rgb) { doc.setFillColor(rgb[0], rgb[1], rgb[2]) }
export function setDraw(doc, rgb) { doc.setDrawColor(rgb[0], rgb[1], rgb[2]) }

export function formatDatePdf(d) {
  if (!d) return ''
  const date = new Date(d.length === 10 ? d + 'T00:00:00' : d)
  if (isNaN(date)) return d
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${date.getFullYear()}`
}

export function stateColorRgb(hex) {
  if (!hex) return GRAY_TEXT
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

export function drawPill(doc, x, y, text, textRgb, bgRgb) {
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

export function drawCover(doc, { title, subtitle, statsLine }) {
  setFill(doc, NAVY)
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F')

  setText(doc, ACCENT)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('NERVA', MARGIN, 98)

  setText(doc, [255, 255, 255])
  doc.setFontSize(30)
  doc.text(title, MARGIN, 114)

  setText(doc, [203, 213, 225])
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  doc.text(subtitle, MARGIN, 123)

  setText(doc, MUTED)
  doc.setFontSize(10)
  const dateStr = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
  doc.text(`${statsLine}  ·  ${dateStr}`, MARGIN, 144)
}

export function drawFooter(doc, { label, page, total }) {
  setDraw(doc, BORDER)
  doc.setLineWidth(0.2)
  doc.line(MARGIN, 202, PAGE_W - MARGIN, 202)
  setText(doc, GRAY_TEXT)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(label, MARGIN, 207)
  doc.text(`${page} / ${total}`, PAGE_W - MARGIN, 207, { align: 'right' })
}

// Tarjetas de stat en fila + devuelve el Y donde termina el bloque. El ancho
// de cada una se ajusta según cuántas entren — antes era fijo (62mm) porque
// siempre eran 4, pero un workspace puede tener varios estados finales y
// entonces la cantidad de tarjetas varía.
export function drawStatCards(doc, cards, startY) {
  const cardH = 28, gap = 6, startX = MARGIN
  const available = PAGE_W - startX * 2
  const cardW = Math.min(62, (available - gap * (cards.length - 1)) / cards.length)
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
  return startY + cardH
}

// Barra horizontal "Pipeline por estado" (o cualquier breakdown por custom_state)
export function drawStateBarChart(doc, counts, startY) {
  const maxCount = Math.max(1, ...counts.map(c => c.count))
  const barMaxW = 160, labelW = 42, barX = MARGIN + labelW, barH = 6, rowGap = 10
  counts.forEach((s, i) => {
    const rowY = startY + i * rowGap
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
  return startY + counts.length * rowGap
}
