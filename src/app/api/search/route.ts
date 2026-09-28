import type { NextRequest } from 'next/server'
import { jsonError, jsonSuccess } from '@/lib/http/response'
import { parseInput, searchParamsToObject, searchQuerySchema } from '@/lib/validation'
import { requireApiContext } from '@/server/context'
import { searchService } from '@/server/services/search.service'

export const dynamic = 'force-dynamic'

/** GET /api/search?q=term — results grouped by entity, filtered by permission. */
export async function GET(request: NextRequest) {
  try {
    const { q, limit } = parseInput(searchQuerySchema, searchParamsToObject(request.nextUrl.searchParams))
    const ctx = await requireApiContext()
    const groups = await searchService.search(ctx, q, limit)
    return jsonSuccess(groups)
  } catch (error) {
    return jsonError(error, { route: 'search' })
  }
}
