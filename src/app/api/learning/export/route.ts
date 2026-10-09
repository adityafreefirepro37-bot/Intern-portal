import type { NextRequest } from 'next/server'
import { csvResponse } from '@/lib/http/csv-response'
import { jsonError } from '@/lib/http/response'
import { requireApiContext } from '@/server/context'
import { learningAnalyticsService } from '@/server/services/learning-analytics.service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/learning/export — enrollments as CSV (learning.export, limited to
 * the viewer's learning.read scope). Same filters as /learning/analytics.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireApiContext()
    return csvResponse(await learningAnalyticsService.exportCsv(ctx, Object.fromEntries(request.nextUrl.searchParams)))
  } catch (error) {
    return jsonError(error, { route: 'learning.export' })
  }
}
