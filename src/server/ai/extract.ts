import 'server-only'
import { ValidationError } from '@/lib/errors'
import { htmlToText, normalizeText, type SourceSection } from '@/lib/ai/chunk'

/**
 * Text extraction for knowledge documents. Runs on bytes already validated
 * and stored by the storage service; nothing here touches the filesystem.
 *
 *   PDF   unpdf (PDF.js) — one section per page, so citations can name the page
 *   DOCX  mammoth → HTML → text with headings and lists kept
 *   HTML  tags stripped, structure kept (scripts/styles dropped)
 *   MD / TXT  as is
 */

export const KNOWLEDGE_MIME_TYPES = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'text/plain': 'Text',
  'text/markdown': 'Markdown',
  'text/html': 'HTML',
} as const

/** The text cap for one document (characters) — larger documents should be split. */
const MAX_CHARS = 1_500_000

export async function extractSections(bytes: Uint8Array, mimeType: string): Promise<SourceSection[]> {
  let sections: SourceSection[]
  switch (mimeType) {
    case 'application/pdf': {
      const { extractText, getDocumentProxy } = await import('unpdf')
      const pdf = await getDocumentProxy(new Uint8Array(bytes))
      const { text } = await extractText(pdf, { mergePages: false })
      sections = (Array.isArray(text) ? text : [text]).map((page, i) => ({ text: normalizeText(page), page: i + 1 }))
      break
    }
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      const mammoth = await import('mammoth')
      const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) })
      sections = [{ text: htmlToText(value) }]
      break
    }
    case 'text/html':
      sections = [{ text: htmlToText(new TextDecoder().decode(bytes)) }]
      break
    case 'text/plain':
    case 'text/markdown':
      sections = [{ text: normalizeText(new TextDecoder().decode(bytes)) }]
      break
    default:
      throw new ValidationError('This file type can’t be added to the knowledge base')
  }
  sections = sections.filter((s) => s.text.length > 0)
  const total = sections.reduce((n, s) => n + s.text.length, 0)
  if (total === 0) {
    throw new ValidationError(
      mimeType === 'application/pdf'
        ? 'No text found in this PDF. Scanned PDFs need OCR before upload.'
        : 'No text found in this document.',
    )
  }
  if (total > MAX_CHARS) throw new ValidationError('This document is too long; split it into smaller documents.')
  return sections
}

/** Plain text of the sections (stored on the document for search and summaries). */
export function sectionsToText(sections: SourceSection[]) {
  return sections.map((s) => (s.page ? `[Page ${s.page}]\n${s.text}` : s.text)).join('\n\n')
}
