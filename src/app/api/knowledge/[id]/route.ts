import { NextResponse, type NextRequest } from 'next/server'
import { jsonError } from '@/lib/http/response'
import { requireApiContext } from '@/server/context'
import { knowledgeService } from '@/server/ai/knowledge.service'

export const dynamic = 'force-dynamic'

/**
 * Downloads a knowledge document's original file for people who may read it.
 * Always an attachment with nosniff, so uploaded HTML can never run in the browser.
 */
export async function GET(_request: NextRequest, { params }: RouteContext<'/api/knowledge/[id]'>) {
  try {
    const ctx = await requireApiContext()
    const { id } = await params
    const { bytes, fileName, mimeType } = await knowledgeService.file(ctx, id)
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': mimeType === 'text/html' ? 'application/octet-stream' : mimeType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return jsonError(error, { route: 'knowledge.file' })
  }
}
