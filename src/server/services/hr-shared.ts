import type { InternStatus, Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { dayKey } from '@/lib/hr/time'
import type { PermissionKey, PermissionScope } from '@/lib/permissions'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { userScope } from '../repositories/scope'
import { authorizationService } from './authorization.service'

/** Shared building blocks for the HR operations services. */

/** Intern statuses whose attendance, leave and documents are tracked day to day. */
export const TRACKED_STATUSES: InternStatus[] = ['ONBOARDING', 'ACTIVE', 'ENDING_SOON']

export const personSelect = {
  id: true,
  first_name: true,
  last_name: true,
  display_name: true,
  avatar_url: true,
} as const

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined)

export const optionalUuid = z
  .string()
  .optional()
  .transform((value) => value || undefined)
  .pipe(z.uuid().optional())

/** Users whose HR records fall within `permission`'s scope (null when not granted). */
export function scopedUsers(ctx: RequestContext, permission: PermissionKey): Prisma.UserWhereInput | null {
  const scope = authorizationService.scopeOf(ctx, permission)
  return scope ? userScope(ctx.actor, scope) : null
}

/**
 * Requires `permission` and that `userId` is within its scope. Out-of-scope
 * users are indistinguishable from missing ones (404).
 */
export async function requireUserInScope(ctx: RequestContext, permission: PermissionKey, userId: string) {
  const scope = authorizationService.require(ctx, permission)
  const id = parseInput(z.uuid(), userId)
  const user = await prisma.user.findFirst({
    where: { id, deleted_at: null, ...userScope(ctx.actor, scope) },
    select: {
      ...personSelect,
      email: true,
      intern: {
        select: {
          id: true,
          status: true,
          joining_date: true,
          expected_end_date: true,
          actual_end_date: true,
          manager_id: true,
          mentor_id: true,
        },
      },
    },
  })
  if (!user) throw new NotFoundError('Person')
  return { user, scope }
}

export function isOrgWide(scope: PermissionScope | null | undefined) {
  return scope === 'ORGANIZATION'
}

/** Reviewers never decide their own requests. */
export function forbidSelf(ctx: RequestContext, userId: string, what: string) {
  if (userId === ctx.actor.userId) throw new ForbiddenError(`You can’t ${what} your own request`)
}

/** Interns currently in the programme whose user is within `where`. */
export function trackedInterns(organizationId: string, where: Prisma.UserWhereInput) {
  return prisma.intern.findMany({
    where: {
      organization_id: organizationId,
      deleted_at: null,
      status: { in: TRACKED_STATUSES },
      user: { AND: [where, { deleted_at: null }] },
    },
    orderBy: [{ user: { first_name: 'asc' } }, { user: { last_name: 'asc' } }],
    select: {
      id: true,
      user_id: true,
      status: true,
      employee_code: true,
      joining_date: true,
      expected_end_date: true,
      department: { select: { id: true, name: true } },
      user: { select: personSelect },
    },
  })
}

/** Holiday dates ("YYYY-MM-DD") in [from, to]. */
export async function holidaySet(organizationId: string, from: Date, to: Date): Promise<Set<string>> {
  const rows = await prisma.holiday.findMany({
    where: { organization_id: organizationId, date: { gte: from, lte: to } },
    select: { date: true },
  })
  return new Set(rows.map((row) => dayKey(row.date)))
}
