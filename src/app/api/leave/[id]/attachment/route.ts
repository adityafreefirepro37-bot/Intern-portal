import type { NextRequest } from 'next/server'
import { privateFileResponse } from '@/lib/http/file-response'
import { jsonError } from '@/lib/http/response'
import { requireApiContext } from '@/server/context'
import { leaveService } from '@/server/services/leave.service'

export const dynamic = 'force-dynamic'

/** GET /api/leave/:id/attachment — the supporting document of a leave request (requester or reviewers in scope). */
export async function GET(request: NextRequest, { params }: RouteContext<'/api/leave/[id]/attachment'>) {
  try {
    const ctx = await requireApiContext()
    const { id } = await params
    const file = await leaveService.attachment(ctx, id)
    return privateFileResponse(file, { inline: request.nextUrl.searchParams.get('inline') === '1' })
  } catch (error) {
    return jsonError(error, { route: 'leave.attachment' })
  }
}
