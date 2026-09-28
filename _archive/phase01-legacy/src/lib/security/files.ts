const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
])

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf'])

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export function validateUpload(input: {
  filename: string
  mimeType: string
  size: number
}): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const name = input.filename.replace(/\\/g, '/').split('/').pop() ?? ''
  const ext = name.includes('.') ? `.${name.split('.').pop()?.toLowerCase()}` : ''

  if (!name || name.includes('..')) {
    errors.push('Invalid filename')
  }
  if (!ALLOWED_EXT.has(ext)) {
    errors.push('File type is not allowed')
  }
  if (!ALLOWED_MIME.has(input.mimeType)) {
    errors.push('MIME type is not allowed')
  }
  if (input.size <= 0 || input.size > MAX_UPLOAD_BYTES) {
    errors.push('File size is invalid')
  }
  return { valid: errors.length === 0, errors }
}
