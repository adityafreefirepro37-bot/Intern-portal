import type { NextRequest } from 'next/server'
import { jsonError } from '@/lib/http/response'
import { requireApiContext } from '@/server/context'
import { certificateService } from '@/server/services/certificate.service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/certificates/:id/pdf — the certificate as a PDF (?inline=1 to show it
 * in the browser). Same access as the certificate itself; drafts and revoked
 * certificates carry a watermark.
 */
export async function GET(request: NextRequest, { params }: RouteContext<'/api/certificates/[id]/pdf'>) {
  try {
    const ctx = await requireApiContext()
    const { id } = await params
    const { bytes, filename } = await certificateService.pdf(ctx, id)
    const inline = request.nextUrl.searchParams.get('inline') === '1'
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/[^\w.-]/g, '_')}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return jsonError(error, { route: 'certificates.pdf' })
  }
}
