import type { NextRequest } from 'next/server'
import { jsonError, jsonSuccess } from '@/lib/http/response'
import { requireApiContext } from '@/server/context'
import { assessmentService } from '@/server/services/assessment.service'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 8 * 1024 * 1024

/** POST /api/assessments/attempts/:id/chunks?stream=camera|screen&seq=N — one WebM recording chunk (raw body). */
export async function POST(request: NextRequest, { params }: RouteContext<'/api/assessments/attempts/[id]/chunks'>) {
  try {
    const ctx = await requireApiContext()
    const { id } = await params
    const length = Number(request.headers.get('content-length') ?? 0)
    if (length > MAX_BYTES) return jsonSuccess({ ok: false, reason: 'too large' }, { status: 413 })
    const bytes = new Uint8Array(await request.arrayBuffer())
    if (bytes.byteLength > MAX_BYTES) return jsonSuccess({ ok: false, reason: 'too large' }, { status: 413 })
    const search = request.nextUrl.searchParams
    return jsonSuccess(
      await assessmentService.uploadChunk(ctx, {
        attemptId: id,
        stream: search.get('stream') ?? '',
        sequence: Number(search.get('seq')),
        bytes,
      }),
    )
  } catch (error) {
    return jsonError(error, { route: 'assessments.chunks' })
  }
}
