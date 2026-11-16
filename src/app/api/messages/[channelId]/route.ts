import type { NextRequest } from 'next/server'
import { jsonError, jsonSuccess } from '@/lib/http/response'
import { requireApiContext } from '@/server/context'
import { messageService } from '@/server/services/message.service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/messages/:channelId?since=ISO — messages created, edited or deleted
 * since the cursor (the chat polls this while open).
 * GET /api/messages/:channelId?before=ISO — the page of older messages.
 */
export async function GET(request: NextRequest, { params }: RouteContext<'/api/messages/[channelId]'>) {
  try {
    const ctx = await requireApiContext()
    const { channelId } = await params
    const search = request.nextUrl.searchParams
    const before = search.get('before')
    if (before) {
      const page = await messageService.open(ctx, channelId, { before })
      return jsonSuccess({ messages: page.messages, hasMore: page.hasMore })
    }
    const since = search.get('since') ?? new Date(Date.now() - 60_000).toISOString()
    return jsonSuccess(await messageService.changes(ctx, channelId, since))
  } catch (error) {
    return jsonError(error, { route: 'messages.poll' })
  }
}
