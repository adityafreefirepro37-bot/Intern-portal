import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { fillMonths, monthKeys, monthLabel, parsePeriod, rate, toCsv, type PeriodMonths } from '@/lib/analytics/series'
import { todayIn } from '@/lib/interns/dates'
import { humanizeEnum } from '@/lib/utils/format'
import type { RequestContext } from '../context'
import { internScope } from '../repositories/scope'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'

/**
 * Programme analytics: factual counts and ratios of stored records, by month,
 * for the interns the viewer may see (analytics.read scope: HR and admins see
 * everyone, managers the interns they manage), optionally narrowed to a
 * department or team. No scores, rankings or predictions.
 *
 * Work, attendance, learning and performance figures cover those interns only.
 * Communication figures are organization-wide, so they are shown only at
 * organization scope without a department/team filter.
 */

const filterSchema = z.object({
  months: z.string().optional(),
  departmentId: z.uuid().optional().catch(undefined),
  teamId: z.uuid().optional().catch(undefined),
})

type MonthRow = { month: string }

const ENDED = ['COMPLETED', 'ALUMNI'] as const

export interface AnalyticsFilters {
  months: PeriodMonths
  departmentId?: string
  teamId?: string
}

export const analyticsService = {
  parseFilters(input: Record<string, string | undefined>): AnalyticsFilters {
    const f = filterSchema.parse(input)
    return { months: parsePeriod(f.months), departmentId: f.departmentId, teamId: f.teamId }
  },

  async filterOptions(ctx: RequestContext) {
    authorizationService.require(ctx, 'analytics.read')
    const [departments, teams] = await Promise.all([
      prisma.department.findMany({ where: { organization_id: ctx.organization.id }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      prisma.team.findMany({ where: { organization_id: ctx.organization.id, is_active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    ])
    return { departments, teams }
  },

  async overview(ctx: RequestContext, filters: AnalyticsFilters) {
    authorizationService.require(ctx, 'analytics.read')
    const scope = authorizationService.scopeOf(ctx, 'analytics.read')!
    const org = ctx.organization.id
    const tz = ctx.organization.timezone
    const today = todayIn(tz)
    const keys = monthKeys(today, filters.months)
    const startDate = `${keys[0]}-01`
    const todayKey = today.toISOString().slice(0, 10)
    const orgWide = scope === 'ORGANIZATION' && !filters.departmentId && !filters.teamId

    const internWhere: Prisma.InternWhereInput = {
      AND: [
        internScope(ctx.actor, scope),
        { deleted_at: null, status: { not: 'SELECTED' } },
        ...(filters.departmentId ? [{ department_id: filters.departmentId }] : []),
        ...(filters.teamId ? [{ team_id: filters.teamId }] : []),
      ],
    }
    const interns = await prisma.intern.findMany({
      where: internWhere,
      select: { id: true, user_id: true, status: true, joining_date: true, actual_end_date: true },
    })
    const userIds = interns.map((i) => i.user_id)
    const internIds = interns.map((i) => i.id)
    const start = new Date(`${startDate}T00:00:00Z`)

    const [
      tasksCreated,
      tasksCompleted,
      overdueByProject,
      reviews,
      attendance,
      leaveByType,
      leaveByMonth,
      coursesCompleted,
      learningNow,
      quizzes,
      goals,
      checkins,
      reviewsCompleted,
      meetings,
      responses,
      messages,
      emails,
    ] = await Promise.all([
      prisma.$queryRaw<(MonthRow & { n: number })[]>`
        SELECT to_char(t.created_at AT TIME ZONE ${tz}, 'YYYY-MM') AS month, count(DISTINCT t.id)::int AS n
        FROM tasks t JOIN task_assignees a ON a.task_id = t.id
        WHERE t.organization_id = ${org}::uuid AND t.deleted_at IS NULL AND a.user_id = ANY(${userIds}::uuid[])
          AND t.created_at >= ${start}
        GROUP BY 1`,
      prisma.$queryRaw<(MonthRow & { completed: number; with_due: number; on_time: number; avg_days: number | null })[]>`
        WITH done AS (
          SELECT DISTINCT t.id, t.created_at, t.completed_at, t.due_date
          FROM tasks t JOIN task_assignees a ON a.task_id = t.id
          WHERE t.organization_id = ${org}::uuid AND t.deleted_at IS NULL AND t.status::text = 'COMPLETED'
            AND a.user_id = ANY(${userIds}::uuid[]) AND t.completed_at >= ${start}
        )
        SELECT to_char(completed_at AT TIME ZONE ${tz}, 'YYYY-MM') AS month,
               count(*)::int AS completed,
               count(*) FILTER (WHERE due_date IS NOT NULL)::int AS with_due,
               count(*) FILTER (WHERE due_date IS NOT NULL AND (completed_at AT TIME ZONE ${tz})::date <= due_date)::int AS on_time,
               avg(extract(epoch FROM completed_at - created_at) / 86400)::float AS avg_days
        FROM done GROUP BY 1`,
      prisma.$queryRaw<{ label: string; n: number }[]>`
        SELECT coalesce(p.name, 'No project') AS label, count(DISTINCT t.id)::int AS n
        FROM tasks t JOIN task_assignees a ON a.task_id = t.id LEFT JOIN projects p ON p.id = t.project_id
        WHERE t.organization_id = ${org}::uuid AND t.deleted_at IS NULL AND a.user_id = ANY(${userIds}::uuid[])
          AND t.status::text NOT IN ('COMPLETED', 'CANCELLED') AND t.due_date < ${todayKey}::date
        GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 8`,
      prisma.$queryRaw<(MonthRow & { reviewed: number; sent_back: number; avg_hours: number | null })[]>`
        SELECT to_char(v.reviewed_at AT TIME ZONE ${tz}, 'YYYY-MM') AS month,
               count(*)::int AS reviewed,
               count(*) FILTER (WHERE v.status::text IN ('CHANGES_REQUESTED', 'REJECTED'))::int AS sent_back,
               avg(extract(epoch FROM v.reviewed_at - v.submitted_at) / 3600)::float AS avg_hours
        FROM submission_versions v JOIN task_submissions s ON s.id = v.submission_id
        WHERE s.submitted_by = ANY(${userIds}::uuid[]) AND v.reviewed_at >= ${start}
        GROUP BY 1`,
      prisma.$queryRaw<(MonthRow & { attended: number; expected: number; late: number })[]>`
        SELECT to_char(date, 'YYYY-MM') AS month,
               count(*) FILTER (WHERE status::text IN ('PRESENT', 'LATE', 'HALF_DAY'))::int AS attended,
               count(*) FILTER (WHERE status::text IN ('PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'MISSING'))::int AS expected,
               count(*) FILTER (WHERE is_late)::int AS late
        FROM attendance
        WHERE organization_id = ${org}::uuid AND user_id = ANY(${userIds}::uuid[]) AND date >= ${startDate}::date
        GROUP BY 1`,
      prisma.$queryRaw<{ label: string; n: number }[]>`
        SELECT lt.name AS label, sum(l.days)::int AS n
        FROM leave_requests l JOIN leave_types lt ON lt.id = l.leave_type_id
        WHERE l.organization_id = ${org}::uuid AND l.user_id = ANY(${userIds}::uuid[]) AND l.status::text = 'APPROVED'
          AND l.start_date >= ${startDate}::date
        GROUP BY 1 ORDER BY 2 DESC`,
      prisma.$queryRaw<(MonthRow & { n: number })[]>`
        SELECT to_char(start_date, 'YYYY-MM') AS month, sum(days)::int AS n
        FROM leave_requests
        WHERE organization_id = ${org}::uuid AND user_id = ANY(${userIds}::uuid[]) AND status::text = 'APPROVED'
          AND start_date >= ${startDate}::date
        GROUP BY 1`,
      prisma.$queryRaw<(MonthRow & { n: number })[]>`
        SELECT to_char(completed_at AT TIME ZONE ${tz}, 'YYYY-MM') AS month, count(*)::int AS n
        FROM course_enrollments
        WHERE organization_id = ${org}::uuid AND user_id = ANY(${userIds}::uuid[]) AND completed_at >= ${start}
        GROUP BY 1`,
      prisma.$queryRaw<{ total: number; completed: number; overdue: number }[]>`
        SELECT count(*) FILTER (WHERE status::text <> 'CANCELLED')::int AS total,
               count(*) FILTER (WHERE status::text = 'COMPLETED')::int AS completed,
               count(*) FILTER (WHERE status::text IN ('NOT_STARTED', 'IN_PROGRESS') AND due_date < ${todayKey}::date)::int AS overdue
        FROM course_enrollments
        WHERE organization_id = ${org}::uuid AND user_id = ANY(${userIds}::uuid[])`,
      prisma.$queryRaw<{ submitted: number; passed: number }[]>`
        SELECT count(*)::int AS submitted, count(*) FILTER (WHERE passed)::int AS passed
        FROM quiz_attempts
        WHERE user_id = ANY(${userIds}::uuid[]) AND status::text = 'SUBMITTED' AND submitted_at >= ${start}`,
      prisma.$queryRaw<{ completed: number; open: number; at_risk: number }[]>`
        SELECT count(*) FILTER (WHERE status::text = 'COMPLETED' AND completed_at >= ${start})::int AS completed,
               count(*) FILTER (WHERE status::text IN ('NOT_STARTED', 'IN_PROGRESS', 'AT_RISK'))::int AS open,
               count(*) FILTER (WHERE status::text = 'AT_RISK')::int AS at_risk
        FROM performance_goals
        WHERE organization_id = ${org}::uuid AND owner_id = ANY(${userIds}::uuid[])`,
      prisma.$queryRaw<{ submitted: number; reviewed: number }[]>`
        SELECT count(*) FILTER (WHERE submitted_at >= ${start})::int AS submitted,
               count(*) FILTER (WHERE reviewed_at >= ${start})::int AS reviewed
        FROM weekly_checkins
        WHERE organization_id = ${org}::uuid AND intern_id = ANY(${internIds}::uuid[])`,
      prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM performance_reviews
        WHERE organization_id = ${org}::uuid AND intern_id = ANY(${internIds}::uuid[])
          AND status::text = 'COMPLETED' AND completed_at >= ${start}`,
      orgWide
        ? prisma.$queryRaw<(MonthRow & { held: number; cancelled: number })[]>`
            SELECT to_char(start_at AT TIME ZONE ${tz}, 'YYYY-MM') AS month,
                   count(*) FILTER (WHERE status::text = 'SCHEDULED')::int AS held,
                   count(*) FILTER (WHERE status::text = 'CANCELLED')::int AS cancelled
            FROM meetings WHERE organization_id = ${org}::uuid AND start_at >= ${start} AND start_at < now() + interval '1 day'
            GROUP BY 1`
        : Promise.resolve([]),
      orgWide
        ? prisma.$queryRaw<{ response: string; n: number }[]>`
            SELECT ma.response::text AS response, count(*)::int AS n
            FROM meeting_attendees ma JOIN meetings m ON m.id = ma.meeting_id
            WHERE m.organization_id = ${org}::uuid AND m.start_at >= ${start} AND NOT ma.is_organizer AND m.status::text = 'SCHEDULED'
            GROUP BY 1`
        : Promise.resolve([]),
      orgWide
        ? prisma.$queryRaw<(MonthRow & { n: number })[]>`
            SELECT to_char(m.created_at AT TIME ZONE ${tz}, 'YYYY-MM') AS month, count(*)::int AS n
            FROM messages m JOIN channels c ON c.id = m.channel_id
            WHERE c.organization_id = ${org}::uuid AND m.deleted_at IS NULL AND m.created_at >= ${start}
            GROUP BY 1`
        : Promise.resolve([]),
      orgWide
        ? prisma.$queryRaw<{ status: string; n: number }[]>`
            SELECT status::text AS status, count(*)::int AS n FROM notification_deliveries
            WHERE organization_id = ${org}::uuid AND created_at >= ${start}
            GROUP BY 1`
        : Promise.resolve([]),
    ])

    // Pipeline (from the intern rows).
    const inRange = (d: Date | null) => Boolean(d && d >= start && d <= today)
    const monthOf = (d: Date) => d.toISOString().slice(0, 7)
    const joinedByMonth = keys.map((k) => interns.filter((i) => i.joining_date && inRange(i.joining_date) && monthOf(i.joining_date) === k).length)
    const ended = interns.filter((i) => inRange(i.actual_end_date) && (ENDED as readonly string[]).includes(i.status))
    const terminated = interns.filter((i) => inRange(i.actual_end_date) && i.status === 'TERMINATED')
    const completedByMonth = keys.map((k) => ended.filter((i) => monthOf(i.actual_end_date!) === k).length)
    const lengths = ended
      .filter((i) => i.joining_date)
      .map((i) => (i.actual_end_date!.getTime() - i.joining_date!.getTime()) / 86_400_000)
    const statusCounts = new Map<string, number>()
    for (const i of interns) statusCounts.set(i.status, (statusCounts.get(i.status) ?? 0) + 1)
    const STATUS_ORDER = ['ONBOARDING', 'ACTIVE', 'ENDING_SOON', 'COMPLETED', 'ALUMNI', 'TERMINATED']

    // Work.
    const created = fillMonths(keys, tasksCreated, (r) => r.n)
    const completed = fillMonths(keys, tasksCompleted, (r) => r.completed)
    const sum = (rows: number[]) => rows.reduce((a, b) => a + b, 0)
    const withDue = sum(tasksCompleted.map((r) => r.with_due))
    const onTime = sum(tasksCompleted.map((r) => r.on_time))
    const totalCompleted = sum(completed)
    const avgDays = totalCompleted
      ? tasksCompleted.reduce((a, r) => a + (r.avg_days ?? 0) * r.completed, 0) / totalCompleted
      : null
    const reviewed = sum(reviews.map((r) => r.reviewed))
    const avgReviewHours = reviewed ? reviews.reduce((a, r) => a + (r.avg_hours ?? 0) * r.reviewed, 0) / reviewed : null

    // Attendance and leave.
    const attended = sum(attendance.map((r) => r.attended))
    const expected = sum(attendance.map((r) => r.expected))
    const attendanceRate = keys.map((k) => {
      const row = attendance.find((r) => r.month === k)
      return row ? rate(row.attended, row.expected) : null
    })

    const learning = learningNow[0] ?? { total: 0, completed: 0, overdue: 0 }
    const quiz = quizzes[0] ?? { submitted: 0, passed: 0 }
    const goal = goals[0] ?? { completed: 0, open: 0, at_risk: 0 }
    const checkin = checkins[0] ?? { submitted: 0, reviewed: 0 }
    const answered = responses.filter((r) => r.response !== 'PENDING')
    const accepted = responses.find((r) => r.response === 'ACCEPTED')?.n ?? 0
    const email = (s: string) => emails.find((e) => e.status === s)?.n ?? 0

    return {
      scope,
      orgWide,
      months: keys,
      monthLabels: keys.map((k) => monthLabel(k, filters.months === 12)),
      internCount: interns.length,
      pipeline: {
        byStatus: STATUS_ORDER.filter((s) => statusCounts.has(s)).map((s) => ({ label: humanizeEnum(s), value: statusCounts.get(s)! })),
        joinedByMonth,
        completedByMonth,
        joined: sum(joinedByMonth),
        completed: ended.length,
        terminated: terminated.length,
        completionRate: rate(ended.length, ended.length + terminated.length),
        avgLengthDays: lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : null,
      },
      work: {
        createdByMonth: created,
        completedByMonth: completed,
        created: sum(created),
        completed: totalCompleted,
        onTimeRate: rate(onTime, withDue),
        avgDaysToComplete: avgDays === null ? null : Math.round(avgDays * 10) / 10,
        reviewed,
        reviewsByMonth: fillMonths(keys, reviews, (r) => r.reviewed),
        sentBackRate: rate(sum(reviews.map((r) => r.sent_back)), reviewed),
        avgReviewHours: avgReviewHours === null ? null : Math.round(avgReviewHours),
        overdueByProject: overdueByProject.map((r) => ({ label: r.label, value: r.n })),
        overdueOpen: sum(overdueByProject.map((r) => r.n)),
      },
      attendance: {
        rateByMonth: attendanceRate,
        lateByMonth: fillMonths(keys, attendance, (r) => r.late),
        rate: rate(attended, expected),
        late: sum(attendance.map((r) => r.late)),
        leaveByMonth: fillMonths(keys, leaveByMonth, (r) => r.n),
        leaveByType: leaveByType.map((r) => ({ label: r.label, value: r.n })),
        leaveDays: sum(leaveByType.map((r) => r.n)),
      },
      learning: {
        completedByMonth: fillMonths(keys, coursesCompleted, (r) => r.n),
        coursesCompleted: sum(coursesCompleted.map((r) => r.n)),
        completionRate: rate(learning.completed, learning.total),
        overdue: learning.overdue,
        quizzes: quiz.submitted,
        quizPassRate: rate(quiz.passed, quiz.submitted),
      },
      performance: {
        goalsCompleted: goal.completed,
        goalsOpen: goal.open,
        goalsAtRisk: goal.at_risk,
        checkinsSubmitted: checkin.submitted,
        checkinsReviewedRate: rate(checkin.reviewed, checkin.submitted),
        reviewsCompleted: reviewsCompleted[0]?.n ?? 0,
      },
      communication: orgWide
        ? {
            meetingsByMonth: fillMonths(keys, meetings, (r) => r.held),
            meetings: sum(meetings.map((r) => r.held)),
            cancelled: sum(meetings.map((r) => r.cancelled)),
            acceptanceRate: rate(accepted, sum(answered.map((r) => r.n))),
            noReply: responses.find((r) => r.response === 'PENDING')?.n ?? 0,
            messagesByMonth: fillMonths(keys, messages, (r) => r.n),
            messages: sum(messages.map((r) => r.n)),
            emailsSent: email('SENT'),
            emailsFailed: email('FAILED'),
            emailsSkipped: email('SKIPPED'),
          }
        : null,
    }
  },

  /** The monthly table as CSV (analytics.export; audited). */
  async exportCsv(ctx: RequestContext, filters: AnalyticsFilters) {
    authorizationService.require(ctx, 'analytics.export')
    const data = await this.overview(ctx, filters)
    const header = [
      'Month',
      'Interns joined',
      'Internships completed',
      'Tasks created',
      'Tasks completed',
      'Submissions reviewed',
      'Attendance rate %',
      'Late arrivals',
      'Leave days',
      'Courses completed',
      ...(data.communication ? ['Meetings', 'Messages'] : []),
    ]
    const rows = data.months.map((month, i) => [
      month,
      data.pipeline.joinedByMonth[i],
      data.pipeline.completedByMonth[i],
      data.work.createdByMonth[i],
      data.work.completedByMonth[i],
      data.work.reviewsByMonth[i],
      data.attendance.rateByMonth[i],
      data.attendance.lateByMonth[i],
      data.attendance.leaveByMonth[i],
      data.learning.completedByMonth[i],
      ...(data.communication ? [data.communication.meetingsByMonth[i], data.communication.messagesByMonth[i]] : []),
    ])
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.EXPORT_GENERATED,
      resourceType: 'analytics',
      metadata: { kind: 'programme-analytics', months: filters.months, departmentId: filters.departmentId ?? null, teamId: filters.teamId ?? null },
    })
    return { filename: `analytics-${data.months[0]}-to-${data.months[data.months.length - 1]}.csv`, body: toCsv([header, ...rows]) }
  },
}

export type AnalyticsOverview = Awaited<ReturnType<typeof analyticsService.overview>>
