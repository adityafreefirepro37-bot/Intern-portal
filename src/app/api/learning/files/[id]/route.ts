import type { NextRequest } from 'next/server'
import { privateFileResponse } from '@/lib/http/file-response'
import { jsonError } from '@/lib/http/response'
import { requireApiContext } from '@/server/context'
import { learningAssignmentService } from '@/server/services/learning-assignment.service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/learning/files/:id — a file submitted for a learning assignment.
 * Only the submitter and people who may see the submission (reviewers in
 * scope, learning.read in scope) get it; everyone else gets 404.
 */
export async function GET(request: NextRequest, { params }: RouteContext<'/api/learning/files/[id]'>) {
  try {
    const ctx = await requireApiContext()
    const { id } = await params
    const file = await learningAssignmentService.downloadFile(ctx, id)
    return privateFileResponse(file, { inline: request.nextUrl.searchParams.get('inline') === '1' })
  } catch (error) {
    return jsonError(error, { route: 'learning.files.download' })
  }
}
