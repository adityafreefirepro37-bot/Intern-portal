import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import { ForbiddenError } from '@/lib/errors'
import { onboardingBucket, toCsv, type OnboardingBucket } from '@/lib/hr/operations'
import { HR_REQUEST_CATEGORY_LABELS } from '@/lib/hr/requests'
import { dayKey, eachDay, formatMonth, monthRange, parseMonth, shiftMonth } from '@/lib/hr/time'
import { addDays, todayIn } from '@/lib/interns/dates'
import { onboardingProgress } from '@/lib/interns/progress'
import type { PermissionKey } from '@/lib/permissions'
import { fullName } from '@/lib/utils/format'
import type { RequestContext } from '../context'
import { internScope } from '../repositories/scope'
import { attendanceRates } from './attendance.service'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { completionByIntern } from './document.service'
import { holidayService } from './holiday.service'
import { personSelect, TRACKED_STATUSES } from './hr-shared'
import { settingsService } from './settings.service'

/**
 * HR dashboard, action centre, HR calendar and analytics. Every figure is a
 * count or ratio of stored records within the viewer's scope — no estimates.
 */

export interface ActionItem {
  key: string
  label: string
  count: number
  href: string
  tone: 'urgent' | 'attention' | 'info'
}

function internsWhere(ctx: RequestContext): Prisma.InternWhereInput {
  const scope = authorizationService.scopeOf(ctx, 'intern.read')
  if (!scope) throw new ForbiddenError()
  return { AND: [internScope(ctx.actor, scope), { deleted_at: null }] }
}

export const hrDashboardService = {
  /**
   * KPIs, the action centre and today's attendance come from one aggregate
   * query (plus settings, three short lists and holidays), so the page stays
   * fast even on a single pooled database connection. Organization-wide only.
   */
  async overview(ctx: RequestContext) {
    authorizationService.require(ctx, 'hr_dashboard.read')
    if (authorizationService.scopeOf(ctx, 'intern.read') !== 'ORGANIZATION') {
      throw new ForbiddenError('The HR dashboard is organization-wide')
    }
    const org = ctx.organization.id
    const actor = ctx.actor.userId
    const today = todayIn(ctx.organization.timezone)
    const [monthStart, monthEnd] = monthRange(today)
    const settings = await settingsService.hrSettings(org)
    const endingUntil = addDays(today, settings.endingSoonDays)
    const expiringUntil = addDays(today, settings.expiryWarningDays)
    const weekAhead = addDays(today, 7)
    const monthAgo = addDays(today, -30)

    const [row] = await prisma.$queryRaw<Record<string, bigint>[]>`
      WITH tracked AS (
        SELECT i.id, i.user_id FROM interns i
        WHERE i.organization_id = ${org}::uuid AND i.deleted_at IS NULL
          AND i.status IN ('ONBOARDING', 'ACTIVE', 'ENDING_SOON')
          AND (i.joining_date IS NULL OR i.joining_date <= ${today}::date)
      ), away AS (
        SELECT DISTINCT l.user_id FROM leave_requests l
        WHERE l.organization_id = ${org}::uuid AND l.status = 'APPROVED'
          AND l.start_date <= ${today}::date AND l.end_date >= ${today}::date
      ), people AS (
        SELECT i.* FROM interns i WHERE i.organization_id = ${org}::uuid AND i.deleted_at IS NULL
      )
      SELECT
        (SELECT count(*) FROM people) AS total,
        (SELECT count(*) FROM people WHERE status IN ('ACTIVE', 'ENDING_SOON')) AS active,
        (SELECT count(*) FROM people WHERE status = 'ONBOARDING') AS onboarding,
        (SELECT count(*) FROM people WHERE status IN ('ACTIVE', 'ENDING_SOON')
           AND expected_end_date BETWEEN ${today}::date AND ${endingUntil}::date) AS ending_soon,
        (SELECT count(*) FROM people WHERE status IN ('COMPLETED', 'ALUMNI')
           AND actual_end_date BETWEEN ${monthStart}::date AND ${monthEnd}::date) AS completed_month,
        (SELECT count(*) FROM people WHERE status IN ('SELECTED', 'ONBOARDING', 'ACTIVE', 'ENDING_SOON')
           AND (manager_id IS NULL OR mentor_id IS NULL)) AS unassigned,
        (SELECT count(*) FROM people p WHERE p.status IN ('ACTIVE', 'ENDING_SOON')
           AND p.expected_end_date <= ${weekAhead}::date
           AND NOT EXISTS (SELECT 1 FROM offboarding_checklists o WHERE o.intern_id = p.id)) AS ending_no_offboarding,
        (SELECT count(*) FROM leave_requests l WHERE l.organization_id = ${org}::uuid AND l.status = 'PENDING'
           AND l.user_id <> ${actor}::uuid) AS pending_leave,
        (SELECT count(*) FROM away) AS on_leave_today,
        (SELECT count(*) FROM attendance_corrections c WHERE c.organization_id = ${org}::uuid
           AND c.status = 'PENDING' AND c.user_id <> ${actor}::uuid) AS pending_corrections,
        (SELECT count(*) FROM attendance a WHERE a.organization_id = ${org}::uuid AND a.check_in_at IS NOT NULL
           AND a.check_out_at IS NULL AND a.date < ${today}::date AND a.date >= ${monthAgo}::date) AS missing,
        (SELECT count(*) FROM internship_documents d JOIN people p ON p.id = d.intern_id
           WHERE d.deleted_at IS NULL AND d.is_current AND d.status IN ('UPLOADED', 'UNDER_REVIEW')
           AND (d.expires_at IS NULL OR d.expires_at >= ${today}::date)) AS documents_pending,
        (SELECT count(*) FROM internship_documents d JOIN people p ON p.id = d.intern_id
           WHERE d.deleted_at IS NULL AND d.is_current AND d.status <> 'REJECTED'
           AND d.expires_at BETWEEN ${today}::date AND ${expiringUntil}::date) AS documents_expiring,
        (SELECT count(*) FROM internship_documents d JOIN people p ON p.id = d.intern_id
           WHERE d.deleted_at IS NULL AND d.is_current
           AND (d.status = 'EXPIRED' OR (d.status <> 'REJECTED' AND d.expires_at < ${today}::date))) AS documents_expired,
        (SELECT count(*) FROM hr_requests r WHERE r.organization_id = ${org}::uuid AND r.deleted_at IS NULL
           AND r.status IN ('OPEN', 'IN_REVIEW')) AS open_requests,
        (SELECT count(DISTINCT o.id) FROM onboardings o
           JOIN internships s ON s.id = o.internship_id
           JOIN people p ON p.id = s.intern_id
           JOIN onboarding_items it ON it.onboarding_id = o.id
           WHERE o.completed_at IS NULL AND it.due_date < ${today}::date
           AND it.status NOT IN ('COMPLETED', 'SKIPPED')) AS onboarding_overdue,
        (SELECT count(*) FROM tracked t WHERE t.user_id NOT IN (SELECT user_id FROM away)) AS expected_today,
        (SELECT count(*) FROM attendance a JOIN tracked t ON t.user_id = a.user_id
           WHERE a.date = ${today}::date AND a.check_in_at IS NOT NULL) AS checked_in_today,
        (SELECT count(*) FROM attendance a JOIN tracked t ON t.user_id = a.user_id
           WHERE a.date = ${today}::date AND a.is_late) AS late_today,
        (SELECT count(*) FROM holidays h WHERE h.organization_id = ${org}::uuid AND h.date = ${today}::date) AS holiday_today
    `
    const n = (key: string) => Number(row?.[key] ?? 0)
    const can = (key: PermissionKey) => authorizationService.can(ctx, key)
    const canLeave = can('leave.read')
    const canAttendance = can('attendance.read')
    const canDocuments = can('document.verify')
    const canRequests = authorizationService.scopeOf(ctx, 'hr_request.manage') === 'ORGANIZATION'
    const workingToday = settings.attendance.workingDays.includes(today.getUTCDay()) && n('holiday_today') === 0

    const candidates: (ActionItem | false)[] = [
      canLeave && {
        key: 'leave',
        label: 'Leave requests awaiting a decision',
        count: n('pending_leave'),
        href: '/hr/leave?status=PENDING',
        tone: 'urgent',
      },
      can('attendance_correction.review') && {
        key: 'corrections',
        label: 'Attendance corrections to review',
        count: n('pending_corrections'),
        href: '/hr/attendance?view=corrections',
        tone: 'urgent',
      },
      canAttendance && {
        key: 'missing',
        label: 'Missing check-outs (last 30 days)',
        count: n('missing'),
        href: '/hr/attendance?view=records&status=MISSING',
        tone: 'attention',
      },
      canDocuments && {
        key: 'documents',
        label: 'Documents awaiting verification',
        count: n('documents_pending'),
        href: '/hr/documents?status=PENDING',
        tone: 'urgent',
      },
      canDocuments && {
        key: 'expired',
        label: 'Expired documents',
        count: n('documents_expired'),
        href: '/hr/documents?status=EXPIRED',
        tone: 'attention',
      },
      canDocuments && {
        key: 'expiring',
        label: 'Documents expiring soon',
        count: n('documents_expiring'),
        href: '/hr/documents?expiring=1',
        tone: 'info',
      },
      can('onboarding.read') && {
        key: 'onboarding',
        label: 'Onboarding checklists overdue',
        count: n('onboarding_overdue'),
        href: '/onboarding?bucket=OVERDUE',
        tone: 'attention',
      },
      canRequests && {
        key: 'requests',
        label: 'Open HR requests',
        count: n('open_requests'),
        href: '/hr/requests?status=ACTIVE',
        tone: 'urgent',
      },
      can('offboarding.read') && {
        key: 'offboarding',
        label: 'Ending within 7 days without offboarding',
        count: n('ending_no_offboarding'),
        href: '/hr/offboarding?window=7',
        tone: 'attention',
      },
      {
        key: 'unassigned',
        label: 'Interns without a manager or mentor',
        count: n('unassigned'),
        href: '/interns',
        tone: 'info',
      },
    ]
    const actions = candidates.filter((item): item is ActionItem => Boolean(item) && (item as ActionItem).count > 0)

    const listSelect = {
      id: true,
      status: true,
      employee_code: true,
      joining_date: true,
      expected_end_date: true,
      user: { select: personSelect },
      position: { select: { title: true } },
      department: { select: { name: true } },
    } as const
    const base = { organization_id: org, deleted_at: null }
    const [endingSoon, joining, recent, holidays] = await Promise.all([
      prisma.intern.findMany({
        where: { ...base, status: 'ENDING_SOON' },
        orderBy: { expected_end_date: 'asc' },
        take: 6,
        select: listSelect,
      }),
      prisma.intern.findMany({
        where: { ...base, joining_date: { gte: today } },
        orderBy: { joining_date: 'asc' },
        take: 6,
        select: listSelect,
      }),
      prisma.intern.findMany({ where: base, orderBy: { created_at: 'desc' }, take: 6, select: listSelect }),
      holidayService.upcoming(ctx, today, 4),
    ])

    const expected = n('expected_today')
    const checkedIn = n('checked_in_today')
    return {
      kpis: {
        total: n('total'),
        active: n('active'),
        onboarding: n('onboarding'),
        endingSoon: n('ending_soon'),
        completedThisMonth: n('completed_month'),
        pendingDocuments: canDocuments ? n('documents_pending') : null,
        pendingLeave: canLeave ? n('pending_leave') : null,
        attendanceIssues: canAttendance ? n('missing') + n('pending_corrections') : null,
      },
      endingDays: settings.endingSoonDays,
      actions,
      today: canAttendance
        ? {
            expected,
            checkedIn,
            late: n('late_today'),
            onLeave: n('on_leave_today'),
            notCheckedIn: workingToday ? Math.max(0, expected - checkedIn) : 0,
            workingDay: workingToday,
          }
        : null,
      holidays,
      lists: { endingSoon, joining, recent },
    }
  },

  /** Month agenda of HR dates within scope; every event carries a text label (no colour-only meaning). */
  async calendar(ctx: RequestContext, monthInput?: string) {
    authorizationService.require(ctx, 'hr_dashboard.read')
    const where = internsWhere(ctx)
    const today = todayIn(ctx.organization.timezone)
    const month = parseMonth(monthInput) ?? parseMonth(formatMonth(today))!
    const [start, end] = monthRange(month)
    const range = { gte: start, lte: end }
    const internUser = { select: { id: true, user: { select: personSelect } } } as const
    const [joining, ending, leave, holidays, onboarding, expiring, reviews, meetings] = await Promise.all([
      prisma.intern.findMany({
        where: { AND: [where, { joining_date: range }] },
        select: { id: true, joining_date: true, user: { select: personSelect } },
      }),
      prisma.intern.findMany({
        where: { AND: [where, { expected_end_date: range, status: { notIn: ['TERMINATED'] } }] },
        select: { id: true, expected_end_date: true, user: { select: personSelect } },
      }),
      authorizationService.can(ctx, 'leave.read')
        ? prisma.leaveRequest.findMany({
            where: {
              organization_id: ctx.organization.id,
              status: 'APPROVED',
              start_date: { lte: end },
              end_date: { gte: start },
              user: { intern: { is: where } },
            },
            select: {
              id: true,
              start_date: true,
              end_date: true,
              leave_type: { select: { name: true } },
              user: { select: { ...personSelect, intern: { select: { id: true } } } },
            },
          })
        : Promise.resolve([]),
      prisma.holiday.findMany({
        where: { organization_id: ctx.organization.id, date: range },
        select: { date: true, name: true },
      }),
      authorizationService.can(ctx, 'onboarding.read')
        ? prisma.onboardingItem.findMany({
            where: {
              organization_id: ctx.organization.id,
              due_date: range,
              status: { notIn: ['COMPLETED', 'SKIPPED'] },
              internship: { intern: where },
            },
            select: { due_date: true, title: true, internship: { select: { intern: internUser } } },
          })
        : Promise.resolve([]),
      authorizationService.can(ctx, 'document.verify')
        ? prisma.internshipDocument.findMany({
            where: {
              organization_id: ctx.organization.id,
              deleted_at: null,
              is_current: true,
              expires_at: range,
              intern: where,
            },
            select: { expires_at: true, file_name: true, type: { select: { name: true } }, intern: internUser },
          })
        : Promise.resolve([]),
      authorizationService.can(ctx, 'performance.read')
        ? prisma.performanceReview.findMany({
            where: { organization_id: ctx.organization.id, review_period_end: range, intern: where },
            select: { review_period_end: true, intern: internUser },
          })
        : Promise.resolve([]),
      authorizationService.can(ctx, 'meeting.read')
        ? prisma.meeting.findMany({
            where: { organization_id: ctx.organization.id, start_at: { gte: start, lt: addDays(end, 1) } },
            select: { id: true, title: true, start_at: true },
          })
        : Promise.resolve([]),
    ])

    type Event = { date: string; kind: CalendarKind; title: string; href: string | null }
    const events: Event[] = []
    for (const i of joining)
      events.push({
        date: dayKey(i.joining_date!),
        kind: 'JOINING',
        title: `${fullName(i.user)} joins`,
        href: `/interns/${i.id}`,
      })
    for (const i of ending)
      events.push({
        date: dayKey(i.expected_end_date!),
        kind: 'ENDING',
        title: `${fullName(i.user)}’s internship ends`,
        href: `/interns/${i.id}`,
      })
    for (const h of holidays) events.push({ date: dayKey(h.date), kind: 'HOLIDAY', title: h.name, href: null })
    for (const l of leave) {
      for (const d of eachDay(l.start_date < start ? start : l.start_date, l.end_date > end ? end : l.end_date)) {
        events.push({
          date: dayKey(d),
          kind: 'LEAVE',
          title: `${fullName(l.user)} — ${l.leave_type.name}`,
          href: l.user.intern ? `/interns/${l.user.intern.id}?tab=leave` : null,
        })
      }
    }
    const onboardingByDay = new Map<string, { internId: string; name: string; count: number }>()
    for (const item of onboarding) {
      const key = `${dayKey(item.due_date!)}|${item.internship.intern.id}`
      const entry = onboardingByDay.get(key) ?? {
        internId: item.internship.intern.id,
        name: fullName(item.internship.intern.user),
        count: 0,
      }
      entry.count++
      onboardingByDay.set(key, entry)
    }
    for (const [key, entry] of onboardingByDay) {
      events.push({
        date: key.split('|')[0],
        kind: 'ONBOARDING',
        title: `${entry.name}: ${entry.count} onboarding item${entry.count === 1 ? '' : 's'} due`,
        href: `/interns/${entry.internId}/onboarding`,
      })
    }
    for (const d of expiring)
      events.push({
        date: dayKey(d.expires_at!),
        kind: 'DOCUMENT',
        title: `${fullName(d.intern.user)}: ${d.type?.name ?? d.file_name} expires`,
        href: `/interns/${d.intern.id}?tab=documents`,
      })
    for (const r of reviews)
      events.push({
        date: dayKey(r.review_period_end),
        kind: 'REVIEW',
        title: `${fullName(r.intern.user)}: review period ends`,
        href: `/interns/${r.intern.id}`,
      })
    for (const m of meetings)
      events.push({
        date: todayKeyIn(m.start_at, ctx.organization.timezone),
        kind: 'MEETING',
        title: m.title,
        href: null,
      })
    events.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind))
    return {
      month,
      today,
      prev: formatMonth(shiftMonth(month, -1)),
      next: formatMonth(shiftMonth(month, 1)),
      days: eachDay(start, end).map((date) => ({
        date,
        key: dayKey(date),
        events: events.filter((e) => e.date === dayKey(date)),
      })),
      total: events.length,
    }
  },

  /** Factual HR metrics (counts and ratios of stored records only). */
  async analytics(ctx: RequestContext) {
    authorizationService.require(ctx, 'analytics.read')
    const where = internsWhere(ctx)
    const org = ctx.organization.id
    const today = todayIn(ctx.organization.timezone)
    const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1))
    const sixMonthsAgo = shiftMonth(today, -5)
    const [
      byStatus,
      byDepartment,
      joiners,
      tracked,
      leaveByType,
      leaveByStatus,
      docStatus,
      requestsByCategory,
      resolved,
      onboardings,
      late,
    ] = await Promise.all([
      prisma.intern.groupBy({ by: ['status'], where, _count: { _all: true } }),
      prisma.intern.groupBy({
        by: ['department_id'],
        where: { AND: [where, { status: { in: TRACKED_STATUSES } }] },
        _count: { _all: true },
      }),
      prisma.intern.findMany({
        where: { AND: [where, { joining_date: { gte: sixMonthsAgo, lte: today } }] },
        select: { joining_date: true },
      }),
      prisma.intern.findMany({
        where: { AND: [where, { status: { in: TRACKED_STATUSES } }] },
        select: { id: true, user_id: true, joining_date: true },
      }),
      prisma.leaveRequest.groupBy({
        by: ['leave_type_id'],
        where: {
          organization_id: org,
          status: 'APPROVED',
          start_date: { gte: yearStart },
          user: { intern: { is: where } },
        },
        _sum: { days: true },
        _count: { _all: true },
      }),
      prisma.leaveRequest.groupBy({
        by: ['status'],
        where: { organization_id: org, created_at: { gte: yearStart }, user: { intern: { is: where } } },
        _count: { _all: true },
      }),
      prisma.internshipDocument.groupBy({
        by: ['status'],
        where: { organization_id: org, deleted_at: null, is_current: true, intern: where },
        _count: { _all: true },
      }),
      prisma.hrRequest.groupBy({
        by: ['category'],
        where: { organization_id: org, deleted_at: null },
        _count: { _all: true },
      }),
      prisma.hrRequest.findMany({
        where: { organization_id: org, deleted_at: null, resolved_at: { not: null } },
        select: { created_at: true, resolved_at: true },
      }),
      prisma.onboarding.findMany({
        where: { organization_id: org, internship: { intern: where } },
        select: {
          started_at: true,
          completed_at: true,
          internship: { select: { onboarding_items: { select: { required: true, status: true, due_date: true } } } },
        },
      }),
      prisma.attendance.count({
        where: {
          organization_id: org,
          is_late: true,
          date: { gte: addDays(today, -30), lt: today },
          user: { intern: { is: where } },
        },
      }),
    ])
    const [departments, types, rates, completion] = await Promise.all([
      prisma.department.findMany({ where: { organization_id: org }, select: { id: true, name: true } }),
      prisma.leaveType.findMany({ where: { organization_id: org }, select: { id: true, name: true } }),
      attendanceRates(
        org,
        ctx.organization.timezone,
        tracked.map((t) => ({ userId: t.user_id, joiningDate: t.joining_date })),
      ),
      completionByIntern(
        org,
        tracked.map((t) => t.id),
        today,
      ),
    ])
    const rateValues = [...rates.values()].filter((v): v is number => v !== null)
    const completionValues = [...completion.values()]
    const buckets: Record<OnboardingBucket, number> = {
      NOT_STARTED: 0,
      IN_PROGRESS: 0,
      NEARLY_COMPLETE: 0,
      COMPLETE: 0,
      OVERDUE: 0,
    }
    for (const o of onboardings)
      buckets[onboardingBucket(onboardingProgress(o.internship.onboarding_items, today), Boolean(o.completed_at))]++
    const completedOnboardings = onboardings.filter((o) => o.completed_at)
    const months = Array.from({ length: 6 }, (_, i) => formatMonth(shiftMonth(sixMonthsAgo, i)))
    const avg = (values: number[]) =>
      values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null
    return {
      interns: {
        byStatus: byStatus.map((r) => ({ label: r.status, value: r._count._all })),
        byDepartment: byDepartment.map((r) => ({
          label: departments.find((d) => d.id === r.department_id)?.name ?? 'No department',
          value: r._count._all,
        })),
        joinersByMonth: months.map((m) => ({
          label: m,
          value: joiners.filter((j) => j.joining_date && formatMonth(j.joining_date) === m).length,
        })),
      },
      attendance: {
        averageRate: avg(rateValues),
        measured: rateValues.length,
        lateArrivals30d: late,
      },
      leave: {
        approvedDaysByType: leaveByType.map((r) => ({
          label: types.find((t) => t.id === r.leave_type_id)?.name ?? 'Unknown',
          value: r._sum.days ?? 0,
          requests: r._count._all,
        })),
        byStatus: leaveByStatus.map((r) => ({ label: r.status, value: r._count._all })),
      },
      documents: {
        byStatus: docStatus.map((r) => ({ label: r.status, value: r._count._all })),
        averageCompletion: avg(completionValues.map((c) => c.percent)),
        fullyComplete: completionValues.filter((c) => c.complete).length,
        tracked: completionValues.length,
      },
      onboarding: {
        buckets: Object.entries(buckets).map(([label, value]) => ({ label, value })),
        averageDaysToComplete: avg(
          completedOnboardings.map((o) => (o.completed_at!.getTime() - o.started_at.getTime()) / 86_400_000),
        ),
      },
      requests: {
        byCategory: requestsByCategory.map((r) => ({
          label: HR_REQUEST_CATEGORY_LABELS[r.category],
          value: r._count._all,
        })),
        averageResolutionDays: avg(
          resolved.map((r) => (r.resolved_at!.getTime() - r.created_at.getTime()) / 86_400_000),
        ),
      },
      generatedAt: new Date(),
    }
  },

  async analyticsCsv(ctx: RequestContext) {
    authorizationService.require(ctx, 'analytics.export')
    const data = await this.analytics(ctx)
    const rows: (string | number | null)[][] = []
    const add = (section: string, list: { label: string; value: number }[]) =>
      list.forEach((item) => rows.push([section, item.label, item.value]))
    add('Interns by status', data.interns.byStatus)
    add('Interns by department', data.interns.byDepartment)
    add('Joiners by month', data.interns.joinersByMonth)
    rows.push(['Attendance', 'Average attendance rate (30 days, %)', data.attendance.averageRate])
    rows.push(['Attendance', 'Late arrivals (30 days)', data.attendance.lateArrivals30d])
    add('Approved leave days by type (this year)', data.leave.approvedDaysByType)
    add('Leave requests by status (this year)', data.leave.byStatus)
    add('Documents by status', data.documents.byStatus)
    rows.push(['Documents', 'Average required-document completion (%)', data.documents.averageCompletion])
    add('Onboarding', data.onboarding.buckets)
    rows.push(['Onboarding', 'Average days to complete', data.onboarding.averageDaysToComplete])
    add('HR requests by category', data.requests.byCategory)
    rows.push(['HR requests', 'Average days to resolve', data.requests.averageResolutionDays])
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.EXPORT_GENERATED,
      resourceType: 'analytics',
      metadata: { kind: 'hr_analytics', rows: rows.length },
    })
    return {
      csv: toCsv(['Section', 'Metric', 'Value'], rows),
      fileName: `hr-analytics-${dayKey(todayIn(ctx.organization.timezone))}.csv`,
    }
  },
}

export type CalendarKind = 'JOINING' | 'ENDING' | 'LEAVE' | 'HOLIDAY' | 'ONBOARDING' | 'DOCUMENT' | 'REVIEW' | 'MEETING'

function todayKeyIn(instant: Date, timeZone: string) {
  return dayKey(todayIn(timeZone, instant))
}

export type HrOverview = Awaited<ReturnType<typeof hrDashboardService.overview>>
export type HrCalendar = Awaited<ReturnType<typeof hrDashboardService.calendar>>
export type HrAnalytics = Awaited<ReturnType<typeof hrDashboardService.analytics>>
