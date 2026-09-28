import { NextResponse, type NextRequest } from 'next/server'
import { jsonError } from '@/lib/http/response'
import { requireApiContext } from '@/server/context'
import { documentService } from '@/server/services/document.service'

export const dynamic = 'force-dynamic'

const INLINE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg'])

/**
 * GET /api/documents/:id — streams a private document after checking the
 * viewer's access to the intern and the document's visibility level.
 * Documents the viewer may not see are 404 (indistinguishable from missing).
 * Files are never served from a public URL. `?inline=1` previews PDFs/images.
 */
export async function GET(request: NextRequest, { params }: RouteContext<'/api/documents/[id]'>) {
  try {
    const ctx = await requireApiContext()
    const { id } = await params
    const file = await documentService.download(ctx, id)
    const inline = request.nextUrl.searchParams.get('inline') === '1' && INLINE_TYPES.has(file.mimeType)
    const encoded = encodeURIComponent(file.fileName)
    return new NextResponse(Buffer.from(file.bytes), {
      headers: {
        'Content-Type': file.mimeType,
        'Content-Length': String(file.bytes.byteLength),
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encoded}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    })
  } catch (error) {
    return jsonError(error, { route: 'documents.download' })
  }
}
