import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import QRCode from 'qrcode'
import { certificateWording, formatCertificateDate, type CertificateText } from '@/lib/certificates/content'

/**
 * Renders a certificate as an A4 landscape PDF. Deterministic: the same record
 * renders the same document (fixed metadata dates), so a re-download is
 * byte-identical to the first one.
 */

export interface CertificatePdfInput extends CertificateText {
  certificateNumber: string
  issuedAt: Date | null
  signatoryName: string | null
  signatoryTitle: string | null
  verificationUrl: string | null
  /** DRAFT / REVOKED watermark across the page. */
  watermark?: string | null
}

const INK = rgb(0.13, 0.12, 0.2)
const MUTED = rgb(0.4, 0.4, 0.47)
const BRAND = rgb(0.29, 0.22, 0.66)
const GOLD = rgb(0.72, 0.56, 0.24)

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

function centered(page: PDFPage, text: string, y: number, font: PDFFont, size: number, color = INK, spacing = 0) {
  const safe = pdfSafe(text)
  const width = font.widthOfTextAtSize(safe, size) + spacing * Math.max(safe.length - 1, 0)
  const x = (page.getWidth() - width) / 2
  if (!spacing) {
    page.drawText(safe, { x, y, size, font, color })
    return
  }
  let cursor = x
  for (const char of safe) {
    page.drawText(char, { x: cursor, y, size, font, color })
    cursor += font.widthOfTextAtSize(char, size) + spacing
  }
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || 'A'
  )
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
  const { width, height } = page.getSize()
  const serif = await doc.embedFont(StandardFonts.TimesRoman)
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold)
  const serifItalic = await doc.embedFont(StandardFonts.TimesRomanBoldItalic)
  const sans = await doc.embedFont(StandardFonts.Helvetica)
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold)

  // Background and frames.
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.995, 0.99, 0.975) })
  page.drawRectangle({ x: 18, y: 18, width: width - 36, height: height - 36, borderColor: BRAND, borderWidth: 3 })
  page.drawRectangle({ x: 28, y: 28, width: width - 56, height: height - 56, borderColor: GOLD, borderWidth: 0.8 })
  // Corner accents.
  for (const [cx, cy] of [
    [28, 28],
    [width - 28, 28],
    [28, height - 28],
    [width - 28, height - 28],
  ] as const) {
    page.drawRectangle({ x: cx - 5, y: cy - 5, width: 10, height: 10, color: GOLD, rotate: degrees(0) })
  }

  // Organization mark and name.
  page.drawCircle({ x: width / 2, y: height - 78, size: 20, color: BRAND })
  const mark = initials(pdfSafe(input.organizationName))
  page.drawText(mark, {
    x: width / 2 - sansBold.widthOfTextAtSize(mark, 15) / 2,
    y: height - 83,
    size: 15,
    font: sansBold,
    color: rgb(1, 1, 1),
  })
  centered(page, input.organizationName.toUpperCase(), height - 122, sansBold, 11, BRAND, 2.2)

  const wording = certificateWording(input)
  centered(page, wording.heading.toUpperCase(), height - 172, serifBold, 32, INK, 1.5)
  page.drawLine({ start: { x: width / 2 - 70, y: height - 186 }, end: { x: width / 2 + 70, y: height - 186 }, thickness: 1, color: GOLD })
  centered(page, wording.lead, height - 218, serif, 15, MUTED)

  // Recipient.
  let nameSize = 36
  const name = pdfSafe(input.recipientName)
  while (serifItalic.widthOfTextAtSize(name, nameSize) > width - 200 && nameSize > 20) nameSize -= 2
  centered(page, name, height - 266, serifItalic, nameSize, BRAND)
  page.drawLine({ start: { x: width / 2 - 200, y: height - 278 }, end: { x: width / 2 + 200, y: height - 278 }, thickness: 0.6, color: MUTED })

  // Body and citation.
  let y = height - 310
  for (const line of wrap(pdfSafe(wording.body), serif, 15, width - 220)) {
    centered(page, line, y, serif, 15, INK)
    y -= 21
  }
  if (input.citation) {
    y -= 4
    for (const line of wrap(pdfSafe(`“${input.citation}”`), serifItalic, 13, width - 260).slice(0, 3)) {
      centered(page, line, y, serifItalic, 13, MUTED)
      y -= 18
    }
  }

  // Footer: signature (left), seal + date (centre), QR + number (right).
  const footerY = 92
  page.drawLine({ start: { x: 90, y: footerY + 26 }, end: { x: 290, y: footerY + 26 }, thickness: 0.8, color: INK })
  page.drawText(pdfSafe(input.signatoryName ?? 'Authorised signatory'), { x: 90, y: footerY + 10, size: 12, font: sansBold, color: INK })
  page.drawText(pdfSafe(input.signatoryTitle ?? input.organizationName), { x: 90, y: footerY - 5, size: 10, font: sans, color: MUTED })

  page.drawCircle({ x: width / 2, y: footerY + 22, size: 30, borderColor: GOLD, borderWidth: 2 })
  page.drawCircle({ x: width / 2, y: footerY + 22, size: 24, borderColor: GOLD, borderWidth: 0.6 })
  centered(page, 'VERIFIED', footerY + 18, sansBold, 8, GOLD, 1)
  const issued = input.issuedAt ? `Issued ${formatCertificateDate(new Date(Date.UTC(input.issuedAt.getUTCFullYear(), input.issuedAt.getUTCMonth(), input.issuedAt.getUTCDate())))}` : 'Not yet issued'
  centered(page, issued, footerY - 22, sans, 10, MUTED)

  const qrSize = 74
  const qrX = width - 90 - qrSize
  if (input.verificationUrl) {
    const qr = QRCode.create(input.verificationUrl, { errorCorrectionLevel: 'M' })
    const cells = qr.modules.size
    const cell = qrSize / cells
    page.drawRectangle({ x: qrX - 4, y: footerY - 12, width: qrSize + 8, height: qrSize + 8, color: rgb(1, 1, 1) })
    for (let r = 0; r < cells; r++) {
      for (let c = 0; c < cells; c++) {
        if (qr.modules.get(r, c)) {
          page.drawRectangle({ x: qrX + c * cell, y: footerY - 8 + qrSize - (r + 1) * cell, width: cell + 0.05, height: cell + 0.05, color: INK })
        }
      }
    }
  } else {
    page.drawRectangle({ x: qrX, y: footerY - 8, width: qrSize, height: qrSize, borderColor: MUTED, borderWidth: 0.6 })
    page.drawText('QR on issue', { x: qrX + 12, y: footerY + 26, size: 8, font: sans, color: MUTED })
  }
  const numberText = pdfSafe(`No. ${input.certificateNumber}`)
  page.drawText(numberText, { x: qrX + qrSize - sans.widthOfTextAtSize(numberText, 8.5), y: footerY - 26, size: 8.5, font: sans, color: MUTED })
  if (input.verificationUrl) {
    const verify = pdfSafe(`Verify: ${input.verificationUrl.replace(/^https?:\/\//, '')}`)
    let size = 7.5
    while (sans.widthOfTextAtSize(verify, size) > 300 && size > 5.5) size -= 0.5
    page.drawText(verify, { x: qrX + qrSize - sans.widthOfTextAtSize(verify, size), y: footerY - 38, size, font: sans, color: MUTED })
  }

  if (input.watermark) {
    const text = input.watermark
    const size = 96
    page.drawText(text, {
      x: width / 2 - sansBold.widthOfTextAtSize(text, size) / 2 + 40,
      y: height / 2 - 120,
      size,
      font: sansBold,
      color: rgb(0.85, 0.2, 0.2),
      opacity: 0.16,
      rotate: degrees(22),
    })
  }

  return doc.save({ useObjectStreams: false })
}
