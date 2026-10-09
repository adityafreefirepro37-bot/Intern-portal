import type { NextRequest } from 'next/server'
import { csvResponse } from '@/lib/http/csv-response'
import { jsonError } from '@/lib/http/response'
import { requireApiContext } from '@/server/context'
import { performanceDashboardService } from '@/server/services/performance-dashboard.service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/performance/export — review workflow status as CSV
 * (performance.export, organization-wide). Answers and ratings are not
 * exported in bulk.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireApiContext()
    return csvResponse(await performanceDashboardService.exportCsv(ctx, Object.fromEntries(request.nextUrl.searchParams)))
  } catch (error) {
    return jsonError(error, { route: 'performance.export' })
  }
}
