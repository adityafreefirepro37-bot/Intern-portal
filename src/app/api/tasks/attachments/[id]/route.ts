import type { NextRequest } from 'next/server'
import { privateFileResponse } from '@/lib/http/file-response'
import { jsonError } from '@/lib/http/response'
import { requireApiContext } from '@/server/context'
import { taskCollaborationService } from '@/server/services/task-collaboration.service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/tasks/attachments/:id — a task file (including files submitted for
 * review). The viewer must be able to see the task; otherwise 404. `?inline=1`
 * previews PDFs and images.
 */
export async function GET(request: NextRequest, { params }: RouteContext<'/api/tasks/attachments/[id]'>) {
  try {
    const ctx = await requireApiContext()
    const { id } = await params
    const file = await taskCollaborationService.downloadAttachment(ctx, id)
    return privateFileResponse(file, { inline: request.nextUrl.searchParams.get('inline') === '1' })
  } catch (error) {
    return jsonError(error, { route: 'tasks.attachments.download' })
  }
}
