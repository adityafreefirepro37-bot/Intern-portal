import type { NextRequest } from 'next/server'
import { jsonError, jsonSuccess } from '@/lib/http/response'
import { publicAuditService } from '@/server/services/lead.service'

export const dynamic = 'force-dynamic'

/** POST /api/audit/:token/remove — "remove my business's data": erased and never contacted again. */
export async function POST(_request: NextRequest, { params }: RouteContext<'/api/audit/[token]/remove'>) {
  try {
    const { token } = await params
    return jsonSuccess(await publicAuditService.optOut(token))
  } catch (error) {
    return jsonError(error, { route: 'audit.remove' })
  }
}
