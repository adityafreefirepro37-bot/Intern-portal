/**
 * Knowledge-base text processing (pure — unit tested).
 *
 *   htmlToText      HTML (uploads, DOCX via mammoth) → Markdown-flavoured text,
 *                   keeping headings, lists and table rows; scripts/styles dropped.
 *   normalizeText   whitespace / control-character clean-up.
 *   chunkDocument   structure-aware chunks: split at headings and paragraphs (not
 *                   at arbitrary offsets), long paragraphs at sentence ends, a
 *                   one-sentence overlap, and each chunk's heading + page kept for citations.
 */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
}

function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''
    }
    return ENTITIES[code.toLowerCase()] ?? match
  })
}

export function htmlToText(html: string): string {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template|svg|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
  text = text
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, inner: string) => `\n\n${'#'.repeat(Number(level))} ${inner}\n\n`)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|ul|ol|table|blockquote|pre|h[1-6])>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
  return normalizeText(decodeEntities(text))
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/­/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface SourceSection {
  text: string
  /** 1-based page number (PDFs). */
  page?: number
}

export interface Chunk {
  index: number
  heading: string | null
  page: number | null
  content: string
  tokenCount: number
}

export interface ChunkOptions {
  /** Target size in characters (~4 characters per token). */
  target?: number
  max?: number
  overlap?: boolean
}

const HEADING = /^(#{1,6})\s+(.+)$/

/** A short standalone line that reads like a title (PDF/DOCX text has no markup). */
function looksLikeHeading(line: string) {
  if (line.length > 80 || line.length < 3 || /[.:;,!?]$/.test(line)) return false
  if (/^(\d+(\.\d+)*\.?|[IVX]+\.)\s+\S/.test(line)) return true
  const letters = line.replace(/[^A-Za-z]/g, '')
  return letters.length >= 3 && letters === letters.toUpperCase()
}

function sentences(text: string): string[] {
  return text.match(/[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text]
}

export function chunkDocument(sections: SourceSection[], options: ChunkOptions = {}): Chunk[] {
  const target = options.target ?? 1200
  const max = options.max ?? 2000
  const overlap = options.overlap ?? true
  const chunks: Chunk[] = []
  let heading: string | null = null
  let buffer: string[] = []
  let bufferPage: number | null = null
  let size = 0
  /** Paragraphs in the buffer that aren't just the overlap carried from the last chunk. */
  let fresh = 0

  const flush = () => {
    const content = buffer.join('\n\n').trim()
    if (content) {
      chunks.push({ index: chunks.length, heading, page: bufferPage, content, tokenCount: Math.ceil(content.length / 4) })
    }
    // Carry the last sentence forward so a fact split across chunks keeps its context.
    const tail = overlap && content ? sentences(buffer[buffer.length - 1] ?? '').at(-1) : undefined
    buffer = tail && tail.length < target / 4 ? [tail] : []
    size = buffer.reduce((n, b) => n + b.length, 0)
    fresh = 0
  }

  const addParagraph = (paragraph: string, page: number | null) => {
    if (paragraph.length > max) {
      // Split oversized paragraphs at sentence boundaries.
      let piece = ''
      for (const sentence of sentences(paragraph)) {
        if (piece && piece.length + sentence.length + 1 > target) {
          addParagraph(piece.trim(), page)
          piece = ''
        }
        piece += (piece ? ' ' : '') + (sentence.length > max ? sentence.slice(0, max) : sentence)
      }
      if (piece.trim()) addParagraph(piece.trim(), page)
      return
    }
    if (fresh && size + paragraph.length > target) flush()
    if (!fresh) bufferPage = page
    buffer.push(paragraph)
    size += paragraph.length
    fresh++
  }

  for (const section of sections) {
    const page = section.page ?? null
    // A chunk never spans pages, so a citation always names the right page.
    if (fresh && page !== bufferPage) flush()
    for (const block of normalizeText(section.text).split(/\n{2,}/)) {
      const lines = block.split('\n')
      const first = lines[0]?.trim() ?? ''
      const markdown = HEADING.exec(first)
      const plainHeading = !markdown && lines.length === 1 && looksLikeHeading(first)
      if (markdown || plainHeading) {
        // A new section starts a new chunk, so every chunk carries its own heading
        // (no overlap across sections).
        if (fresh) flush()
        buffer = []
        size = 0
        heading = (markdown ? markdown[2] : first).trim().slice(0, 200)
        const rest = lines.slice(1).join('\n').trim()
        if (rest) addParagraph(rest, page)
        continue
      }
      const paragraph = block.trim()
      if (paragraph) addParagraph(paragraph, page)
    }
  }
  // A buffer holding only the overlap sentence is already stored in the previous chunk.
  if (fresh) flush()
  return chunks
}

/** Text sent to the embedding model: the heading gives the chunk its topic. */
export function embeddingText(chunk: Pick<Chunk, 'heading' | 'content'>, title: string) {
  return [title, chunk.heading, chunk.content].filter(Boolean).join('\n\n').slice(0, 6000)
}
