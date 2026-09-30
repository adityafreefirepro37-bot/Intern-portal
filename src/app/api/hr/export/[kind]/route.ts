import { NextResponse, type NextRequest } from 'next/server'
import { NotFoundError } from '@/lib/errors'
import { jsonError } from '@/lib/http/response'
import { requireApiContext } from '@/server/context'
import { attendanceService } from '@/server/services/attendance.service'
import { documentService } from '@/server/services/document.service'
import { hrDashboardService } from '@/server/services/hr-dashboard.service'
import { internService } from '@/server/services/intern.service'
import { leaveService } from '@/server/services/leave.service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/hr/export/:kind — CSV exports (interns, attendance, leave,
 * documents, analytics). Each export checks its own `*.export` permission and
 * scope, neutralizes spreadsheet formulas and is written to the audit log.
 * Query parameters are the same filters as the matching page.
 */
export async function GET(request: NextRequest, { params }: RouteContext<'/api/hr/export/[kind]'>) {
  try {
    const ctx = await requireApiContext()
    const { kind } = await params
    const query = Object.fromEntries(request.nextUrl.searchParams)
    const exporters: Record<string, () => Promise<{ csv: string; fileName: string }>> = {
      interns: () => internService.exportCsv(ctx, query),
      attendance: () => attendanceService.exportCsv(ctx, query),
      leave: () => leaveService.exportCsv(ctx, query),
      documents: () => documentService.exportCsv(ctx),
      analytics: () => hrDashboardService.analyticsCsv(ctx),
    }
    const exporter = exporters[kind]
    if (!exporter) throw new NotFoundError('Export')
    const { csv, fileName } = await exporter()
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return jsonError(error, { route: 'hr.export' })
  }
}
