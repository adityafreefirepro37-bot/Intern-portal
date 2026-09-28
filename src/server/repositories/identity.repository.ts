import 'server-only'
import { prisma } from '@/lib/db/client'

/**
 * Loads a user with everything an authorization decision needs: roles (with
 * rank), grants with scopes, and the teams/departments the user leads.
 */
const actorSelect = {
  id: true,
  organization_id: true,
  auth_user_id: true,
  email: true,
  first_name: true,
  last_name: true,
  display_name: true,
  avatar_url: true,
  status: true,
  timezone: true,
  email_verified_at: true,
  deleted_at: true,
  organization: { select: { id: true, name: true, slug: true, timezone: true, logo_url: true } },
  teams_led: { where: { is_active: true }, select: { id: true } },
  departments_led: { where: { is_active: true }, select: { id: true } },
  user_roles: {
    select: {
      role: {
        select: {
          id: true,
          slug: true,
          name: true,
          rank: true,
          organization_id: true,
          role_permissions: {
            select: { scope: true, permission: { select: { resource: true, action: true } } },
          },
        },
      },
    },
  },
} as const

export const identityRepository = {
  /** Any status — the caller decides what each account state means. */
  findByAuthUserId(authUserId: string) {
    return prisma.user.findUnique({ where: { auth_user_id: authUserId }, select: actorSelect })
  },

  findActiveByEmail(organizationSlug: string, email: string) {
    return prisma.user.findFirst({
      where: {
        email: email.toLowerCase(),
        status: 'ACTIVE',
        deleted_at: null,
        organization: { slug: organizationSlug },
      },
      select: actorSelect,
    })
  },

  markEmailVerified(userId: string, at: Date) {
    return prisma.user.updateMany({
      where: { id: userId, email_verified_at: null },
      data: { email_verified_at: at },
    })
  },

  recordLogin(userId: string, emailConfirmedAt: Date | null) {
    return prisma.user.update({
      where: { id: userId },
      data: {
        last_login_at: new Date(),
        ...(emailConfirmedAt ? { email_verified_at: emailConfirmedAt } : {}),
      },
      select: { id: true },
    })
  },
}

export type ActorRecord = NonNullable<Awaited<ReturnType<typeof identityRepository.findByAuthUserId>>>
