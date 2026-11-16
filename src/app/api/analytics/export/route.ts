import type { NextRequest } from 'next/server'
import { jsonError } from '@/lib/http/response'
import { requireApiContext } from '@/server/context'
import { analyticsService } from '@/server/services/analytics.service'

export const dynamic = 'force-dynamic'

/** GET /api/analytics/export?months=&departmentId=&teamId= — the monthly analytics table as CSV (analytics.export). */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireApiContext()
    const search = request.nextUrl.searchParams
    const filters = analyticsService.parseFilters({
      months: search.get('months') ?? undefined,
      departmentId: search.get('departmentId') ?? undefined,
      teamId: search.get('teamId') ?? undefined,
    })
    const { filename, body } = await analyticsService.exportCsv(ctx, filters)
    return new Response(`﻿${body}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return jsonError(error, { route: 'analytics.export' })
  }
}
