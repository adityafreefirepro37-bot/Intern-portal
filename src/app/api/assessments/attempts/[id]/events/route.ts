import type { NextRequest } from 'next/server'
import { jsonError, jsonSuccess } from '@/lib/http/response'
import { requireApiContext } from '@/server/context'
import { assessmentService } from '@/server/services/assessment.service'

export const dynamic = 'force-dynamic'

/** POST /api/assessments/attempts/:id/events — proctoring timeline events and heartbeats (JSON). */
export async function POST(request: NextRequest, { params }: RouteContext<'/api/assessments/attempts/[id]/events'>) {
  try {
    const ctx = await requireApiContext()
    const { id } = await params
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    return jsonSuccess(await assessmentService.recordEvents(ctx, { ...body, attemptId: id }))
  } catch (error) {
    return jsonError(error, { route: 'assessments.events' })
  }
}
