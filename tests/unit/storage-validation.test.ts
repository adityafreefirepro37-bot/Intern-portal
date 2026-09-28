import { fileExtension, sanitizeDisplayName, validateUpload } from '@/lib/storage/validation'

const PDF_HEAD = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const EXE_HEAD = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00])
const MB = 1024 * 1024

describe('validateUpload', () => {
  const options = { category: 'document' as const, maxBytes: 10 * MB }

  it('accepts a real PDF', () => {
    const result = validateUpload(
      { fileName: 'offer.pdf', mimeType: 'application/pdf', size: 2048, head: PDF_HEAD },
      options,
    )
    expect(result).toEqual({ valid: true, errors: [], extension: '.pdf' })
  })

  it('rejects an executable disguised as a PDF', () => {
    const result = validateUpload(
      { fileName: 'offer.pdf', mimeType: 'application/pdf', size: 2048, head: EXE_HEAD },
      options,
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('File contents do not match its type')
  })

  it('rejects mismatched extension and MIME type', () => {
    const result = validateUpload({ fileName: 'photo.pdf', mimeType: 'image/png', size: 100, head: PNG_HEAD }, options)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('The file extension does not match its type')
  })

  it('rejects types not allowed for the category', () => {
    const result = validateUpload(
      { fileName: 'notes.txt', mimeType: 'text/plain', size: 10, head: new Uint8Array([0x68, 0x69, 0x21, 0x0a]) },
      options,
    )
    expect(result.errors).toContain('This file type is not allowed')
  })

  it('rejects empty and oversized files', () => {
    const empty = validateUpload({ fileName: 'a.pdf', mimeType: 'application/pdf', size: 0, head: PDF_HEAD }, options)
    const huge = validateUpload(
      { fileName: 'a.pdf', mimeType: 'application/pdf', size: 11 * MB, head: PDF_HEAD },
      options,
    )
    expect(empty.errors).toContain('The file is empty')
    expect(huge.errors).toContain('The file exceeds the 10 MB limit')
  })

  it('requires file contents when the type has a signature', () => {
    const result = validateUpload({ fileName: 'a.pdf', mimeType: 'application/pdf', size: 10 }, options)
    expect(result.errors).toContain('File contents could not be verified')
  })

  it('normalizes MIME parameters and case', () => {
    const result = validateUpload(
      { fileName: 'A.PDF', mimeType: 'Application/PDF; charset=binary', size: 10, head: PDF_HEAD },
      options,
    )
    expect(result.valid).toBe(true)
  })
})

describe('file names', () => {
  it('extracts extensions safely', () => {
    expect(fileExtension('report.final.PDF')).toBe('.pdf')
    expect(fileExtension('.env')).toBe('')
    expect(fileExtension('C:\\Users\\x\\cv.docx')).toBe('.docx')
  })

  it('strips paths, control characters and reserved characters', () => {
    expect(sanitizeDisplayName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeDisplayName('..\\..\\evil.pdf')).toBe('evil.pdf')
    expect(sanitizeDisplayName('my<cv>\u0000.pdf')).toBe('mycv.pdf')
    expect(sanitizeDisplayName('...')).toBe('file')
  })

  it('limits length but keeps the extension', () => {
    const name = sanitizeDisplayName(`${'a'.repeat(300)}.pdf`)
    expect(name.length).toBe(120)
    expect(name.endsWith('.pdf')).toBe(true)
  })
})
