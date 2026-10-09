import type { EnrollmentStatus, Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ForbiddenError } from '@/lib/errors'
import { toCsv } from '@/lib/hr/operations'
import { dayKey } from '@/lib/hr/time'
import { addDays, formatDateOnly, parseDateOnly, todayIn } from '@/lib/interns/dates'
import { ENROLLMENT_STATUS_LABELS, ENROLLMENT_TYPE_LABELS, effectiveEnrollmentStatus } from '@/lib/learning/rules'
import { fullName } from '@/lib/utils/format'
import { isoDateSchema, parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { optionalUuid, personSelect, scopedUsers } from './hr-shared'

/**
 * Learning analytics: factual counts over enrollments, attempts and
 * submissions, always limited to the viewer's learning.read scope (HR sees
 * the organization, managers and mentors their interns). No scores or
 * rankings of people.
 */

const optionalDate = z
  .string()
  .optional()
  .transform((v) => v || undefined)
  .pipe(isoDateSchema.optional())

export const learningFilterSchema = z.object({
  courseId: optionalUuid,
  departmentId: optionalUuid,
  status: z
    .enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'CANCELLED', ''])
    .optional()
    .transform((v) => v || undefined),
  from: optionalDate,
  to: optionalDate,
})
export type LearningFilters = z.infer<typeof learningFilterSchema>

function scopeOrThrow(ctx: RequestContext) {
  const where = scopedUsers(ctx, 'learning.read')
  if (!where) throw new ForbiddenError()
  return where
}

function enrollmentWhere(
  ctx: RequestContext,
  users: Prisma.UserWhereInput,
  filters: LearningFilters,
  today: Date,
): Prisma.CourseEnrollmentWhereInput {
  const status: Prisma.CourseEnrollmentWhereInput =
    filters.status === 'OVERDUE'
      ? { status: { in: ['NOT_STARTED', 'IN_PROGRESS'] }, due_date: { lt: today } }
      : filters.status
        ? { status: filters.status as EnrollmentStatus }
        : { status: { not: 'CANCELLED' } }
  return {
    organization_id: ctx.organization.id,
    course: { deleted_at: null },
    user: { AND: [users, { deleted_at: null }] },
    ...(filters.courseId ? { course_id: filters.courseId } : {}),
    ...(filters.departmentId ? { user: { AND: [users, { deleted_at: null, intern: { is: { department_id: filters.departmentId } } }] } } : {}),
    ...(filters.from || filters.to
      ? {
          assigned_at: {
            ...(filters.from ? { gte: parseDateOnly(filters.from) } : {}),
            ...(filters.to ? { lt: addDays(parseDateOnly(filters.to), 1) } : {}),
          },
        }
      : {}),
    ...status,
  }
}

const rowSelect = {
  id: true,
  enrollment_type: true,
  status: true,
  progress_percentage: true,
  due_date: true,
  assigned_at: true,
  completed_at: true,
  user: { select: { ...personSelect, email: true, intern: { select: { department: { select: { name: true } } } } } },
  course: { select: { id: true, title: true } },
} as const satisfies Prisma.CourseEnrollmentSelect

export const learningAnalyticsService = {
  /** Admin / manager learning dashboard and analytics (one set of filters). */
  async overview(ctx: RequestContext, query: unknown = {}) {
    const users = scopeOrThrow(ctx)
    const filters = parseInput(learningFilterSchema, query)
    const today = todayIn(ctx.organization.timezone)
    const where = enrollmentWhere(ctx, users, { ...filters, status: undefined }, today)
    const activeWhere = { ...where, status: { in: ['NOT_STARTED', 'IN_PROGRESS'] as EnrollmentStatus[] } }
    const userFilter = { user: where.user }
    const [byStatus, overdue, avgProgress, byCourse, completedByCourse, overdueByCourse, quizStats, pendingReviews, publishedCourses, recentCompletions, overdueList, departments] =
      await Promise.all([
        prisma.courseEnrollment.groupBy({ by: ['status'], where, _count: { _all: true } }),
        prisma.courseEnrollment.count({ where: { ...activeWhere, due_date: { lt: today } } }),
        prisma.courseEnrollment.aggregate({ where: activeWhere, _avg: { progress_percentage: true } }),
        prisma.courseEnrollment.groupBy({
          by: ['course_id'],
          where,
          _count: { _all: true },
          _avg: { progress_percentage: true },
        }),
        prisma.courseEnrollment.groupBy({ by: ['course_id'], where: { ...where, status: 'COMPLETED' }, _count: { _all: true } }),
        prisma.courseEnrollment.groupBy({
          by: ['course_id'],
          where: { ...activeWhere, due_date: { lt: today } },
          _count: { _all: true },
        }),
        prisma.quizAttempt.groupBy({
          by: ['passed'],
          where: {
            status: 'SUBMITTED',
            ...userFilter,
            quiz: { course: { organization_id: ctx.organization.id, ...(filters.courseId ? { id: filters.courseId } : {}) } },
          },
          _count: { _all: true },
        }),
        prisma.learningAssignmentSubmission.count({
          where: {
            organization_id: ctx.organization.id,
            status: { in: ['SUBMITTED', 'RESUBMITTED', 'UNDER_REVIEW'] },
            ...userFilter,
            ...(filters.courseId ? { assignment: { course_id: filters.courseId } } : {}),
          },
        }),
        prisma.course.count({ where: { organization_id: ctx.organization.id, status: 'PUBLISHED', deleted_at: null } }),
        prisma.courseEnrollment.findMany({
          where: { ...where, status: 'COMPLETED' },
          orderBy: { completed_at: 'desc' },
          take: 8,
          select: rowSelect,
        }),
        prisma.courseEnrollment.findMany({
          where: { ...activeWhere, due_date: { lt: today } },
          orderBy: { due_date: 'asc' },
          take: 10,
          select: rowSelect,
        }),
        prisma.department.findMany({
          where: { organization_id: ctx.organization.id },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        }),
      ])
    const count = (s: EnrollmentStatus) => byStatus.find((b) => b.status === s)?._count._all ?? 0
    const total = byStatus.reduce((sum, b) => sum + b._count._all, 0)
    const completed = count('COMPLETED')
    const courseIds = byCourse.map((c) => c.course_id)
    const courses = await prisma.course.findMany({
      where: { id: { in: courseIds } },
      select: { id: true, title: true, is_required: true },
    })
    const passed = quizStats.find((q) => q.passed === true)?._count._all ?? 0
    const attempts = quizStats.reduce((s, q) => s + q._count._all, 0)
    const courseRows = byCourse
      .map((c) => {
        const course = courses.find((x) => x.id === c.course_id)
        const done = completedByCourse.find((x) => x.course_id === c.course_id)?._count._all ?? 0
        return {
          courseId: c.course_id,
          title: course?.title ?? 'Course',
          required: course?.is_required ?? false,
          enrolled: c._count._all,
          completed: done,
          completionRate: c._count._all ? Math.round((done / c._count._all) * 100) : 0,
          averageProgress: Math.round(c._avg.progress_percentage ?? 0),
          overdue: overdueByCourse.find((x) => x.course_id === c.course_id)?._count._all ?? 0,
        }
      })
      .sort((a, b) => a.title.localeCompare(b.title))
    const allCourses = await prisma.course.findMany({
      where: { organization_id: ctx.organization.id, deleted_at: null, status: { not: 'DRAFT' } },
      orderBy: { title: 'asc' },
      select: { id: true, title: true },
    })
    const view = (r: Prisma.CourseEnrollmentGetPayload<{ select: typeof rowSelect }>) => ({
      ...r,
      effectiveStatus: effectiveEnrollmentStatus(r.status, r.due_date, today),
    })
    return {
      filters,
      orgWide: authorizationService.scopeOf(ctx, 'learning.read') === 'ORGANIZATION',
      totals: {
        publishedCourses,
        enrollments: total,
        notStarted: count('NOT_STARTED'),
        inProgress: count('IN_PROGRESS'),
        completed,
        overdue,
        completionRate: total ? Math.round((completed / total) * 100) : 0,
        averageProgress: Math.round(avgProgress._avg.progress_percentage ?? 0),
        quizAttempts: attempts,
        quizPassRate: attempts ? Math.round((passed / attempts) * 100) : 0,
        pendingReviews,
      },
      courses: courseRows,
      recentCompletions: recentCompletions.map(view),
      overdueList: overdueList.map(view),
      options: { courses: allCourses, departments },
      can: { export: authorizationService.can(ctx, 'learning.export') },
    }
  },

  /** Enrollment rows for the analytics table (bounded). */
  async enrollments(ctx: RequestContext, query: unknown = {}) {
    const users = scopeOrThrow(ctx)
    const filters = parseInput(learningFilterSchema, query)
    const today = todayIn(ctx.organization.timezone)
    const rows = await prisma.courseEnrollment.findMany({
      where: enrollmentWhere(ctx, users, filters, today),
      orderBy: [{ due_date: { sort: 'asc', nulls: 'last' } }, { assigned_at: 'desc' }],
      take: 200,
      select: rowSelect,
    })
    return rows.map((r) => ({ ...r, effectiveStatus: effectiveEnrollmentStatus(r.status, r.due_date, today) }))
  },

  async exportCsv(ctx: RequestContext, query: unknown = {}) {
    authorizationService.require(ctx, 'learning.export')
    const users = scopeOrThrow(ctx)
    const filters = parseInput(learningFilterSchema, query)
    const today = todayIn(ctx.organization.timezone)
    const rows = await prisma.courseEnrollment.findMany({
      where: enrollmentWhere(ctx, users, filters, today),
      orderBy: [{ course: { title: 'asc' } }, { user: { first_name: 'asc' } }],
      take: 10000,
      select: rowSelect,
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.EXPORT_GENERATED,
      resourceType: 'learning',
      metadata: { kind: 'learning_enrollments', rows: rows.length, filters },
    })
    return {
      csv: toCsv(
        ['Person', 'Email', 'Department', 'Course', 'Type', 'Status', 'Progress (%)', 'Assigned', 'Due', 'Completed'],
        rows.map((r) => [
          fullName(r.user),
          r.user.email,
          r.user.intern?.department?.name ?? '',
          r.course.title,
          ENROLLMENT_TYPE_LABELS[r.enrollment_type],
          ENROLLMENT_STATUS_LABELS[effectiveEnrollmentStatus(r.status, r.due_date, today)],
          r.progress_percentage,
          dayKey(r.assigned_at),
          r.due_date ? formatDateOnly(r.due_date) : '',
          r.completed_at ? dayKey(r.completed_at) : '',
        ]),
      ),
      fileName: `learning-${dayKey(today)}.csv`,
    }
  },
}

/** Daily job: deadline reminders (due in 3 days) and overdue notices (the day after the due date). */
export const learningJobs = {
  async emitDeadlines(options: { organizationId?: string; now?: Date } = {}) {
    const organizations = await prisma.organization.findMany({
      where: options.organizationId ? { id: options.organizationId } : {},
      select: { id: true, timezone: true },
    })
    let dueSoon = 0
    let overdue = 0
    for (const org of organizations) {
      const today = todayIn(org.timezone, options.now)
      const open = {
        organization_id: org.id,
        status: { in: ['NOT_STARTED', 'IN_PROGRESS'] as EnrollmentStatus[] },
        course: { deleted_at: null },
      }
      const [soon, late] = await Promise.all([
        prisma.courseEnrollment.findMany({
          where: { ...open, due_date: addDays(today, 3) },
          select: { id: true, course_id: true, user_id: true },
        }),
        prisma.courseEnrollment.findMany({
          where: { ...open, due_date: addDays(today, -1) },
          select: { id: true, course_id: true, user_id: true },
        }),
      ])
      for (const [list, kind] of [
        [soon, 'DUE_SOON'],
        [late, 'OVERDUE'],
      ] as const) {
        for (const e of list) {
          if (kind === 'DUE_SOON') dueSoon++
          else overdue++
          await domainEvents.emit('learning.deadline', {
            organizationId: org.id,
            actorUserId: null,
            payload: { enrollmentId: e.id, courseId: e.course_id, userId: e.user_id, kind },
          })
        }
      }
    }
    return { learningDueSoon: dueSoon, learningOverdue: overdue }
  },
}

export type LearningOverview = Awaited<ReturnType<typeof learningAnalyticsService.overview>>
export type LearningEnrollmentRow = Awaited<ReturnType<typeof learningAnalyticsService.enrollments>>[number]
