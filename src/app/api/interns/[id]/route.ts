import type { NextRequest } from 'next/server'
import { jsonError, jsonSuccess } from '@/lib/http/response'
import { idSchema, parseInput } from '@/lib/validation'
import { requireApiContext } from '@/server/context'
import { internService } from '@/server/services/intern.service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/interns/:id — one intern, limited to the caller's `intern.read`
 * scope. Interns outside that scope (or in another organization) return 404,
 * exactly like ids that don't exist, so the endpoint can't be used to probe
 * for records (IDOR protection).
 */
export async function GET(_request: NextRequest, { params }: RouteContext<'/api/interns/[id]'>) {
  try {
    const { id } = await params
    const internId = parseInput(idSchema, id)
    const ctx = await requireApiContext()
    return jsonSuccess(await internService.getProfile(ctx, internId))
  } catch (error) {
    return jsonError(error, { route: 'interns.get' })
  }
}
