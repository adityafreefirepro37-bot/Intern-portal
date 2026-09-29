import { NextResponse } from 'next/server'

const INLINE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/**
 * Hardened response for private files: attachment by default (inline preview
 * only for PDFs/images when asked), never cached publicly, no MIME sniffing,
 * and a sandboxing CSP so an uploaded file can't run script in our origin.
 */
export function privateFileResponse(
  file: { bytes: Uint8Array; fileName: string; mimeType: string },
  options: { inline?: boolean } = {},
) {
  const inline = Boolean(options.inline) && INLINE_TYPES.has(file.mimeType)
  return new NextResponse(Buffer.from(file.bytes), {
    headers: {
      'Content-Type': file.mimeType,
      'Content-Length': String(file.bytes.byteLength),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  })
}
