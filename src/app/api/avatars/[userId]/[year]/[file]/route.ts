import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db/client'
import { NotFoundError } from '@/lib/errors'
import { jsonError } from '@/lib/http/response'
import { getStorageService } from '@/lib/storage'
import { requireApiContext } from '@/server/context'
import { avatarStorageKey } from '@/server/services/user.service'

export const dynamic = 'force-dynamic'

/**
 * Serves profile photos to signed-in members of the same organization. The
 * requested file must be the user's *current* avatar, so this route can't be
 * used to read arbitrary stored files.
 */
export async function GET(_request: NextRequest, { params }: RouteContext<'/api/avatars/[userId]/[year]/[file]'>) {
  try {
    const ctx = await requireApiContext()
    const { userId, year, file } = await params
    const user = await prisma.user.findFirst({
      where: { id: userId, organization_id: ctx.organization.id, deleted_at: null },
      select: { avatar_url: true },
    })
    const url = `/api/avatars/${userId}/${year}/${file}`
    const key = user?.avatar_url ? avatarStorageKey(ctx.organization.id, userId, url) : null
    if (!user?.avatar_url || !key || !user.avatar_url.startsWith(url)) throw new NotFoundError('Avatar')

    const bytes = await getStorageService().download(key)
    const extension = file.split('.').pop()
    const type = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg'
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': type,
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
      },
    })
  } catch (error) {
    return jsonError(error, { route: 'avatar' })
  }
}
