import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'

export const invitationRepository = {
  create(data: Prisma.UserInvitationUncheckedCreateInput) {
    return prisma.userInvitation.create({ data, select: { id: true, expires_at: true } })
  },

  findByTokenHash(tokenHash: string) {
    return prisma.userInvitation.findUnique({
      where: { token_hash: tokenHash },
      select: {
        id: true,
        organization_id: true,
        user_id: true,
        email: true,
        role_id: true,
        expires_at: true,
        accepted_at: true,
        revoked_at: true,
        organization: { select: { name: true } },
        role: { select: { name: true } },
        user: { select: { first_name: true, last_name: true, status: true, auth_user_id: true } },
      },
    })
  },

  listPending(organizationId: string, now: Date) {
    return prisma.userInvitation.findMany({
      where: { organization_id: organizationId, accepted_at: null, revoked_at: null, expires_at: { gt: now } },
      orderBy: { created_at: 'desc' },
      take: 100,
      select: {
        id: true,
        email: true,
        expires_at: true,
        created_at: true,
        role: { select: { name: true } },
        creator: { select: { first_name: true, last_name: true, display_name: true } },
      },
    })
  },

  findInOrg(organizationId: string, id: string) {
    return prisma.userInvitation.findFirst({
      where: { id, organization_id: organizationId },
      select: { id: true, user_id: true, email: true, accepted_at: true, revoked_at: true },
    })
  },

  revokePendingForUser(userId: string, revokedBy: string | null) {
    return prisma.userInvitation.updateMany({
      where: { user_id: userId, accepted_at: null, revoked_at: null },
      data: { revoked_at: new Date(), revoked_by: revokedBy },
    })
  },

  revoke(id: string, revokedBy: string) {
    return prisma.userInvitation.updateMany({
      where: { id, accepted_at: null, revoked_at: null },
      data: { revoked_at: new Date(), revoked_by: revokedBy },
    })
  },

  /**
   * Atomically claims an invitation. Returns true only for the single caller
   * that marks it accepted while it is still pending and unexpired — so a
   * token can never be used twice, even by concurrent requests.
   */
  async claim(id: string, now: Date): Promise<boolean> {
    const result = await prisma.userInvitation.updateMany({
      where: { id, accepted_at: null, revoked_at: null, expires_at: { gt: now } },
      data: { accepted_at: now },
    })
    return result.count === 1
  },

  /** Undo a claim when account creation at the provider fails, so the user can retry. */
  release(id: string) {
    return prisma.userInvitation.update({ where: { id }, data: { accepted_at: null } })
  },
}
