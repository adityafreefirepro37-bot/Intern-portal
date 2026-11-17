import { jsonError } from '@/lib/http/response'
import { getStorageService } from '@/lib/storage'
import { requireApiContext } from '@/server/context'
import { assessmentService } from '@/server/services/assessment.service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/assessments/attempts/:id/recording/camera|screen?segment=N — one recorder run's chunks
 * concatenated in order (they form one WebM file), streamed. Reviewers only; audited.
 */
export async function GET(request: Request, { params }: RouteContext<'/api/assessments/attempts/[id]/recording/[stream]'>) {
  try {
    const ctx = await requireApiContext()
    const { id, stream } = await params
    const segment = Math.max(0, Math.min(99, Number(new URL(request.url).searchParams.get('segment') ?? 0) || 0))
    const chunks = await assessmentService.recordingChunks(ctx, id, stream, segment)
    if (chunks.length === 0) return new Response('No recording', { status: 404 })
    const storage = getStorageService()
    let i = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (i >= chunks.length) {
          controller.close()
          return
        }
        try {
          controller.enqueue(await storage.download(chunks[i++].storage_path))
        } catch {
          // A missing chunk leaves a gap rather than breaking the whole recording.
        }
      },
    })
    return new Response(body, {
      headers: {
        'Content-Type': 'video/webm',
        'Content-Length': String(chunks.reduce((n, c) => n + c.bytes, 0)),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return jsonError(error, { route: 'assessments.recording' })
  }
}
