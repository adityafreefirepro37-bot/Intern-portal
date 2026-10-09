import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import type { PermissionKey } from '@/lib/permissions'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { internScope } from '../repositories/scope'
import { authorizationService } from './authorization.service'
import { scopeCovers } from './intern-access'

/**
 * Shared access rules for performance records (goals, check-ins, feedback,
 * reviews, development plans). Every record belongs to an intern; access is
 * the permission's scope over that intern (OWN = the intern themself,
 * ASSIGNED = their manager / mentor, ORGANIZATION = HR / Admin). Out of scope
 * is indistinguishable from missing (404).
 */

export const internPlacementSelect = {
  id: true,
  user_id: true,
  organization_id: true,
  manager_id: true,
  mentor_id: true,
  team_id: true,
  department_id: true,
  status: true,
  user: { select: { id: true, first_name: true, last_name: true, display_name: true, avatar_url: true } },
} as const satisfies Prisma.InternSelect

export type InternPlacement = Prisma.InternGetPayload<{ select: typeof internPlacementSelect }>

/** Interns within `permission`'s scope (null when the permission isn't granted). */
export function scopedInternWhere(ctx: RequestContext, permission: PermissionKey): Prisma.InternWhereInput | null {
  const scope = authorizationService.scopeOf(ctx, permission)
  return scope ? { ...internScope(ctx.actor, scope), deleted_at: null } : null
}

/** Requires `permission` over the intern (by intern id). */
export async function requireInternFor(ctx: RequestContext, permission: PermissionKey, internId: string) {
  const where = scopedInternWhere(ctx, permission)
  if (!where) throw new ForbiddenError()
  const intern = await prisma.intern.findFirst({
    where: { AND: [where, { id: parseInput(z.uuid(), internId) }] },
    select: internPlacementSelect,
  })
  if (!intern) throw new NotFoundError('Intern')
  return intern
}

/** The signed-in person's own intern record (null for staff). */
export async function ownIntern(ctx: RequestContext) {
  return prisma.intern.findFirst({
    where: { user_id: ctx.actor.userId, organization_id: ctx.organization.id, deleted_at: null },
    select: internPlacementSelect,
  })
}

/** Does `permission` cover this intern? (No query — uses placement facts.) */
export function covers(ctx: RequestContext, permission: PermissionKey, intern: InternPlacement) {
  return scopeCovers(ctx, permission, intern)
}

/** How the viewer relates to an intern. */
export function relation(ctx: RequestContext, intern: Pick<InternPlacement, 'user_id' | 'manager_id' | 'mentor_id'>) {
  return {
    isSelf: intern.user_id === ctx.actor.userId,
    isManager: intern.manager_id === ctx.actor.userId,
    isMentor: intern.mentor_id === ctx.actor.userId,
  }
}

export const RECORD_TYPES = ['TASK', 'PROJECT', 'SUBMISSION', 'COURSE', 'FEEDBACK', 'DOCUMENT', 'GOAL', 'CHECKIN'] as const
export type RecordType = (typeof RECORD_TYPES)[number]

/**
 * Resolves a reference to an existing record of this intern, inside the
 * organization. Returns a display title and link, or null when the record
 * doesn't exist or isn't connected to the intern (references never copy data).
 */
export async function resolveRecord(
  organizationId: string,
  intern: Pick<InternPlacement, 'id' | 'user_id'>,
  type: RecordType,
  id: string,
): Promise<{ title: string; href: string } | null> {
  switch (type) {
    case 'TASK': {
      const row = await prisma.task.findFirst({
        where: { id, organization_id: organizationId, deleted_at: null, assignees: { some: { user_id: intern.user_id } } },
        select: { title: true },
      })
      return row && { title: row.title, href: `/tasks/${id}` }
    }
    case 'PROJECT': {
      const row = await prisma.project.findFirst({
        where: { id, organization_id: organizationId, deleted_at: null, members: { some: { user_id: intern.user_id } } },
        select: { name: true },
      })
      return row && { title: row.name, href: `/projects/${id}` }
    }
    case 'SUBMISSION': {
      const task = await prisma.taskSubmission.findFirst({
        where: { id, submitted_by: intern.user_id, task: { organization_id: organizationId } },
        select: { task: { select: { id: true, title: true } } },
      })
      if (task) return { title: `Submission: ${task.task.title}`, href: `/tasks/${task.task.id}` }
      const learning = await prisma.learningAssignmentSubmission.findFirst({
        where: { id, user_id: intern.user_id, organization_id: organizationId },
        select: { assignment: { select: { title: true } } },
      })
      return learning && { title: `Assignment: ${learning.assignment.title}`, href: `/learning/reviews/${id}` }
    }
    case 'COURSE': {
      const row = await prisma.courseEnrollment.findFirst({
        where: { course_id: id, user_id: intern.user_id, organization_id: organizationId },
        select: { course: { select: { title: true } } },
      })
      return row && { title: row.course.title, href: `/learning/courses/${id}` }
    }
    case 'FEEDBACK': {
      const row = await prisma.feedback.findFirst({
        where: { id, organization_id: organizationId, to_user_id: intern.user_id },
        select: { feedback_type: true, created_at: true },
      })
      return row && { title: `Feedback (${row.created_at.toISOString().slice(0, 10)})`, href: `/performance/feedback?highlight=${id}` }
    }
    case 'DOCUMENT': {
      const row = await prisma.internshipDocument.findFirst({
        where: { id, intern_id: intern.id, deleted_at: null },
        select: { file_name: true },
      })
      return row && { title: row.file_name, href: `/interns/${intern.id}?tab=documents` }
    }
    case 'GOAL': {
      const row = await prisma.performanceGoal.findFirst({
        where: { id, intern_id: intern.id, organization_id: organizationId },
        select: { title: true },
      })
      return row && { title: row.title, href: `/performance/goals/${id}` }
    }
    case 'CHECKIN': {
      const row = await prisma.weeklyCheckin.findFirst({
        where: { id, intern_id: intern.id, organization_id: organizationId },
        select: { week_start: true },
      })
      return row && { title: `Check-in, week of ${row.week_start.toISOString().slice(0, 10)}`, href: `/performance/checkins/${id}` }
    }
  }
}
