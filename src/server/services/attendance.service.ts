import type { AttendanceStatus, CorrectionCategory, Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import {
  breakTotal,
  computeStatus,
  leaveDaySet,
  resolveDay,
  summarize,
  type AttendanceRules,
} from '@/lib/hr/attendance'
import { toCsv } from '@/lib/hr/operations'
import { clockIn, dayKey, eachDay, formatMonth, instantAt, monthRange, parseMonth } from '@/lib/hr/time'
import { addDays, parseDateOnly, todayIn } from '@/lib/interns/dates'
import type { RequestMeta } from '@/lib/http/request-meta'
import { fullName } from '@/lib/utils/format'
import { isoDateSchema, parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import {
  forbidSelf,
  holidaySet,
  optionalText,
  personSelect,
  requireUserInScope,
  scopedUsers,
  trackedInterns,
} from './hr-shared'
import { skipTake, toPage } from './pagination'
import { settingsService } from './settings.service'

/**
 * Attendance: check-in/out with server timestamps, breaks, rule-based status,
 * corrections that keep the original values, HR overview and reports.
 * Absent and missing-check-out are derived only for days that have passed.
 */

export const CORRECTION_CATEGORIES: readonly CorrectionCategory[] = [
  'FORGOT_CHECK_IN',
  'FORGOT_CHECK_OUT',
  'WRONG_TIME',
  'SYSTEM_ISSUE',
  'OTHER',
]
export const CORRECTION_CATEGORY_LABELS: Record<CorrectionCategory, string> = {
  FORGOT_CHECK_IN: 'Forgot to check in',
  FORGOT_CHECK_OUT: 'Forgot to check out',
  WRONG_TIME: 'Wrong time recorded',
  SYSTEM_ISSUE: 'System issue',
  OTHER: 'Other',
}

/** How far back a correction may be requested. */
const CORRECTION_WINDOW_DAYS = 30

const clock = z
  .string()
  .optional()
  .transform((value) => value || undefined)
  .pipe(
    z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')
      .optional(),
  )

const correctionSchema = z
  .strictObject({
    date: isoDateSchema,
    category: z.enum(CORRECTION_CATEGORIES as [CorrectionCategory, ...CorrectionCategory[]]),
    checkIn: clock,
    checkOut: clock,
    reason: z.string().trim().min(3, 'Explain what happened (at least 3 characters)').max(1000),
  })
  .refine((value) => value.checkIn || value.checkOut, {
    message: 'Enter the check-in or check-out time to correct',
    path: ['checkIn'],
  })
  .refine((value) => !value.checkIn || !value.checkOut || value.checkOut > value.checkIn, {
    message: 'Check-out must be after check-in',
    path: ['checkOut'],
  })

const reviewSchema = z
  .strictObject({
    correctionId: z.uuid(),
    decision: z.enum(['APPROVED', 'REJECTED']),
    comment: optionalText(1000),
  })
  .refine((value) => value.decision === 'APPROVED' || value.comment, {
    message: 'Give a reason for rejecting',
    path: ['comment'],
  })

const MANUAL_STATUSES = ['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'ON_LEAVE', 'HOLIDAY'] as const
const hrUpdateSchema = z
  .strictObject({
    userId: z.uuid(),
    date: isoDateSchema,
    checkIn: clock,
    checkOut: clock,
    status: z
      .string()
      .optional()
      .transform((value) => value || undefined)
      .pipe(z.enum(MANUAL_STATUSES).optional()),
    reason: z.string().trim().min(3, 'A reason is required for manual changes').max(1000),
  })
  .refine((value) => value.checkIn || value.status, {
    message: 'Enter a check-in time or choose a status',
    path: ['checkIn'],
  })
  .refine((value) => !value.checkIn || !value.checkOut || value.checkOut > value.checkIn, {
    message: 'Check-out must be after check-in',
    path: ['checkOut'],
  })

export const attendanceQuerySchema = z.object({
  from: isoDateSchema.optional().catch(undefined),
  to: isoDateSchema.optional().catch(undefined),
  user: z.uuid().optional().catch(undefined),
  department: z.uuid().optional().catch(undefined),
  status: z
    .enum(['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'ON_LEAVE', 'HOLIDAY', 'WEEKEND', 'MISSING'])
    .optional()
    .catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
})

const recordSelect = {
  id: true,
  date: true,
  check_in_at: true,
  check_out_at: true,
  total_minutes: true,
  break_minutes: true,
  status: true,
  is_late: true,
  late_minutes: true,
  source: true,
  notes: true,
  breaks: { orderBy: { started_at: 'asc' }, select: { id: true, started_at: true, ended_at: true } },
} as const satisfies Prisma.AttendanceSelect

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
}

async function approvedLeave(organizationId: string, userId: string, from: Date, to: Date) {
  return prisma.leaveRequest.findMany({
    where: {
      organization_id: organizationId,
      user_id: userId,
      status: 'APPROVED',
      start_date: { lte: to },
      end_date: { gte: from },
    },
    select: { start_date: true, end_date: true, leave_type: { select: { name: true } } },
  })
}

/** Recomputes status/totals for a record from its times (used by check-out, corrections, HR edits). */
function statusFor(
  checkIn: Date,
  checkOut: Date | null,
  breakMinutes: number,
  rules: AttendanceRules,
  timeZone: string,
) {
  return computeStatus({ checkIn, checkOut, breakMinutes, rules, timeZone })
}

export const attendanceService = {
  /** The signed-in person's day: record, breaks, and what they can do now. */
  async today(ctx: RequestContext) {
    authorizationService.require(ctx, 'attendance.create')
    const tz = ctx.organization.timezone
    const today = todayIn(tz)
    const [record, rules, holiday, leave] = await Promise.all([
      prisma.attendance.findUnique({
        where: { user_id_date: { user_id: ctx.actor.userId, date: today } },
        select: recordSelect,
      }),
      settingsService.attendanceRules(ctx.organization.id),
      prisma.holiday.findFirst({
        where: { organization_id: ctx.organization.id, date: today },
        select: { name: true },
      }),
      approvedLeave(ctx.organization.id, ctx.actor.userId, today, today),
    ])
    const openBreak = record?.breaks.find((b) => !b.ended_at) ?? null
    const checkedIn = Boolean(record?.check_in_at)
    const checkedOut = Boolean(record?.check_out_at)
    return {
      date: today,
      record,
      rules,
      holiday: holiday?.name ?? null,
      onLeave: leave[0]?.leave_type.name ?? null,
      workingDay: rules.workingDays.includes(today.getUTCDay()),
      openBreak,
      can: {
        checkIn: !checkedIn && leave.length === 0,
        checkOut: checkedIn && !checkedOut,
        startBreak: checkedIn && !checkedOut && !openBreak,
        endBreak: Boolean(openBreak) && !checkedOut,
      },
    }
  },

  async checkIn(ctx: RequestContext, meta?: RequestMeta) {
    authorizationService.require(ctx, 'attendance.create')
    const tz = ctx.organization.timezone
    const now = new Date()
    const today = todayIn(tz, now)
    const [rules, leave] = await Promise.all([
      settingsService.attendanceRules(ctx.organization.id),
      approvedLeave(ctx.organization.id, ctx.actor.userId, today, today),
    ])
    if (leave.length) throw new ValidationError('You’re on approved leave today. Cancel the leave to check in.')
    const computed = statusFor(now, null, 0, rules, tz)
    let id: string
    try {
      id = (
        await prisma.attendance.create({
          data: {
            organization_id: ctx.organization.id,
            user_id: ctx.actor.userId,
            date: today,
            check_in_at: now,
            status: computed.status,
            is_late: computed.isLate,
            late_minutes: computed.lateMinutes,
            source: 'SELF',
          },
          select: { id: true },
        })
      ).id
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('You’ve already checked in today')
      throw error
    }
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.ATTENDANCE_CHECKED_IN,
      resourceType: 'attendance',
      resourceId: id,
      metadata: { date: dayKey(today), late: computed.isLate, lateMinutes: computed.lateMinutes },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    })
    return { late: computed.isLate, lateMinutes: computed.lateMinutes }
  },

  async checkOut(ctx: RequestContext, meta?: RequestMeta) {
    authorizationService.require(ctx, 'attendance.create')
    const tz = ctx.organization.timezone
    const now = new Date()
    const today = todayIn(tz, now)
    const record = await prisma.attendance.findUnique({
      where: { user_id_date: { user_id: ctx.actor.userId, date: today } },
      select: recordSelect,
    })
    if (!record?.check_in_at) throw new ValidationError('Check in first')
    if (record.check_out_at) throw new ConflictError('You’ve already checked out today')
    const rules = await settingsService.attendanceRules(ctx.organization.id)
    const breaks = record.breaks.map((b) => ({ ...b, ended_at: b.ended_at ?? now }))
    const breakMinutes = breakTotal(breaks, now)
    const computed = statusFor(record.check_in_at, now, breakMinutes, rules, tz)
    const updated = await prisma.$transaction(async (tx) => {
      await tx.attendanceBreak.updateMany({
        where: { attendance_id: record.id, ended_at: null },
        data: { ended_at: now },
      })
      // Guarded update: a concurrent check-out can't overwrite this one.
      return tx.attendance.updateMany({
        where: { id: record.id, check_out_at: null },
        data: {
          check_out_at: now,
          break_minutes: breakMinutes,
          total_minutes: computed.totalMinutes,
          status: computed.status,
        },
      })
    })
    if (updated.count === 0) throw new ConflictError('You’ve already checked out today')
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.ATTENDANCE_CHECKED_OUT,
      resourceType: 'attendance',
      resourceId: record.id,
      metadata: { date: dayKey(today), status: computed.status, minutes: computed.totalMinutes },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    })
    return { status: computed.status, totalMinutes: computed.totalMinutes }
  },

  async startBreak(ctx: RequestContext) {
    authorizationService.require(ctx, 'attendance.create')
    const today = todayIn(ctx.organization.timezone)
    const record = await prisma.attendance.findUnique({
      where: { user_id_date: { user_id: ctx.actor.userId, date: today } },
      select: { id: true, check_in_at: true, check_out_at: true },
    })
    if (!record?.check_in_at || record.check_out_at)
      throw new ValidationError('Breaks are only possible while checked in')
    try {
      await prisma.attendanceBreak.create({ data: { attendance_id: record.id, started_at: new Date() } })
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('A break is already running')
      throw error
    }
  },

  async endBreak(ctx: RequestContext) {
    authorizationService.require(ctx, 'attendance.create')
    const today = todayIn(ctx.organization.timezone)
    const record = await prisma.attendance.findUnique({
      where: { user_id_date: { user_id: ctx.actor.userId, date: today } },
      select: { id: true, breaks: { select: { started_at: true, ended_at: true } } },
    })
    const now = new Date()
    const open = await prisma.attendanceBreak.updateMany({
      where: { attendance_id: record?.id ?? '00000000-0000-0000-0000-000000000000', ended_at: null },
      data: { ended_at: now },
    })
    if (!record || open.count === 0) throw new ValidationError('No break is running')
    // Guarded: a check-out that raced ahead has already closed the break and fixed the totals.
    await prisma.attendance.updateMany({
      where: { id: record.id, check_out_at: null },
      data: { break_minutes: breakTotal(record.breaks, now) },
    })
  },

  /**
   * A month of attendance for one person (self, or someone within the
   * viewer's attendance.read scope): per-day status, summary and corrections.
   */
  async month(ctx: RequestContext, input: { userId?: string; month?: string }) {
    const tz = ctx.organization.timezone
    const today = todayIn(tz)
    let userId = ctx.actor.userId
    let personName = ctx.actor.displayName
    let intern: { joining_date: Date | null; actual_end_date: Date | null; expected_end_date: Date | null } | null
    if (input.userId && input.userId !== ctx.actor.userId) {
      const { user } = await requireUserInScope(ctx, 'attendance.read', input.userId)
      userId = user.id
      personName = fullName(user)
      intern = user.intern
    } else {
      authorizationService.require(ctx, 'attendance.read')
      intern = await prisma.intern.findFirst({
        where: { user_id: userId, organization_id: ctx.organization.id },
        select: { joining_date: true, actual_end_date: true, expected_end_date: true },
      })
    }
    const month = parseMonth(input.month) ?? parseMonth(formatMonth(today))!
    const [start, end] = monthRange(month)
    const [records, rules, holidays, leave, corrections] = await Promise.all([
      prisma.attendance.findMany({
        where: { user_id: userId, organization_id: ctx.organization.id, date: { gte: start, lte: end } },
        select: recordSelect,
      }),
      settingsService.attendanceRules(ctx.organization.id),
      prisma.holiday.findMany({
        where: { organization_id: ctx.organization.id, date: { gte: start, lte: end } },
        select: { date: true, name: true },
      }),
      approvedLeave(ctx.organization.id, userId, start, end),
      prisma.attendanceCorrection.findMany({
        where: { user_id: userId, organization_id: ctx.organization.id, date: { gte: addDays(start, -31) } },
        orderBy: { created_at: 'desc' },
        take: 20,
        select: correctionSelect,
      }),
    ])
    const byDate = new Map(records.map((r) => [dayKey(r.date), r]))
    const holidayNames = new Map(holidays.map((h) => [dayKey(h.date), h.name]))
    const leaveDays = leaveDaySet(leave)
    const trackedTo = intern?.actual_end_date ?? intern?.expected_end_date ?? null
    const days = eachDay(start, end).map((date) => {
      const key = dayKey(date)
      const record = byDate.get(key) ?? null
      const status = resolveDay({
        date,
        today,
        record,
        onLeave: leaveDays.has(key),
        holiday: holidayNames.has(key),
        rules,
        trackedFrom: intern?.joining_date ?? null,
        trackedTo,
      })
      return {
        date,
        key,
        status,
        isToday: key === dayKey(today),
        holiday: holidayNames.get(key) ?? null,
        record: record
          ? {
              id: record.id,
              checkIn: record.check_in_at,
              checkOut: record.check_out_at,
              totalMinutes: record.total_minutes,
              breakMinutes: record.break_minutes,
              lateMinutes: record.late_minutes,
              source: record.source,
            }
          : null,
        totalMinutes: record?.total_minutes ?? null,
      }
    })
    return {
      userId,
      personName,
      month,
      today,
      days,
      summary: summarize(days),
      corrections: corrections.map((c) => toCorrectionView(c, tz)),
      rules,
    }
  },

  // ── Corrections ─────────────────────────────────────────────────────────

  async requestCorrection(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'attendance_correction.request')
    const data = parseInput(correctionSchema, input)
    const tz = ctx.organization.timezone
    const today = todayIn(tz)
    const date = parseDateOnly(data.date)
    if (date > today) throw new ValidationError('You can’t correct a future day', { date: 'Choose today or earlier' })
    if (date < addDays(today, -CORRECTION_WINDOW_DAYS)) {
      throw new ValidationError(`Corrections are possible for the last ${CORRECTION_WINDOW_DAYS} days`, {
        date: 'Too far in the past',
      })
    }
    const [record, pending] = await Promise.all([
      prisma.attendance.findUnique({
        where: { user_id_date: { user_id: ctx.actor.userId, date } },
        select: { id: true, check_in_at: true, check_out_at: true },
      }),
      prisma.attendanceCorrection.count({ where: { user_id: ctx.actor.userId, date, status: 'PENDING' } }),
    ])
    if (pending) throw new ConflictError('There’s already a pending correction for that day')
    const requestedIn = data.checkIn ? instantAt(date, data.checkIn, tz) : null
    const requestedOut = data.checkOut ? instantAt(date, data.checkOut, tz) : null
    const effectiveIn = requestedIn ?? record?.check_in_at ?? null
    const effectiveOut = requestedOut ?? record?.check_out_at ?? null
    if (!effectiveIn) {
      throw new ValidationError('There’s no check-in for that day — include the check-in time', {
        checkIn: 'Required for this day',
      })
    }
    if (effectiveOut && effectiveOut <= effectiveIn) {
      throw new ValidationError('Check-out must be after check-in', { checkOut: 'Must be after check-in' })
    }
    const correction = await prisma.attendanceCorrection.create({
      data: {
        organization_id: ctx.organization.id,
        user_id: ctx.actor.userId,
        date,
        attendance_id: record?.id ?? null,
        category: data.category,
        requested_by: ctx.actor.userId,
        reason: data.reason,
        requested_check_in: requestedIn,
        requested_check_out: requestedOut,
        original_check_in: record?.check_in_at ?? null,
        original_check_out: record?.check_out_at ?? null,
      },
      select: { id: true },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.ATTENDANCE_CORRECTION_REQUESTED,
      resourceType: 'attendance_correction',
      resourceId: correction.id,
      metadata: {
        date: data.date,
        category: data.category,
        original: { checkIn: record?.check_in_at ?? null, checkOut: record?.check_out_at ?? null },
        requested: { checkIn: requestedIn, checkOut: requestedOut },
      },
    })
    await domainEvents.emit('attendance.correction_requested', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { correctionId: correction.id, userId: ctx.actor.userId, date: data.date },
    })
    return correction
  },

  async cancelCorrection(ctx: RequestContext, correctionId: string) {
    const id = parseInput(z.uuid(), correctionId)
    const { count } = await prisma.attendanceCorrection.updateMany({
      where: { id, requested_by: ctx.actor.userId, organization_id: ctx.organization.id, status: 'PENDING' },
      data: { status: 'REJECTED', review_comment: 'Withdrawn by the requester', reviewed_at: new Date() },
    })
    if (!count) throw new NotFoundError('Correction')
  },

  /** Approve (applies the requested times, keeping the originals on the correction) or reject. */
  async reviewCorrection(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'attendance_correction.review')
    const data = parseInput(reviewSchema, input)
    const where = scopedUsers(ctx, 'attendance_correction.review')!
    const correction = await prisma.attendanceCorrection.findFirst({
      where: { id: data.correctionId, organization_id: ctx.organization.id, user: where },
      select: {
        id: true,
        user_id: true,
        requested_by: true,
        date: true,
        status: true,
        requested_check_in: true,
        requested_check_out: true,
      },
    })
    if (!correction) throw new NotFoundError('Correction')
    forbidSelf(ctx, correction.user_id, 'review')
    if (correction.requested_by === ctx.actor.userId)
      throw new ForbiddenError('You can’t review a correction you raised')
    if (correction.status !== 'PENDING') throw new ConflictError('This correction has already been decided')

    const tz = ctx.organization.timezone
    let before: unknown = null
    let after: unknown = null
    if (data.decision === 'APPROVED') {
      const rules = await settingsService.attendanceRules(ctx.organization.id)
      await prisma.$transaction(async (tx) => {
        const existing = await tx.attendance.findUnique({
          where: { user_id_date: { user_id: correction.user_id, date: correction.date } },
          select: { id: true, check_in_at: true, check_out_at: true, break_minutes: true, status: true },
        })
        const checkIn = correction.requested_check_in ?? existing?.check_in_at ?? null
        const checkOut = correction.requested_check_out ?? existing?.check_out_at ?? null
        if (!checkIn) throw new ValidationError('The corrected day has no check-in time')
        if (checkOut && checkOut <= checkIn) throw new ValidationError('Check-out must be after check-in')
        const computed = statusFor(checkIn, checkOut, existing?.break_minutes ?? 0, rules, tz)
        before = existing
          ? { checkIn: existing.check_in_at, checkOut: existing.check_out_at, status: existing.status }
          : null
        after = { checkIn, checkOut, status: computed.status }
        const values = {
          check_in_at: checkIn,
          check_out_at: checkOut,
          total_minutes: computed.totalMinutes,
          status: computed.status,
          is_late: computed.isLate,
          late_minutes: computed.lateMinutes,
          source: 'CORRECTION',
          updated_by: ctx.actor.userId,
        }
        const record = existing
          ? await tx.attendance.update({ where: { id: existing.id }, data: values, select: { id: true } })
          : await tx.attendance.create({
              data: {
                ...values,
                organization_id: ctx.organization.id,
                user_id: correction.user_id,
                date: correction.date,
              },
              select: { id: true },
            })
        const decided = await tx.attendanceCorrection.updateMany({
          where: { id: correction.id, status: 'PENDING' },
          data: {
            status: 'APPROVED',
            attendance_id: record.id,
            reviewed_by: ctx.actor.userId,
            reviewed_at: new Date(),
            review_comment: data.comment ?? null,
          },
        })
        if (!decided.count) throw new ConflictError('This correction has already been decided')
      })
    } else {
      const decided = await prisma.attendanceCorrection.updateMany({
        where: { id: correction.id, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          reviewed_by: ctx.actor.userId,
          reviewed_at: new Date(),
          review_comment: data.comment ?? null,
        },
      })
      if (!decided.count) throw new ConflictError('This correction has already been decided')
    }

    await auditService.logForContext(ctx, {
      action:
        data.decision === 'APPROVED'
          ? AUDIT_ACTIONS.ATTENDANCE_CORRECTION_APPROVED
          : AUDIT_ACTIONS.ATTENDANCE_CORRECTION_REJECTED,
      resourceType: 'attendance_correction',
      resourceId: correction.id,
      metadata: { userId: correction.user_id, date: dayKey(correction.date), before, after, reason: data.comment },
    })
    await domainEvents.emit('attendance.correction_reviewed', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: {
        correctionId: correction.id,
        userId: correction.user_id,
        date: dayKey(correction.date),
        decision: data.decision,
      },
    })
  },

  /** Pending corrections the viewer may review (never their own). */
  async pendingCorrections(ctx: RequestContext, take = 50) {
    const where = scopedUsers(ctx, 'attendance_correction.review')
    if (!where) return []
    const rows = await prisma.attendanceCorrection.findMany({
      where: {
        organization_id: ctx.organization.id,
        status: 'PENDING',
        user: where,
        user_id: { not: ctx.actor.userId },
      },
      orderBy: { created_at: 'asc' },
      take,
      select: correctionSelect,
    })
    return rows.map((row) => toCorrectionView(row, ctx.organization.timezone))
  },

  // ── HR ──────────────────────────────────────────────────────────────────

  /** Today across the interns in scope: who is in, late, on break, on leave or not checked in yet. */
  async overview(ctx: RequestContext, dateInput?: string) {
    const where = scopedUsers(ctx, 'attendance.read')
    if (!where) throw new ForbiddenError()
    const tz = ctx.organization.timezone
    const today = todayIn(tz)
    const date = dateInput && isoDateSchema.safeParse(dateInput).success ? parseDateOnly(dateInput) : today
    const interns = (await trackedInterns(ctx.organization.id, where)).filter(
      (i) => !i.joining_date || i.joining_date <= date,
    )
    const userIds = interns.map((i) => i.user_id)
    const [records, leave, rules, holiday] = await Promise.all([
      prisma.attendance.findMany({
        where: { organization_id: ctx.organization.id, date, user_id: { in: userIds } },
        select: { ...recordSelect, user_id: true },
      }),
      prisma.leaveRequest.findMany({
        where: {
          organization_id: ctx.organization.id,
          status: 'APPROVED',
          user_id: { in: userIds },
          start_date: { lte: date },
          end_date: { gte: date },
        },
        select: { user_id: true, leave_type: { select: { name: true } } },
      }),
      settingsService.attendanceRules(ctx.organization.id),
      prisma.holiday.findFirst({ where: { organization_id: ctx.organization.id, date }, select: { name: true } }),
    ])
    const recordFor = new Map(records.map((r) => [r.user_id, r]))
    const leaveFor = new Map(leave.map((l) => [l.user_id, l.leave_type.name]))
    const rows = interns.map((intern) => {
      const record = recordFor.get(intern.user_id) ?? null
      const status = resolveDay({
        date,
        today,
        record,
        onLeave: leaveFor.has(intern.user_id),
        holiday: Boolean(holiday),
        rules,
        trackedFrom: intern.joining_date,
      })
      const onBreak = Boolean(record?.breaks.some((b) => !b.ended_at)) && !record?.check_out_at
      const state = !record
        ? status === null
          ? 'NOT_CHECKED_IN'
          : status
        : record.check_out_at
          ? 'CHECKED_OUT'
          : onBreak
            ? 'ON_BREAK'
            : date < today
              ? 'MISSING'
              : 'WORKING'
      return {
        intern: { id: intern.id, code: intern.employee_code, department: intern.department?.name ?? null },
        user: intern.user,
        name: fullName(intern.user),
        status,
        state,
        leaveType: leaveFor.get(intern.user_id) ?? null,
        checkIn: record?.check_in_at ?? null,
        checkOut: record?.check_out_at ?? null,
        lateMinutes: record?.late_minutes ?? null,
        totalMinutes: record?.total_minutes ?? null,
      }
    })
    const count = (predicate: (row: (typeof rows)[number]) => boolean) => rows.filter(predicate).length
    return {
      date,
      isToday: date.getTime() === today.getTime(),
      holiday: holiday?.name ?? null,
      workingDay: rules.workingDays.includes(date.getUTCDay()),
      rows,
      stats: {
        expected: count((r) => !['ON_LEAVE', 'HOLIDAY', 'WEEKEND'].includes(r.status ?? '')),
        checkedIn: count((r) => Boolean(r.checkIn)),
        late: count((r) => r.status === 'LATE' || (r.lateMinutes ?? 0) > 0),
        onLeave: count((r) => r.status === 'ON_LEAVE'),
        notCheckedIn: count((r) => r.state === 'NOT_CHECKED_IN' || r.state === 'ABSENT'),
        onBreak: count((r) => r.state === 'ON_BREAK'),
      },
    }
  },

  /** Attendance records in scope with filters (paginated, newest first). */
  async records(ctx: RequestContext, rawQuery: unknown) {
    const where = scopedUsers(ctx, 'attendance.read')
    if (!where) throw new ForbiddenError()
    const query = attendanceQuerySchema.parse(rawQuery ?? {})
    const filter = recordFilter(ctx, where, query)
    const pagination = { page: query.page, pageSize: 25 }
    const [rows, total] = await Promise.all([
      prisma.attendance.findMany({
        where: filter,
        orderBy: [{ date: 'desc' }, { check_in_at: 'desc' }],
        ...skipTake(pagination),
        select: { ...recordSelect, user: { select: personSelect } },
      }),
      prisma.attendance.count({ where: filter }),
    ])
    const today = todayIn(ctx.organization.timezone)
    return {
      query,
      page: toPage(
        rows.map((row) => ({
          ...row,
          effectiveStatus: (row.check_in_at && !row.check_out_at && row.date < today
            ? 'MISSING'
            : row.status) as AttendanceStatus,
        })),
        total,
        pagination,
      ),
    }
  },

  /** HR manual edit (attendance.update) — requires a reason; before/after are audited. */
  async hrUpdate(ctx: RequestContext, input: unknown) {
    const data = parseInput(hrUpdateSchema, input)
    await requireUserInScope(ctx, 'attendance.update', data.userId)
    forbidSelf(ctx, data.userId, 'edit attendance for')
    const tz = ctx.organization.timezone
    const date = parseDateOnly(data.date)
    if (date > todayIn(tz)) throw new ValidationError('You can’t record attendance for a future day')
    const rules = await settingsService.attendanceRules(ctx.organization.id)
    const existing = await prisma.attendance.findUnique({
      where: { user_id_date: { user_id: data.userId, date } },
      select: { id: true, check_in_at: true, check_out_at: true, status: true, break_minutes: true },
    })
    const checkIn = data.checkIn ? instantAt(date, data.checkIn, tz) : null
    const checkOut = data.checkOut ? instantAt(date, data.checkOut, tz) : null
    const computed = checkIn ? statusFor(checkIn, checkOut, existing?.break_minutes ?? 0, rules, tz) : null
    const values = {
      check_in_at: checkIn,
      check_out_at: checkIn ? checkOut : null,
      total_minutes: computed?.totalMinutes ?? null,
      status: (data.status ?? computed?.status ?? 'ABSENT') as AttendanceStatus,
      is_late: computed?.isLate ?? false,
      late_minutes: computed?.lateMinutes ?? null,
      source: 'HR',
      updated_by: ctx.actor.userId,
      notes: data.reason,
    }
    const record = existing
      ? await prisma.attendance.update({ where: { id: existing.id }, data: values, select: { id: true } })
      : await prisma.attendance.create({
          data: { ...values, organization_id: ctx.organization.id, user_id: data.userId, date },
          select: { id: true },
        })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.ATTENDANCE_UPDATED,
      resourceType: 'attendance',
      resourceId: record.id,
      metadata: {
        userId: data.userId,
        date: data.date,
        before: existing
          ? { checkIn: existing.check_in_at, checkOut: existing.check_out_at, status: existing.status }
          : null,
        after: { checkIn: values.check_in_at, checkOut: values.check_out_at, status: values.status },
        reason: data.reason,
      },
    })
  },

  /** People whose attendance the viewer may edit (for the HR edit dialog). */
  async editablePeople(ctx: RequestContext) {
    const where = scopedUsers(ctx, 'attendance.update')
    if (!where) return []
    const rows = await trackedInterns(ctx.organization.id, where)
    return rows.filter((r) => r.user_id !== ctx.actor.userId).map((r) => ({ id: r.user_id, name: fullName(r.user) }))
  },

  /** Counts for the HR action centre. */
  async issues(ctx: RequestContext) {
    const where = scopedUsers(ctx, 'attendance.read')
    if (!where) return null
    const today = todayIn(ctx.organization.timezone)
    const [missing, pendingCorrections] = await Promise.all([
      prisma.attendance.count({
        where: {
          organization_id: ctx.organization.id,
          user: where,
          check_in_at: { not: null },
          check_out_at: null,
          date: { lt: today, gte: addDays(today, -30) },
        },
      }),
      scopedUsers(ctx, 'attendance_correction.review')
        ? prisma.attendanceCorrection.count({
            where: {
              organization_id: ctx.organization.id,
              status: 'PENDING',
              user: scopedUsers(ctx, 'attendance_correction.review')!,
              user_id: { not: ctx.actor.userId },
            },
          })
        : Promise.resolve(0),
    ])
    return { missing, pendingCorrections }
  },

  /** CSV of attendance records (attendance.export), audited. */
  async exportCsv(ctx: RequestContext, rawQuery: unknown) {
    authorizationService.require(ctx, 'attendance.export')
    const where = scopedUsers(ctx, 'attendance.export')!
    const query = attendanceQuerySchema.parse(rawQuery ?? {})
    const today = todayIn(ctx.organization.timezone)
    const effective = {
      ...query,
      from: query.from ?? dayKey(addDays(today, -30)),
      to: query.to ?? dayKey(today),
    }
    const rows = await prisma.attendance.findMany({
      where: recordFilter(ctx, where, effective),
      orderBy: [{ date: 'asc' }],
      take: 10_000,
      select: {
        ...recordSelect,
        user: { select: { ...personSelect, email: true, intern: { select: { employee_code: true } } } },
      },
    })
    const tz = ctx.organization.timezone
    const csv = toCsv(
      [
        'Date',
        'Employee code',
        'Name',
        'Email',
        'Status',
        'Check in',
        'Check out',
        'Break minutes',
        'Worked minutes',
        'Late minutes',
        'Source',
      ],
      rows.map((r) => [
        dayKey(r.date),
        r.user.intern?.employee_code ?? '',
        fullName(r.user),
        r.user.email,
        r.check_in_at && !r.check_out_at && r.date < today ? 'MISSING' : r.status,
        r.check_in_at ? clockIn(r.check_in_at, tz) : '',
        r.check_out_at ? clockIn(r.check_out_at, tz) : '',
        r.break_minutes,
        r.total_minutes ?? '',
        r.late_minutes ?? '',
        r.source,
      ]),
    )
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.EXPORT_GENERATED,
      resourceType: 'attendance',
      metadata: { kind: 'attendance', rows: rows.length, from: effective.from, to: effective.to },
    })
    return { csv, fileName: `attendance-${effective.from}-to-${effective.to}.csv` }
  },
}

/**
 * Attendance rate over the last `days` days per user (null when no working
 * day was due yet) — same day rules as the calendar, computed in batch.
 */
export async function attendanceRates(
  organizationId: string,
  timeZone: string,
  people: readonly { userId: string; joiningDate: Date | null }[],
  days = 30,
): Promise<Map<string, number | null>> {
  const rates = new Map<string, number | null>()
  if (people.length === 0) return rates
  const today = todayIn(timeZone)
  const from = addDays(today, -days)
  const to = addDays(today, -1)
  const userIds = people.map((p) => p.userId)
  const [records, leave, holidays, rules] = await Promise.all([
    prisma.attendance.findMany({
      where: { organization_id: organizationId, user_id: { in: userIds }, date: { gte: from, lte: to } },
      select: { user_id: true, date: true, status: true, check_in_at: true, check_out_at: true },
    }),
    prisma.leaveRequest.findMany({
      where: {
        organization_id: organizationId,
        user_id: { in: userIds },
        status: 'APPROVED',
        start_date: { lte: to },
        end_date: { gte: from },
      },
      select: { user_id: true, start_date: true, end_date: true },
    }),
    holidaySet(organizationId, from, to),
    settingsService.attendanceRules(organizationId),
  ])
  for (const person of people) {
    const mine = new Map(records.filter((r) => r.user_id === person.userId).map((r) => [dayKey(r.date), r]))
    const leaveDays = leaveDaySet(leave.filter((l) => l.user_id === person.userId))
    const resolved = eachDay(from, to).map((date) => ({
      date,
      status: resolveDay({
        date,
        today,
        record: mine.get(dayKey(date)) ?? null,
        onLeave: leaveDays.has(dayKey(date)),
        holiday: holidays.has(dayKey(date)),
        rules,
        trackedFrom: person.joiningDate,
      }),
    }))
    rates.set(person.userId, summarize(resolved).attendanceRate)
  }
  return rates
}

function recordFilter(
  ctx: RequestContext,
  where: Prisma.UserWhereInput,
  query: Pick<z.infer<typeof attendanceQuerySchema>, 'from' | 'to' | 'user' | 'department' | 'status'>,
): Prisma.AttendanceWhereInput {
  const today = todayIn(ctx.organization.timezone)
  const status: Prisma.AttendanceWhereInput =
    query.status === 'MISSING'
      ? { check_in_at: { not: null }, check_out_at: null, date: { lt: today } }
      : query.status
        ? { status: query.status }
        : {}
  return {
    organization_id: ctx.organization.id,
    user: {
      AND: [
        where,
        query.department ? { intern: { is: { department_id: query.department } } } : {},
        query.user ? { id: query.user } : {},
      ],
    },
    date: {
      ...(query.from ? { gte: parseDateOnly(query.from) } : {}),
      ...(query.to ? { lte: parseDateOnly(query.to) } : {}),
    },
    AND: [status],
  }
}

const correctionSelect = {
  id: true,
  date: true,
  category: true,
  reason: true,
  status: true,
  requested_check_in: true,
  requested_check_out: true,
  original_check_in: true,
  original_check_out: true,
  review_comment: true,
  reviewed_at: true,
  created_at: true,
  requested_by: true,
  user: { select: personSelect },
  reviewer: { select: personSelect },
} as const satisfies Prisma.AttendanceCorrectionSelect

type CorrectionRow = Prisma.AttendanceCorrectionGetPayload<{ select: typeof correctionSelect }>

function toCorrectionView(row: CorrectionRow, tz: string) {
  const clockOf = (value: Date | null) => (value ? clockIn(value, tz) : null)
  return {
    id: row.id,
    date: row.date,
    category: row.category,
    reason: row.reason,
    status: row.status,
    requestedCheckIn: clockOf(row.requested_check_in),
    requestedCheckOut: clockOf(row.requested_check_out),
    originalCheckIn: clockOf(row.original_check_in),
    originalCheckOut: clockOf(row.original_check_out),
    reviewComment: row.review_comment,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    requestedBy: row.requested_by,
    user: row.user,
    userName: fullName(row.user),
    reviewer: row.reviewer ? fullName(row.reviewer) : null,
  }
}

export type CorrectionView = ReturnType<typeof toCorrectionView>
export type AttendanceMonth = Awaited<ReturnType<typeof attendanceService.month>>
