import { NextResponse, type NextRequest } from 'next/server'
import { AppError } from '@/lib/errors'
import { jsonError } from '@/lib/http/response'
import { requireApiContext } from '@/server/context'
import { aiChatService } from '@/server/ai/chat.service'

export const dynamic = 'force-dynamic'

/**
 * Streams one AYAVA AI answer as newline-delimited JSON events (see ChatEvent).
 * Browsers never talk to the AI provider: its key and address stay on the server.
 */
export async function POST(request: NextRequest) {
  try {
    // Session cookies are SameSite=Lax; this also refuses any cross-origin caller.
    const origin = request.headers.get('origin')
    if (!origin || origin !== request.nextUrl.origin) throw new AppError('FORBIDDEN', 'Cross-origin request refused')

    const ctx = await requireApiContext()
    const body: unknown = await request.json().catch(() => {
      throw new AppError('VALIDATION_ERROR', 'Invalid request')
    })

    const encoder = new TextEncoder()
    const events = aiChatService.stream(ctx, body, request.signal)
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { value, done } = await events.next()
        if (done) {
          controller.close()
          return
        }
        controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`))
      },
      async cancel() {
        await events.return(undefined)
      },
    })
    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return jsonError(error, { route: 'ai.chat' })
  }
}
