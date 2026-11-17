import { PDFDocument, StandardFonts, degrees, rgb, type Color, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import QRCode from 'qrcode'
import { certificateWording, formatCertificateDate, ribbonText, type CertificateText } from '@/lib/certificates/content'
import { LOGO_LIGHT_BG_PNG, MARK_DARK_BG_PNG, MARK_LIGHT_BG_PNG, PARTNER_DIGITAL_INDIA_PNG, PARTNER_MSME_PNG } from './brand-assets'

/**
 * Renders a certificate as an A4 landscape PDF in the Ayava Creatives identity:
 * the logo from ayavacreatives.com, its charcoal and green → teal → blue
 * gradient, gold accents, an ornamental frame, a ribbon and a logo seal.
 * Deterministic: the same record renders the same document (fixed metadata
 * dates), so a re-download is byte-identical to the first one.
 */

export interface CertificatePdfInput extends CertificateText {
  certificateNumber: string
  issuedAt: Date | null
  signatoryName: string | null
  signatoryTitle: string | null
  verificationUrl: string | null
  /** DRAFT / REVOKED / SAMPLE watermark across the page. */
  watermark?: string | null
  /**
   * Government programme marks beside the logo. Only passed when certificate
   * settings enable them with an approval reference (see certificate.service).
   */
  partnerLogos?: PartnerLogo[]
}

export type PartnerLogo = 'msme' | 'digitalIndia'
const PARTNER_PNG: Record<PartnerLogo, string> = { msme: PARTNER_MSME_PNG, digitalIndia: PARTNER_DIGITAL_INDIA_PNG }

// Ayava Creatives palette (sampled from the logo).
const INK = rgb(0x1c / 255, 0x1b / 255, 0x1b / 255)
const MUTED = rgb(0.36, 0.36, 0.38)
const GOLD = rgb(0.76, 0.6, 0.27)
const PAPER = rgb(0.992, 0.988, 0.972)
const GRADIENT: [number, number, number][] = [
  [0x01, 0xcd, 0x84], // green
  [0x00, 0xb4, 0xf0], // sky teal
  [0x01, 0x89, 0xf9], // blue
]

/** A colour along the brand gradient, t in [0, 1]. */
function gradientAt(t: number): Color {
  const x = Math.min(Math.max(t, 0), 1) * (GRADIENT.length - 1)
  const i = Math.min(Math.floor(x), GRADIENT.length - 2)
  const f = x - i
  const [a, b] = [GRADIENT[i]!, GRADIENT[i + 1]!]
  return rgb((a[0] + (b[0] - a[0]) * f) / 255, (a[1] + (b[1] - a[1]) * f) / 255, (a[2] + (b[2] - a[2]) * f) / 255)
}

/** The standard PDF fonts only cover Windows-1252; anything else is transliterated or replaced. */
export function pdfSafe(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”…•]/g, '?')
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

/** Wraps into as few lines as `maxWidth` allows, then evens them out (no one-word last line). */
function balancedWrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines = wrap(text, font, size, maxWidth)
  if (lines.length < 2) return lines
  let low = maxWidth / lines.length
  let high = maxWidth
  for (let i = 0; i < 12; i++) {
    const mid = (low + high) / 2
    if (wrap(text, font, size, mid).length > lines.length) low = mid
    else high = mid
  }
  return wrap(text, font, size, high)
}

function spacedWidth(text: string, font: PDFFont, size: number, spacing: number) {
  return font.widthOfTextAtSize(text, size) + spacing * Math.max(text.length - 1, 0)
}

/** Centred text (optionally letter-spaced) around x = cx. */
function centered(page: PDFPage, text: string, cx: number, y: number, font: PDFFont, size: number, color: Color, spacing = 0) {
  const safe = pdfSafe(text)
  let x = cx - spacedWidth(safe, font, size, spacing) / 2
  if (!spacing) {
    page.drawText(safe, { x, y, size, font, color })
    return
  }
  for (const char of safe) {
    page.drawText(char, { x, y, size, font, color })
    x += font.widthOfTextAtSize(char, size) + spacing
  }
}

/** A rectangle filled with the brand gradient, along x (horizontal) or y. */
function gradientRect(page: PDFPage, x: number, y: number, w: number, h: number, horizontal = true, opacity = 1) {
  const steps = Math.max(2, Math.round((horizontal ? w : h) / 3))
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1)
    if (horizontal) page.drawRectangle({ x: x + (w * i) / steps, y, width: w / steps + 0.4, height: h, color: gradientAt(t), opacity })
    else page.drawRectangle({ x, y: y + (h * i) / steps, width: w, height: h / steps + 0.4, color: gradientAt(t), opacity })
  }
}

/** Gold corner ornament; (sx, sy) point inwards from the corner (page coordinates). */
function cornerOrnament(page: PDFPage, ox: number, oy: number, sx: number, sy: number) {
  const line = (x1: number, y1: number, x2: number, y2: number, thickness: number, color: Color) =>
    page.drawLine({ start: { x: ox + sx * x1, y: oy + sy * y1 }, end: { x: ox + sx * x2, y: oy + sy * y2 }, thickness, color })
  line(0, 0, 78, 0, 1.4, GOLD)
  line(0, 0, 0, 78, 1.4, GOLD)
  line(7, 7, 52, 7, 0.7, INK)
  line(7, 7, 7, 52, 0.7, INK)
  // Curl joining the two arms.
  page.drawSvgPath(`M ${sx * 22} ${-sy * 46} Q ${sx * 22} ${-sy * 22} ${sx * 46} ${-sy * 22}`, {
    x: ox,
    y: oy,
    borderColor: GOLD,
    borderWidth: 0.9,
  })
  // Diamond.
  const d = 5.5
  page.drawSvgPath(`M ${sx * 15} ${-sy * (15 - d)} L ${sx * (15 + d)} ${-sy * 15} L ${sx * 15} ${-sy * (15 + d)} L ${sx * (15 - d)} ${-sy * 15} Z`, {
    x: ox,
    y: oy,
    color: gradientAt(sx > 0 ? 0.2 : 0.8),
  })
  page.drawCircle({ x: ox + sx * 88, y: oy, size: 1.8, color: GOLD })
  page.drawCircle({ x: ox, y: oy + sy * 88, size: 1.8, color: GOLD })
}

/** Ribbon banner with folded tails, filled with the brand gradient. */
function ribbon(page: PDFPage, cx: number, y: number, text: string, font: PDFFont) {
  const label = pdfSafe(text.toUpperCase())
  const size = 12
  const spacing = 3.2
  const w = Math.max(250, spacedWidth(label, font, size, spacing) + 70)
  const h = 26
  const x = cx - w / 2
  const tail = 22
  const drop = 7
  const dark = rgb(0.02, 0.35, 0.42)
  // Tails (behind), with a V notch at the outer ends.
  for (const side of [-1, 1] as const) {
    const edge = side < 0 ? x : x + w
    const outer = edge + side * tail
    page.drawSvgPath(
      `M ${edge - side * 12} ${-(y - drop)} L ${outer} ${-(y - drop)} L ${outer - side * 9} ${-(y - drop + h / 2)} L ${outer} ${-(y - drop + h)} L ${edge - side * 12} ${-(y - drop + h)} Z`,
      { x: 0, y: 0, color: dark },
    )
    // Fold shadow.
    page.drawSvgPath(`M ${edge} ${-y} L ${edge - side * 12} ${-(y - drop)} L ${edge - side * 12} ${-y} Z`, { x: 0, y: 0, color: INK })
  }
  gradientRect(page, x, y, w, h)
  page.drawLine({ start: { x: x + 6, y: y + 3.5 }, end: { x: x + w - 6, y: y + 3.5 }, thickness: 0.5, color: rgb(1, 1, 1), opacity: 0.6 })
  page.drawLine({ start: { x: x + 6, y: y + h - 3.5 }, end: { x: x + w - 6, y: y + h - 3.5 }, thickness: 0.5, color: rgb(1, 1, 1), opacity: 0.6 })
  centered(page, label, cx, y + 8.6, font, size, rgb(1, 1, 1), spacing)
}

/** Round seal: gradient ring, charcoal disc with the logo mark, circular tagline in gold. */
function seal(page: PDFPage, cx: number, cy: number, mark: PDFImage, font: PDFFont) {
  const R = 44
  const segments = 120
  for (let i = 0; i < segments; i++) {
    const a1 = (i / segments) * Math.PI * 2
    const a2 = ((i + 1.15) / segments) * Math.PI * 2
    page.drawLine({
      start: { x: cx + R * Math.cos(a1), y: cy + R * Math.sin(a1) },
      end: { x: cx + R * Math.cos(a2), y: cy + R * Math.sin(a2) },
      thickness: 5,
      color: gradientAt(Math.abs(Math.sin(a1 / 2))),
    })
  }
  page.drawCircle({ x: cx, y: cy, size: R - 3, color: INK })
  page.drawCircle({ x: cx, y: cy, size: R - 6, borderColor: GOLD, borderWidth: 0.6 })
  // Tagline around the inside of the ring, starting at the top-left, clockwise.
  const text = 'CREATE • CONNECT • CONVERT • '
  const size = 5.6
  const r = R - 12
  const total = [...text].reduce((n, c) => n + font.widthOfTextAtSize(c, size) + 1.1, 0)
  let angle = Math.PI / 2 + total / r / 2
  for (const char of text) {
    const w = font.widthOfTextAtSize(char, size) + 1.1
    const mid = angle - w / r / 2
    // Rotate each glyph so its baseline is tangent to the circle; start it half a glyph before `mid`.
    const rot = mid - Math.PI / 2
    const half = font.widthOfTextAtSize(char, size) / 2
    page.drawText(char, {
      x: cx + r * Math.cos(mid) - half * Math.cos(rot),
      y: cy + r * Math.sin(mid) - half * Math.sin(rot),
      size,
      font,
      color: GOLD,
      rotate: degrees((rot * 180) / Math.PI),
    })
    angle -= w / r
  }
  const mw = 34
  const mh = (mark.height / mark.width) * mw
  page.drawImage(mark, { x: cx - mw / 2, y: cy - mh / 2 - 1, width: mw, height: mh })
}

export async function renderCertificatePdf(input: CertificatePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const stamp = input.issuedAt ?? new Date(Date.UTC(2026, 0, 1))
  doc.setTitle(pdfSafe(`${input.recipientName} — certificate ${input.certificateNumber}`))
  doc.setAuthor(pdfSafe(input.organizationName))
  doc.setSubject('Certificate')
  doc.setCreator('AYAVA Intern OS')
  doc.setProducer('AYAVA Intern OS')
  doc.setCreationDate(stamp)
  doc.setModificationDate(stamp)

  const page = doc.addPage([841.89, 595.28]) // A4 landscape
  const { width: W, height: H } = page.getSize()
  const cx = W / 2
  const serif = await doc.embedFont(StandardFonts.TimesRoman)
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold)
  const serifItalic = await doc.embedFont(StandardFonts.TimesRomanItalic)
  const serifBoldItalic = await doc.embedFont(StandardFonts.TimesRomanBoldItalic)
  const sans = await doc.embedFont(StandardFonts.Helvetica)
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold)
  const logo = await doc.embedPng(Buffer.from(LOGO_LIGHT_BG_PNG, 'base64'))
  const markLight = await doc.embedPng(Buffer.from(MARK_LIGHT_BG_PNG, 'base64'))
  const markDark = await doc.embedPng(Buffer.from(MARK_DARK_BG_PNG, 'base64'))

  // Paper and background ripples from two corners.
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: PAPER })
  for (let r = 70; r <= 330; r += 18) {
    page.drawCircle({ x: 0, y: 0, size: r, borderColor: gradientAt(0.15), borderWidth: 0.5, borderOpacity: 0.12 })
    page.drawCircle({ x: W, y: H, size: r, borderColor: gradientAt(0.85), borderWidth: 0.5, borderOpacity: 0.12 })
  }
  // Faint logo mark behind the text.
  const wmW = 300
  const wmH = (markLight.height / markLight.width) * wmW
  page.drawImage(markLight, { x: cx - wmW / 2, y: H / 2 - wmH / 2 - 20, width: wmW, height: wmH, opacity: 0.045 })

  // Frame: charcoal outline, gradient band (green left → blue right), gold hairline.
  page.drawRectangle({ x: 14, y: 14, width: W - 28, height: H - 28, borderColor: INK, borderWidth: 2.2 })
  const band = 6
  gradientRect(page, 20, H - 20 - band, W - 40, band)
  gradientRect(page, 20, 20, W - 40, band)
  page.drawRectangle({ x: 20, y: 20, width: band, height: H - 40, color: gradientAt(0) })
  page.drawRectangle({ x: W - 20 - band, y: 20, width: band, height: H - 40, color: gradientAt(1) })
  page.drawRectangle({ x: 34, y: 34, width: W - 68, height: H - 68, borderColor: GOLD, borderWidth: 0.8 })
  cornerOrnament(page, 42, H - 42, 1, -1)
  cornerOrnament(page, W - 42, H - 42, -1, -1)
  cornerOrnament(page, 42, 42, 1, 1)
  cornerOrnament(page, W - 42, 42, -1, 1)

  // Logo.
  const logoH = 84
  const logoW = (logo.width / logo.height) * logoH
  page.drawImage(logo, { x: cx - logoW / 2, y: H - 52 - logoH, width: logoW, height: logoH })

  // Approved partner marks: MSME on the left, Digital India on the right, level with the logo.
  // Fixed order, whatever order they were passed in, so the document stays deterministic.
  for (const key of (['msme', 'digitalIndia'] as const).filter((k) => input.partnerLogos?.includes(k))) {
    const image = await doc.embedPng(Buffer.from(PARTNER_PNG[key], 'base64'))
    const h = 44
    const w = Math.min((image.width / image.height) * h, 120)
    const left = key === 'msme'
    const x = left ? 140 : W - 140 - w
    page.drawImage(image, { x, y: H - 52 - logoH / 2 - ((image.height / image.width) * w) / 2, width: w, height: (image.height / image.width) * w })
  }

  // Title and ribbon.
  centered(page, 'CERTIFICATE', cx, H - 186, serifBold, 40, INK, 7)
  ribbon(page, cx, H - 226, ribbonText(input), sansBold)

  const wording = certificateWording(input)
  centered(page, wording.lead, cx, H - 260, serifItalic, 14.5, MUTED)

  // Recipient with a gradient underline.
  let nameSize = 38
  const name = pdfSafe(input.recipientName)
  while (serifBoldItalic.widthOfTextAtSize(name, nameSize) > W - 240 && nameSize > 20) nameSize -= 2
  centered(page, name, cx, H - 304, serifBoldItalic, nameSize, INK)
  const underline = Math.max(300, serifBoldItalic.widthOfTextAtSize(name, nameSize) + 80)
  gradientRect(page, cx - underline / 2, H - 316, underline, 1.6)
  page.drawCircle({ x: cx - underline / 2 - 5, y: H - 315.2, size: 2, color: GOLD })
  page.drawCircle({ x: cx + underline / 2 + 5, y: H - 315.2, size: 2, color: GOLD })

  // Body and citation.
  let y = H - 344
  for (const line of balancedWrap(pdfSafe(wording.body), serif, 14.5, W - 250)) {
    centered(page, line, cx, y, serif, 14.5, INK)
    y -= 20
  }
  if (input.citation) {
    y -= 2
    for (const line of balancedWrap(pdfSafe(`“${input.citation}”`), serifItalic, 13, W - 300).slice(0, 3)) {
      centered(page, line, cx, y, serifItalic, 13, MUTED)
      y -= 17
    }
  }

  // Footer: signature (left), seal + date (centre), QR + number (right).
  const footerY = 96
  page.drawLine({ start: { x: 96, y: footerY + 30 }, end: { x: 292, y: footerY + 30 }, thickness: 0.8, color: INK })
  page.drawCircle({ x: 96, y: footerY + 30, size: 1.6, color: GOLD })
  page.drawCircle({ x: 292, y: footerY + 30, size: 1.6, color: GOLD })
  page.drawText(pdfSafe(input.signatoryName ?? 'Authorised signatory'), { x: 96, y: footerY + 14, size: 12, font: sansBold, color: INK })
  page.drawText(pdfSafe(input.signatoryTitle ?? input.organizationName), { x: 96, y: footerY, size: 9.5, font: sans, color: MUTED })

  seal(page, cx, footerY + 26, markDark, sansBold)
  const issuedDay = input.issuedAt
    ? new Date(Date.UTC(input.issuedAt.getUTCFullYear(), input.issuedAt.getUTCMonth(), input.issuedAt.getUTCDate()))
    : null
  centered(page, issuedDay ? `Issued ${formatCertificateDate(issuedDay)}` : 'Not yet issued', cx, footerY - 32, sans, 9.5, MUTED)

  const qrSize = 70
  const qrX = W - 96 - qrSize
  const qrY = footerY - 6
  if (input.verificationUrl) {
    const qr = QRCode.create(input.verificationUrl, { errorCorrectionLevel: 'M' })
    const cells = qr.modules.size
    const cell = qrSize / cells
    page.drawRectangle({ x: qrX - 5, y: qrY - 5, width: qrSize + 10, height: qrSize + 10, color: rgb(1, 1, 1), borderColor: GOLD, borderWidth: 0.6 })
    for (let r = 0; r < cells; r++) {
      for (let c = 0; c < cells; c++) {
        if (qr.modules.get(r, c)) {
          page.drawRectangle({ x: qrX + c * cell, y: qrY + qrSize - (r + 1) * cell, width: cell + 0.05, height: cell + 0.05, color: INK })
        }
      }
    }
  } else {
    page.drawRectangle({ x: qrX, y: qrY, width: qrSize, height: qrSize, borderColor: MUTED, borderWidth: 0.6 })
    page.drawText('QR on issue', { x: qrX + 12, y: qrY + 32, size: 8, font: sans, color: MUTED })
  }
  const numberText = pdfSafe(`No. ${input.certificateNumber}`)
  page.drawText(numberText, { x: qrX + qrSize - sansBold.widthOfTextAtSize(numberText, 8.5), y: qrY - 20, size: 8.5, font: sansBold, color: INK })
  if (input.verificationUrl) {
    const verify = pdfSafe(`Verify: ${input.verificationUrl.replace(/^https?:\/\//, '')}`)
    let size = 7.5
    while (sans.widthOfTextAtSize(verify, size) > 290 && size > 5.5) size -= 0.5
    page.drawText(verify, { x: qrX + qrSize - sans.widthOfTextAtSize(verify, size), y: qrY - 32, size, font: sans, color: MUTED })
  }

  if (input.watermark) {
    const text = input.watermark
    const size = 96
    page.drawText(text, {
      x: cx - sansBold.widthOfTextAtSize(text, size) / 2 + 40,
      y: H / 2 - 120,
      size,
      font: sansBold,
      color: rgb(0.85, 0.2, 0.2),
      opacity: 0.14,
      rotate: degrees(22),
    })
  }

  return doc.save({ useObjectStreams: false })
}
