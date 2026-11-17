/** A private image (PNG or JPEG by its first bytes) that shared caches must not keep. */
export function privateImageResponse(bytes: Uint8Array) {
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50
  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': isPng ? 'image/png' : 'image/jpeg',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
