/**
 * Upload validation. Pure functions — safe to unit test and to reuse in the
 * browser for early feedback, but the server result is the one that counts.
 *
 * Rules:
 *  - MIME type must be on the allowlist for the upload category.
 *  - The file extension must match the declared MIME type.
 *  - The leading bytes must match the MIME type's signature (when known),
 *    so a renamed executable cannot pass as a PDF.
 *  - Size must be within the configured limit.
 *  - The user's filename is never used as a storage path; it is only kept
 *    (sanitized) as a display name.
 */

export type UploadCategory = 'document' | 'image' | 'attachment'

interface FileTypeRule {
  extensions: readonly string[]
  /** Byte signatures at offset 0; any match passes. */
  signatures?: readonly (readonly number[])[]
}

const PDF = [0x25, 0x50, 0x44, 0x46] // %PDF
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff]
const RIFF = [0x52, 0x49, 0x46, 0x46] // WEBP container
const ZIP = [0x50, 0x4b, 0x03, 0x04] // docx/xlsx/pptx

export const FILE_TYPES: Record<string, FileTypeRule> = {
  'application/pdf': { extensions: ['.pdf'], signatures: [PDF] },
  'image/png': { extensions: ['.png'], signatures: [PNG] },
  'image/jpeg': { extensions: ['.jpg', '.jpeg'], signatures: [JPEG] },
  'image/webp': { extensions: ['.webp'], signatures: [RIFF] },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    extensions: ['.docx'],
    signatures: [ZIP],
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { extensions: ['.xlsx'], signatures: [ZIP] },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    extensions: ['.pptx'],
    signatures: [ZIP],
  },
  'text/plain': { extensions: ['.txt'] },
  'text/csv': { extensions: ['.csv'] },
}

export const CATEGORY_MIME_TYPES: Record<UploadCategory, readonly string[]> = {
  document: [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  image: ['image/png', 'image/jpeg', 'image/webp'],
  attachment: Object.keys(FILE_TYPES),
}

export interface UploadCandidate {
  fileName: string
  mimeType: string
  size: number
  /** First bytes of the file (at least 16 recommended) for signature checks. */
  head?: Uint8Array
}

export interface UploadValidationResult {
  valid: boolean
  errors: string[]
  extension?: string
}

export function fileExtension(fileName: string): string {
  const base = fileName.replace(/\\/g, '/').split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot).toLowerCase() : ''
}

function matchesSignature(head: Uint8Array, signatures: readonly (readonly number[])[]): boolean {
  return signatures.some((signature) => signature.every((byte, index) => head[index] === byte))
}

export function validateUpload(
  candidate: UploadCandidate,
  options: { category: UploadCategory; maxBytes: number },
): UploadValidationResult {
  const errors: string[] = []
  const mimeType = candidate.mimeType.toLowerCase().split(';')[0].trim()
  const extension = fileExtension(candidate.fileName)
  const rule = FILE_TYPES[mimeType]

  if (!CATEGORY_MIME_TYPES[options.category].includes(mimeType) || !rule) {
    errors.push('This file type is not allowed')
  } else {
    if (!rule.extensions.includes(extension)) {
      errors.push('The file extension does not match its type')
    }
    if (rule.signatures) {
      if (!candidate.head || candidate.head.length < 4) {
        errors.push('File contents could not be verified')
      } else if (!matchesSignature(candidate.head, rule.signatures)) {
        errors.push('File contents do not match its type')
      }
    }
  }

  if (!Number.isFinite(candidate.size) || candidate.size <= 0) {
    errors.push('The file is empty')
  } else if (candidate.size > options.maxBytes) {
    errors.push(`The file exceeds the ${Math.round(options.maxBytes / (1024 * 1024))} MB limit`)
  }

  return { valid: errors.length === 0, errors, extension: errors.length === 0 ? extension : undefined }
}

/**
 * Produces a safe display name from a user-supplied filename: strips any
 * path, control characters and reserved characters, and limits length.
 */
export function sanitizeDisplayName(fileName: string): string {
  const base = fileName.replace(/\\/g, '/').split('/').pop() ?? ''
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return 'file'
  if (cleaned.length <= 120) return cleaned
  const ext = fileExtension(cleaned)
  return cleaned.slice(0, 120 - ext.length) + ext
}
