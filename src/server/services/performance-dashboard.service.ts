import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ForbiddenError } from '@/lib/errors'
import { toCsv } from '@/lib/hr/operations'
import { dayKey } from '@/lib/hr/time'
import { formatDateOnly, todayIn } from '@/lib/interns/dates'
import { GOAL_STATUS_LABELS, REVIEW_STATUS_LABELS, weekStart } from '@/lib/performance/rules'
import { fullName } from '@/lib/utils/format'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { checkinService } from './checkin.service'
import { optionalUuid, personSelect, scopedUsers, TRACKED_STATUSES } from './hr-shared'
import { covers, ownIntern, requireInternFor, scopedInternWhere } from './performance-access'

/**
 * Performance dashboards, the per-intern evidence view and timeline, and
 * factual analytics. Every number is a count of real records and links to
 * them; nothing here scores, ranks or compares people.
 */

export const performanceFilterSchema = z.object({
  departmentId: optionalUuid,
  cycleId: optionalUuid,
})

const OPEN_STAGES = ['SELF_REVIEW', 'MANAGER_REVIEW', 'MENTOR_REVIEW', 'HR_REVIEW'] as const

type Metric = { label: string; value: number; href: string | null }

export const performanceDashboardService = {
  /** Role-aware overview for /performance: intern, manager / mentor and HR sections as permitted. */
  async overview(ctx: RequestContext) {
    authorizationService.require(ctx, 'performance.read')
    const me = ctx.actor.userId
    const today = todayIn(ctx.organization.timezone)
    const week = weekStart(today)
    const intern = await ownIntern(ctx)
    const hr = authorizationService.scopeOf(ctx, 'performance.review') === 'ORGANIZATION'
    const staffWhere = scopedInternWhere(ctx, 'performance.read')
    const team = staffWhere && !intern ? { AND: [staffWhere, { user_id: { not: me } }] } : null

    const internSection = intern
      ? await (async () => {
          const [goals, checkin, feedback, reviews, plans, requests] = await Promise.all([
            prisma.performanceGoal.findMany({
              where: { intern_id: intern.id, status: { in: ['NOT_STARTED', 'IN_PROGRESS', 'AT_RISK'] } },
              orderBy: { target_date: { sort: 'asc', nulls: 'last' } },
              take: 6,
              select: { id: true, title: true, status: true, progress: true, target_date: true },
            }),
            prisma.weeklyCheckin.findUnique({
              where: { intern_id_week_start: { intern_id: intern.id, week_start: week } },
              select: { id: true, status: true },
            }),
            prisma.feedback.findMany({
              where: { to_user_id: me, visibility: 'SHARED_WITH_INTERN' },
              orderBy: { created_at: 'desc' },
              take: 3,
              select: { id: true, body: true, feedback_type: true, created_at: true, from_user: { select: personSelect } },
            }),
            prisma.performanceReview.findMany({
              where: { intern_id: intern.id, template_id: { not: null } },
              orderBy: { created_at: 'desc' },
              take: 5,
              select: { id: true, status: true, due_date: true, cycle: { select: { name: true } } },
            }),
            prisma.developmentPlan.findMany({
              where: { intern_id: intern.id, status: 'ACTIVE', OR: [{ review_id: null }, { review: { status: 'COMPLETED' } }] },
              select: { id: true, title: true, items: { select: { status: true } } },
            }),
            prisma.feedbackRequest.count({ where: { requester_id: me, status: 'OPEN' } }),
          ])
          return {
            internId: intern.id,
            goals,
            checkin: { weekStart: week, id: checkin?.id ?? null, status: checkin?.status ?? null },
            feedback,
            reviews: reviews.map((r) => ({ ...r, myTurn: r.status === 'SELF_REVIEW' })),
            plans: plans.map(({ items, ...p }) => ({
              ...p,
              total: items.filter((i) => i.status !== 'CANCELLED').length,
              done: items.filter((i) => i.status === 'COMPLETED').length,
            })),
            openRequests: requests,
          }
        })()
      : null

    const teamSection = team
      ? await (async () => {
          const [checkinsToReview, myTurnReviews, atRisk, overdueGoals, requests, weekStatus, interns] = await Promise.all([
            authorizationService.can(ctx, 'checkin.review')
              ? prisma.weeklyCheckin.count({ where: { status: 'SUBMITTED', intern: team } })
              : Promise.resolve(0),
            prisma.performanceReview.findMany({
              where: {
                organization_id: ctx.organization.id,
                OR: [
                  { status: 'MANAGER_REVIEW', reviewer_id: me },
                  { status: 'MENTOR_REVIEW', mentor_id: me },
                  ...(hr ? [{ status: 'HR_REVIEW' as const }] : []),
                ],
              },
              orderBy: { due_date: { sort: 'asc', nulls: 'last' } },
              take: 10,
              select: { id: true, status: true, due_date: true, intern: { select: { user: { select: personSelect } } }, cycle: { select: { name: true } } },
            }),
            prisma.performanceGoal.count({ where: { status: 'AT_RISK', intern: team } }),
            prisma.performanceGoal.count({
              where: { status: { in: ['NOT_STARTED', 'IN_PROGRESS', 'AT_RISK'] }, target_date: { lt: today }, intern: team },
            }),
            prisma.feedbackRequest.count({ where: { recipient_id: me, status: 'OPEN' } }),
            checkinService.weekStatus(ctx),
            prisma.intern.count({ where: { AND: [team, { status: { in: TRACKED_STATUSES } }] } }),
          ])
          return {
            interns,
            metrics: [
              { label: 'Check-ins to review', value: checkinsToReview, href: '/performance/checkins?status=SUBMITTED' },
              { label: 'Reviews waiting for you', value: myTurnReviews.length, href: '/performance/reviews' },
              { label: 'Goals at risk', value: atRisk, href: '/performance/goals?status=AT_RISK' },
              { label: 'Goals past target date', value: overdueGoals, href: '/performance/goals' },
              { label: 'Feedback requests for you', value: requests, href: '/performance/feedback?view=requests' },
            ] satisfies Metric[],
            myTurnReviews: myTurnReviews.map((r) => ({ ...r, overdue: Boolean(r.due_date && r.due_date < today) })),
            weekStatus,
          }
        })()
      : null

    const hrSection = hr ? await this.hrSummary(ctx) : null
    return { intern: internSection, team: teamSection, hr: hrSection, today }
  },

  /**
   * Compact learning + performance items for the main dashboard: only what
   * needs the viewer's attention, each with a link. Items the viewer has no
   * permission for are left out.
   */
  async attention(ctx: RequestContext) {
    const me = ctx.actor.userId
    const today = todayIn(ctx.organization.timezone)
    const can = (key: Parameters<typeof authorizationService.can>[1]) => authorizationService.can(ctx, key)
    const intern = can('checkin.create') ? await ownIntern(ctx) : null
    const hr = authorizationService.scopeOf(ctx, 'performance.review') === 'ORGANIZATION'
    const learnerWhere = { user_id: me, status: { in: ['NOT_STARTED', 'IN_PROGRESS'] as ('NOT_STARTED' | 'IN_PROGRESS')[] }, course: { deleted_at: null } }
    const checkinTeam = scopedInternWhere(ctx, 'checkin.review')
    const reviewUsers = can('learning_assignment.review') ? scopedUsers(ctx, 'learning_assignment.review') : null
    const [activeCourses, overdueCourses, nextDue, checkin, checkinsToReview, assignmentsToReview, myReviews] = await Promise.all([
      can('learning.track') ? prisma.courseEnrollment.count({ where: learnerWhere }) : Promise.resolve(null),
      can('learning.track') ? prisma.courseEnrollment.count({ where: { ...learnerWhere, due_date: { lt: today } } }) : Promise.resolve(null),
      can('learning.track')
        ? prisma.courseEnrollment.findFirst({
            where: { ...learnerWhere, due_date: { gte: today } },
            orderBy: { due_date: 'asc' },
            select: { due_date: true, course: { select: { id: true, title: true } } },
          })
        : Promise.resolve(null),
      intern
        ? prisma.weeklyCheckin.findUnique({
            where: { intern_id_week_start: { intern_id: intern.id, week_start: weekStart(today) } },
            select: { status: true },
          })
        : Promise.resolve(null),
      checkinTeam
        ? prisma.weeklyCheckin.count({ where: { status: 'SUBMITTED', intern: { AND: [checkinTeam, { user_id: { not: me } }] } } })
        : Promise.resolve(null),
      reviewUsers
        ? prisma.learningAssignmentSubmission.count({
            where: {
              organization_id: ctx.organization.id,
              user_id: { not: me },
              user: reviewUsers,
              status: { in: ['SUBMITTED', 'RESUBMITTED', 'UNDER_REVIEW'] },
            },
          })
        : Promise.resolve(null),
      can('performance.read')
        ? prisma.performanceReview.count({
            where: {
              organization_id: ctx.organization.id,
              template_id: { not: null },
              OR: [
                { status: 'SELF_REVIEW', intern: { user_id: me } },
                { status: 'MANAGER_REVIEW', reviewer_id: me },
                { status: 'MENTOR_REVIEW', mentor_id: me },
                ...(hr ? [{ status: 'HR_REVIEW' as const, intern: { user_id: { not: me } } }] : []),
              ],
            },
          })
        : Promise.resolve(null),
    ])
    const items: { label: string; value: string; href: string; attention: boolean }[] = []
    if (activeCourses !== null) {
      items.push({ label: 'Courses in progress', value: String(activeCourses), href: '/learning', attention: false })
      if (overdueCourses) items.push({ label: 'Overdue learning', value: String(overdueCourses), href: '/learning', attention: true })
      if (nextDue?.due_date) {
        items.push({
          label: `Next due: ${nextDue.course.title}`,
          value: formatDateOnly(nextDue.due_date),
          href: `/learning/courses/${nextDue.course.id}`,
          attention: false,
        })
      }
    }
    if (intern) {
      const status = checkin?.status ?? null
      items.push({
        label: 'This week’s check-in',
        value: status === 'SUBMITTED' ? 'Submitted' : status === 'REVIEWED' ? 'Reviewed' : status === 'DRAFT' ? 'Draft' : 'Not started',
        href: '/performance/checkins',
        attention: !status || status === 'DRAFT',
      })
    }
    if (myReviews) items.push({ label: 'Reviews waiting for you', value: String(myReviews), href: '/performance/reviews', attention: true })
    if (checkinsToReview) {
      items.push({ label: 'Check-ins to review', value: String(checkinsToReview), href: '/performance/checkins?status=SUBMITTED', attention: true })
    }
    if (assignmentsToReview) {
      items.push({ label: 'Assignments to review', value: String(assignmentsToReview), href: '/learning/reviews', attention: true })
    }
    return items.length ? items : null
  },


  async hrSummary(ctx: RequestContext, query: unknown = {}) {
    if (authorizationService.scopeOf(ctx, 'performance.read') !== 'ORGANIZATION') throw new ForbiddenError()
    const filters = parseInput(performanceFilterSchema, query)
    const today = todayIn(ctx.organization.timezone)
    const internWhere: Prisma.InternWhereInput = {
      organization_id: ctx.organization.id,
      deleted_at: null,
      ...(filters.departmentId ? { department_id: filters.departmentId } : {}),
    }
    const reviewWhere: Prisma.PerformanceReviewWhereInput = {
      organization_id: ctx.organization.id,
      template_id: { not: null },
      intern: internWhere,
      ...(filters.cycleId ? { cycle_id: filters.cycleId } : {}),
    }
    const since30 = new Date(Date.now() - 30 * 86_400_000)
    const [reviewsByStatus, overdueReviews, cycles, goalsByStatus, feedbackByType, plansActive, checkinsByWeek, departments] =
      await Promise.all([
        prisma.performanceReview.groupBy({ by: ['status'], where: reviewWhere, _count: { _all: true } }),
        prisma.performanceReview.count({ where: { ...reviewWhere, status: { in: [...OPEN_STAGES] }, due_date: { lt: today } } }),
        prisma.performanceCycle.findMany({
          where: { organization_id: ctx.organization.id, status: { in: ['OPEN', 'IN_REVIEW', 'COMPLETED'] } },
          orderBy: { due_date: 'desc' },
          take: 10,
          select: { id: true, name: true, status: true, due_date: true },
        }),
        prisma.performanceGoal.groupBy({
          by: ['status'],
          where: { organization_id: ctx.organization.id, intern: internWhere },
          _count: { _all: true },
        }),
        prisma.feedback.groupBy({
          by: ['feedback_type'],
          where: { organization_id: ctx.organization.id, created_at: { gte: since30 }, intern: { is: internWhere } },
          _count: { _all: true },
        }),
        prisma.developmentPlan.count({ where: { organization_id: ctx.organization.id, status: 'ACTIVE', intern: internWhere } }),
        prisma.weeklyCheckin.groupBy({
          by: ['week_start'],
          where: {
            organization_id: ctx.organization.id,
            status: { not: 'DRAFT' },
            week_start: { gte: weekStart(new Date(today.getTime() - 7 * 7 * 86_400_000)) },
            intern: internWhere,
          },
          _count: { _all: true },
          orderBy: { week_start: 'asc' },
        }),
        prisma.department.findMany({
          where: { organization_id: ctx.organization.id },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        }),
      ])
    const tracked = await prisma.intern.count({ where: { ...internWhere, status: { in: TRACKED_STATUSES } } })
    const cycleCounts = await prisma.performanceReview.groupBy({
      by: ['cycle_id', 'status'],
      where: { cycle_id: { in: cycles.map((c) => c.id) } },
      _count: { _all: true },
    })
    return {
      filters,
      trackedInterns: tracked,
      reviewsByStatus: reviewsByStatus.map((r) => ({
        label: REVIEW_STATUS_LABELS[r.status] ?? r.status,
        status: r.status,
        value: r._count._all,
        href: `/performance/reviews?status=${r.status}`,
      })),
      overdueReviews,
      cycles: cycles.map((c) => {
        const rows = cycleCounts.filter((x) => x.cycle_id === c.id)
        return {
          ...c,
          total: rows.reduce((s, x) => s + x._count._all, 0),
          completed: rows.find((x) => x.status === 'COMPLETED')?._count._all ?? 0,
        }
      }),
      goalsByStatus: goalsByStatus.map((g) => ({
        label: GOAL_STATUS_LABELS[g.status],
        status: g.status,
        value: g._count._all,
        href: `/performance/goals?status=${g.status}`,
      })),
      feedbackLast30: feedbackByType.map((f) => ({ type: f.feedback_type, value: f._count._all })),
      plansActive,
      checkinsByWeek: checkinsByWeek.map((w) => ({ week: formatDateOnly(w.week_start), submitted: w._count._all })),
      options: { departments, cycles: cycles.map((c) => ({ id: c.id, name: c.name })) },
      can: { export: authorizationService.can(ctx, 'performance.export') },
    }
  },

  /** The evidence view: each number is a count of this intern's records with a link to them. */
  async evidence(ctx: RequestContext, internId: string) {
    const intern = await requireInternFor(ctx, 'performance.read', internId)
    const uid = intern.user_id
    const today = todayIn(ctx.organization.timezone)
    const org = ctx.organization.id
    const canTasks = covers(ctx, 'task.read', intern) || authorizationService.scopeOf(ctx, 'task.read') === 'ORGANIZATION'
    const canLearning = covers(ctx, 'learning.read', intern)
    const [tasksDone, tasksOverdue, approvedSubs, changesSubs, coursesDone, coursesActive, quizzesPassed, assignmentsApproved, goals, checkins, reviewsDone] =
      await Promise.all([
        prisma.task.count({ where: { organization_id: org, deleted_at: null, status: 'COMPLETED', assignees: { some: { user_id: uid } } } }),
        prisma.task.count({
          where: {
            organization_id: org,
            deleted_at: null,
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
            due_date: { lt: today },
            assignees: { some: { user_id: uid } },
          },
        }),
        prisma.submissionVersion.count({ where: { created_by: uid, status: 'APPROVED', submission: { task: { organization_id: org } } } }),
        prisma.submissionVersion.count({ where: { created_by: uid, status: 'CHANGES_REQUESTED', submission: { task: { organization_id: org } } } }),
        prisma.courseEnrollment.count({ where: { user_id: uid, organization_id: org, status: 'COMPLETED' } }),
        prisma.courseEnrollment.count({ where: { user_id: uid, organization_id: org, status: { in: ['NOT_STARTED', 'IN_PROGRESS'] } } }),
        prisma.quizAttempt.findMany({
          where: { user_id: uid, passed: true, quiz: { course: { organization_id: org } } },
          distinct: ['quiz_id'],
          select: { quiz_id: true },
        }),
        prisma.learningAssignmentSubmission.count({ where: { user_id: uid, organization_id: org, status: 'APPROVED' } }),
        prisma.performanceGoal.groupBy({ by: ['status'], where: { intern_id: intern.id }, _count: { _all: true } }),
        prisma.weeklyCheckin.count({ where: { intern_id: intern.id, status: { not: 'DRAFT' } } }),
        prisma.performanceReview.count({ where: { intern_id: intern.id, status: 'COMPLETED', template_id: { not: null } } }),
      ])
    const goalCount = (s: string) => goals.find((g) => g.status === s)?._count._all ?? 0
    const base = `/interns/${intern.id}`
    const groups: { title: string; metrics: Metric[] }[] = []
    if (canTasks) {
      groups.push({
        title: 'Work',
        metrics: [
          { label: 'Tasks completed', value: tasksDone, href: `/tasks?assignee=${uid}&status=COMPLETED` },
          { label: 'Open tasks past due', value: tasksOverdue, href: `/tasks?assignee=${uid}` },
          { label: 'Submissions approved', value: approvedSubs, href: `/tasks?assignee=${uid}&status=COMPLETED` },
          { label: 'Submissions sent back for changes', value: changesSubs, href: `/tasks?assignee=${uid}` },
        ],
      })
    }
    if (canLearning) {
      groups.push({
        title: 'Learning',
        metrics: [
          { label: 'Courses completed', value: coursesDone, href: `${base}?tab=learning` },
          { label: 'Courses in progress', value: coursesActive, href: `${base}?tab=learning` },
          { label: 'Quizzes passed', value: quizzesPassed.length, href: `${base}?tab=learning` },
          { label: 'Assignments approved', value: assignmentsApproved, href: `${base}?tab=learning` },
        ],
      })
    }
    groups.push({
      title: 'Development',
      metrics: [
        { label: 'Goals completed', value: goalCount('COMPLETED'), href: `/performance/goals?internId=${intern.id}&status=COMPLETED` },
        { label: 'Goals in progress', value: goalCount('IN_PROGRESS') + goalCount('NOT_STARTED'), href: `/performance/goals?internId=${intern.id}` },
        { label: 'Goals at risk', value: goalCount('AT_RISK'), href: `/performance/goals?internId=${intern.id}&status=AT_RISK` },
        {
          label: 'Weekly check-ins submitted',
          value: checkins,
          href: intern.user_id === ctx.actor.userId ? '/performance/checkins' : `/performance/checkins?internId=${intern.id}`,
        },
        { label: 'Reviews completed', value: reviewsDone, href: `/performance/reviews?internId=${intern.id}` },
      ],
    })
    return { internId: intern.id, groups }
  },

  /** Chronological record of an intern's work, learning and development (most recent first). */
  async timeline(ctx: RequestContext, internId: string, take = 40) {
    const intern = await requireInternFor(ctx, 'performance.read', internId)
    const uid = intern.user_id
    const self = uid === ctx.actor.userId
    const org = ctx.organization.id
    const [tasks, courses, goals, checkins, feedback, reviews] = await Promise.all([
      prisma.task.findMany({
        where: { organization_id: org, deleted_at: null, status: 'COMPLETED', completed_at: { not: null }, assignees: { some: { user_id: uid } } },
        orderBy: { completed_at: 'desc' },
        take,
        select: { id: true, title: true, completed_at: true },
      }),
      prisma.courseEnrollment.findMany({
        where: { user_id: uid, organization_id: org, status: 'COMPLETED', completed_at: { not: null } },
        orderBy: { completed_at: 'desc' },
        take,
        select: { course_id: true, completed_at: true, course: { select: { title: true } } },
      }),
      prisma.performanceGoal.findMany({
        where: { intern_id: intern.id },
        orderBy: { created_at: 'desc' },
        take,
        select: { id: true, title: true, created_at: true, completed_at: true },
      }),
      prisma.weeklyCheckin.findMany({
        where: { intern_id: intern.id, status: { not: 'DRAFT' }, submitted_at: { not: null } },
        orderBy: { submitted_at: 'desc' },
        take,
        select: { id: true, week_start: true, submitted_at: true },
      }),
      // Only feedback the intern can see appears on the timeline (it's a shared record).
      prisma.feedback.findMany({
        where: { to_user_id: uid, visibility: 'SHARED_WITH_INTERN' },
        orderBy: { created_at: 'desc' },
        take,
        select: { id: true, feedback_type: true, created_at: true, from_user: { select: personSelect } },
      }),
      prisma.performanceReview.findMany({
        where: { intern_id: intern.id, status: 'COMPLETED', completed_at: { not: null }, template_id: { not: null } },
        orderBy: { completed_at: 'desc' },
        take,
        select: { id: true, completed_at: true, cycle: { select: { name: true } } },
      }),
    ])
    const events = [
      ...tasks.map((t) => ({ kind: 'task' as const, at: t.completed_at!, title: `Completed task “${t.title}”`, href: `/tasks/${t.id}` })),
      ...courses.map((c) => ({ kind: 'course' as const, at: c.completed_at!, title: `Completed course “${c.course.title}”`, href: `/learning/courses/${c.course_id}` })),
      ...goals.flatMap((g) => [
        { kind: 'goal' as const, at: g.created_at, title: `Goal set: “${g.title}”`, href: `/performance/goals/${g.id}` },
        ...(g.completed_at ? [{ kind: 'goal' as const, at: g.completed_at, title: `Goal completed: “${g.title}”`, href: `/performance/goals/${g.id}` }] : []),
      ]),
      ...checkins.map((c) => ({
        kind: 'checkin' as const,
        at: c.submitted_at!,
        title: `Weekly check-in (week of ${formatDateOnly(c.week_start)})`,
        href: `/performance/checkins/${c.id}`,
      })),
      ...feedback.map((f) => ({
        kind: 'feedback' as const,
        at: f.created_at,
        title: `Feedback from ${fullName(f.from_user)}`,
        href: `/performance/feedback?highlight=${f.id}`,
      })),
      ...reviews.map((r) => ({
        kind: 'review' as const,
        at: r.completed_at!,
        title: `Review completed${r.cycle ? ` (${r.cycle.name})` : ''}`,
        href: `/performance/reviews/${r.id}`,
      })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, take)
    return { internId: intern.id, self, events }
  },

  async exportCsv(ctx: RequestContext, query: unknown = {}) {
    authorizationService.require(ctx, 'performance.export')
    if (authorizationService.scopeOf(ctx, 'performance.read') !== 'ORGANIZATION') throw new ForbiddenError()
    const filters = parseInput(performanceFilterSchema, query)
    const rows = await prisma.performanceReview.findMany({
      where: {
        organization_id: ctx.organization.id,
        template_id: { not: null },
        ...(filters.cycleId ? { cycle_id: filters.cycleId } : {}),
        ...(filters.departmentId ? { intern: { department_id: filters.departmentId } } : {}),
      },
      orderBy: [{ due_date: 'asc' }],
      take: 10000,
      select: {
        status: true,
        due_date: true,
        completed_at: true,
        review_period_start: true,
        review_period_end: true,
        cycle: { select: { name: true } },
        intern: { select: { employee_code: true, user: { select: personSelect }, department: { select: { name: true } } } },
        reviewer: { select: personSelect },
        mentor: { select: personSelect },
      },
    })
    const today = todayIn(ctx.organization.timezone)
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.EXPORT_GENERATED,
      resourceType: 'performance',
      metadata: { kind: 'performance_reviews', rows: rows.length, filters },
    })
    // Workflow status only — answers and ratings are never exported in bulk.
    return {
      csv: toCsv(
        ['Intern', 'Employee code', 'Department', 'Cycle', 'Period start', 'Period end', 'Manager', 'Mentor', 'Status', 'Due', 'Completed'],
        rows.map((r) => [
          fullName(r.intern.user),
          r.intern.employee_code ?? '',
          r.intern.department?.name ?? '',
          r.cycle?.name ?? 'Ad hoc',
          formatDateOnly(r.review_period_start),
          formatDateOnly(r.review_period_end),
          fullName(r.reviewer),
          r.mentor ? fullName(r.mentor) : '',
          REVIEW_STATUS_LABELS[r.status] ?? r.status,
          r.due_date ? formatDateOnly(r.due_date) : '',
          r.completed_at ? dayKey(r.completed_at) : '',
        ]),
      ),
      fileName: `performance-reviews-${dayKey(today)}.csv`,
    }
  },
}

export type PerformanceOverview = Awaited<ReturnType<typeof performanceDashboardService.overview>>
export type PerformanceHrSummary = Awaited<ReturnType<typeof performanceDashboardService.hrSummary>>
export type PerformanceEvidence = Awaited<ReturnType<typeof performanceDashboardService.evidence>>
export type PerformanceTimeline = Awaited<ReturnType<typeof performanceDashboardService.timeline>>
