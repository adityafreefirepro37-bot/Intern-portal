import { jsonError } from '@/lib/http/response'
import { icsResponse } from '@/lib/http/ics-response'
import { requireApiContext } from '@/server/context'
import { meetingService } from '@/server/services/meeting.service'

export const dynamic = 'force-dynamic'

/** GET /api/meetings/:id/ics — the meeting as a calendar file (attendees and organization-wide managers). */
export async function GET(_request: Request, { params }: RouteContext<'/api/meetings/[id]/ics'>) {
  try {
    const ctx = await requireApiContext()
    const { id } = await params
    return icsResponse(await meetingService.ics(ctx, id))
  } catch (error) {
    return jsonError(error, { route: 'meetings.ics' })
  }
}
