import type { NextRequest } from 'next/server'
import { jsonError, jsonSuccess } from '@/lib/http/response'
import { publicAuditService } from '@/server/services/lead.service'

export const dynamic = 'force-dynamic'

/** POST /api/audit/:token/view — sent by the page after it has been visible a few seconds (scanners don't count). */
export async function POST(_request: NextRequest, { params }: RouteContext<'/api/audit/[token]/view'>) {
  try {
    const { token } = await params
    return jsonSuccess(await publicAuditService.recordView(token))
  } catch (error) {
    return jsonError(error, { route: 'audit.view' })
  }
}
