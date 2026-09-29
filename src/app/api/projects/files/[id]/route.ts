import type { NextRequest } from 'next/server'
import { privateFileResponse } from '@/lib/http/file-response'
import { jsonError } from '@/lib/http/response'
import { requireApiContext } from '@/server/context'
import { projectService } from '@/server/services/project.service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/projects/files/:id — a shared project file. The viewer must be able
 * to see the project; otherwise 404. `?inline=1` previews PDFs and images.
 */
export async function GET(request: NextRequest, { params }: RouteContext<'/api/projects/files/[id]'>) {
  try {
    const ctx = await requireApiContext()
    const { id } = await params
    const file = await projectService.downloadFile(ctx, id)
    return privateFileResponse(file, { inline: request.nextUrl.searchParams.get('inline') === '1' })
  } catch (error) {
    return jsonError(error, { route: 'projects.files.download' })
  }
}
