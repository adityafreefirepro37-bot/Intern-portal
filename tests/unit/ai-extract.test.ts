import { spawnSync } from 'node:child_process'
import path from 'node:path'
import JSZip from 'jszip'
import { chunkDocument, type SourceSection } from '@/lib/ai/chunk'
import { extractSections, sectionsToText } from '@/server/ai/extract'

/** A minimal, valid PDF with one text line per page. */
function makePdf(pages: string[]): Uint8Array {
  const objects: string[] = []
  const pageIds = pages.map((_, i) => 3 + i * 2)
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`
  const fontId = 3 + pages.length * 2
  pages.forEach((text, i) => {
    const pageId = pageIds[i]
    const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${pageId + 1} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`
    objects[pageId + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  })
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = body.length
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xref = body.length
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id++) body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(body)
}

/** A real .docx: a zip holding the minimum OOXML parts. */
async function makeDocx(paragraphs: { text: string; style?: string }[]): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  )
  const body = paragraphs
    .map((p) => `<w:p>${p.style ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>` : ''}<w:r><w:t>${p.text}</w:t></w:r></w:p>`)
    .join('')
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  )
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
}

/** PDF.js needs real dynamic imports, which Jest's sandbox lacks: run extraction in plain Node. */
function extractInNode(bytes: Uint8Array, mimeType: string) {
  const result = spawnSync(
    process.execPath,
    ['--conditions=react-server', '--import', 'tsx', path.join('tests', 'unit', 'support', 'extract-cli.ts'), mimeType],
    { input: Buffer.from(bytes).toString('base64'), encoding: 'utf8', timeout: 60_000 },
  )
  if (result.status !== 0) throw new Error(`extract-cli failed: ${result.stderr}`)
  return JSON.parse(result.stdout) as { sections?: SourceSection[]; error?: string; message?: string }
}

const encode = (text: string) => new TextEncoder().encode(text)
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

describe('knowledge text extraction', () => {
  it('reads a PDF page by page, so citations can name the page', () => {
    const { sections = [], message } = extractInNode(makePdf(['Leave requests need three days notice.', 'Sick leave needs a call.']), 'application/pdf')
    expect(message).toBeUndefined()
    expect(sections).toEqual([
      { text: 'Leave requests need three days notice.', page: 1 },
      { text: 'Sick leave needs a call.', page: 2 },
    ])
    expect(sectionsToText(sections)).toContain('[Page 2]\nSick leave needs a call.')
    expect(chunkDocument(sections).map((c) => c.page)).toEqual([1, 2])
  })

  it('explains a PDF with no text layer', () => {
    expect(extractInNode(makePdf(['']), 'application/pdf').message).toMatch(/Scanned PDFs need OCR/)
  })

  it('rejects a corrupt PDF rather than storing garbage', () => {
    const { sections, error } = extractInNode(encode('%PDF-1.4 this is not really a pdf'), 'application/pdf')
    expect(sections).toBeUndefined()
    expect(error).toBeTruthy()
  })

  it('reads a Word document and keeps its headings', async () => {
    const bytes = await makeDocx([
      { text: 'Leave Policy', style: 'Heading1' },
      { text: 'Ask three days ahead.' },
      { text: 'Sick leave', style: 'Heading2' },
      { text: 'Tell your mentor.' },
    ])
    const sections = await extractSections(bytes, DOCX)
    const chunks = chunkDocument(sections)
    expect(chunks.map((c) => [c.heading, c.content])).toEqual([
      ['Leave Policy', 'Ask three days ahead.'],
      ['Sick leave', 'Tell your mentor.'],
    ])
  })

  it('rejects a corrupt Word file', async () => {
    await expect(extractSections(encode('PK not really a zip'), DOCX)).rejects.toThrow()
  })

  it('strips scripts from HTML and keeps structure', async () => {
    const sections = await extractSections(encode('<h2>Rules</h2><script>steal()</script><p>Be kind.</p>'), 'text/html')
    expect(sections[0].text).toBe('## Rules\n\nBe kind.')
  })

  it('reads Markdown and plain text', async () => {
    expect((await extractSections(encode('# Title\r\n\r\nBody'), 'text/markdown'))[0].text).toBe('# Title\n\nBody')
    expect((await extractSections(encode('Plain   text'), 'text/plain'))[0].text).toBe('Plain text')
  })

  it('refuses other types and empty documents', async () => {
    await expect(extractSections(encode('x'), 'image/png')).rejects.toThrow(/can’t be added/)
    await expect(extractSections(encode('   \n '), 'text/plain')).rejects.toThrow(/No text found/)
  })
})
