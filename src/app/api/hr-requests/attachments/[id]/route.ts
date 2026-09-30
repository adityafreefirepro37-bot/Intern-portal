import type { NextRequest } from 'next/server'
import { privateFileResponse } from '@/lib/http/file-response'
import { jsonError } from '@/lib/http/response'
import { requireApiContext } from '@/server/context'
import { hrRequestService } from '@/server/services/hr-request.service'

export const dynamic = 'force-dynamic'

/** GET /api/hr-requests/attachments/:id — a file on an HR request (requester or HR only; others get 404). */
export async function GET(request: NextRequest, { params }: RouteContext<'/api/hr-requests/attachments/[id]'>) {
  try {
    const ctx = await requireApiContext()
    const { id } = await params
    const file = await hrRequestService.attachment(ctx, id)
    return privateFileResponse(file, { inline: request.nextUrl.searchParams.get('inline') === '1' })
  } catch (error) {
    return jsonError(error, { route: 'hr_requests.attachment' })
  }
}
