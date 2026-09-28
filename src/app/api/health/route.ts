import { prisma } from '@/lib/db/client'
import { jsonError, jsonSuccess } from '@/lib/http/response'
import { AppError } from '@/lib/errors'

export const dynamic = 'force-dynamic'

/** Liveness + database reachability. Reveals no configuration details. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return jsonSuccess({ status: 'ok', database: 'ok', time: new Date().toISOString() })
  } catch (error) {
    return jsonError(new AppError('INTERNAL_ERROR', 'Database unavailable', { cause: error }), { route: 'health' })
  }
}
