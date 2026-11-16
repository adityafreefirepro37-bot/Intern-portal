import { jsonError } from '@/lib/http/response'
import { icsResponse } from '@/lib/http/ics-response'
import { requireApiContext } from '@/server/context'
import { meetingService } from '@/server/services/meeting.service'

export const dynamic = 'force-dynamic'

/** GET /api/calendar/ics — the signed-in person's meetings (last 30 days to 6 months ahead) as one calendar file. */
export async function GET() {
  try {
    return icsResponse(await meetingService.myIcs(await requireApiContext()))
  } catch (error) {
    return jsonError(error, { route: 'calendar.ics' })
  }
}
