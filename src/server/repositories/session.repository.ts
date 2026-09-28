import 'server-only'
import { prisma } from '@/lib/db/client'

const TOUCH_INTERVAL_MS = 5 * 60 * 1000

export const sessionRepository = {
  findByAuthSessionId(authSessionId: string) {
    return prisma.userSession.findUnique({
      where: { auth_session_id: authSessionId },
      select: { id: true, user_id: true, revoked_at: true, last_seen_at: true },
    })
  },

  /**
   * Records a session the first time the application sees it and refreshes
   * `last_seen_at` at most every five minutes. Returns whether the session has
   * been revoked (revoked sessions are rejected by the request context).
   */
  async touch(input: {
    authSessionId: string
    userId: string
    organizationId: string
    ipAddress: string | null
    userAgent: string | null
  }): Promise<{ revoked: boolean }> {
    const existing = await this.findByAuthSessionId(input.authSessionId)
    if (!existing) {
      await prisma.userSession.upsert({
        where: { auth_session_id: input.authSessionId },
        update: {},
        create: {
          auth_session_id: input.authSessionId,
          user_id: input.userId,
          organization_id: input.organizationId,
          ip_address: input.ipAddress,
          user_agent: input.userAgent,
        },
      })
      return { revoked: false }
    }
    // A session id can never move between users.
    if (existing.user_id !== input.userId) return { revoked: true }
    if (existing.revoked_at) return { revoked: true }
    if (Date.now() - existing.last_seen_at.getTime() > TOUCH_INTERVAL_MS) {
      await prisma.userSession.update({
        where: { id: existing.id },
        data: { last_seen_at: new Date(), ...(input.ipAddress ? { ip_address: input.ipAddress } : {}) },
      })
    }
    return { revoked: false }
  },

  listActiveForUser(userId: string) {
    return prisma.userSession.findMany({
      where: { user_id: userId, revoked_at: null },
      orderBy: { last_seen_at: 'desc' },
      take: 50,
      select: {
        id: true,
        auth_session_id: true,
        user_agent: true,
        ip_address: true,
        created_at: true,
        last_seen_at: true,
      },
    })
  },

  revokeById(userId: string, id: string, reason: string) {
    return prisma.userSession.updateMany({
      where: { id, user_id: userId, revoked_at: null },
      data: { revoked_at: new Date(), revoked_reason: reason },
    })
  },

  revokeByAuthSessionId(authSessionId: string, reason: string) {
    return prisma.userSession.updateMany({
      where: { auth_session_id: authSessionId, revoked_at: null },
      data: { revoked_at: new Date(), revoked_reason: reason },
    })
  },

  revokeAllForUser(userId: string, reason: string, exceptAuthSessionId?: string | null) {
    return prisma.userSession.updateMany({
      where: {
        user_id: userId,
        revoked_at: null,
        ...(exceptAuthSessionId ? { auth_session_id: { not: exceptAuthSessionId } } : {}),
      },
      data: { revoked_at: new Date(), revoked_reason: reason },
    })
  },
}
