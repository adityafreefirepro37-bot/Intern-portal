import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { addDays, formatDateOnly, parseDateOnly, todayIn } from '@/lib/interns/dates'
import { canEditCheckin, CHECKIN_QUESTIONS, weekStart } from '@/lib/performance/rules'
import { isoDateSchema, parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { optionalText, optionalUuid, personSelect, TRACKED_STATUSES } from './hr-shared'
import { covers, internPlacementSelect, ownIntern, relation, scopedInternWhere } from './performance-access'

/**
 * Weekly check-ins: the intern answers six questions for a week (Monday
 * start), saves drafts, submits; their manager or mentor reviews with a
 * comment. Submitted check-ins are part of the record and aren't edited.
 */

const answer = optionalText(4000)

const saveSchema = z.strictObject({
  weekStart: isoDateSchema,
  accomplishments: answer,
  current_work: answer,
  learning: answer,
  blockers: answer,
  support_needed: answer,
  next_week_priorities: answer,
  submit: z.boolean().default(false),
})

const reviewSchema = z.strictObject({
  checkinId: z.uuid(),
  comment: z.string().trim().min(1, 'Add a comment for the intern').max(4000),
})

export const checkinFilterSchema = z.object({
  status: z
    .enum(['DRAFT', 'SUBMITTED', 'REVIEWED', ''])
    .optional()
    .transform((v) => v || undefined),
  internId: optionalUuid,
  week: z
    .string()
    .optional()
    .transform((v) => v || undefined)
    .pipe(isoDateSchema.optional()),
})

const checkinSelect = {
  id: true,
  week_start: true,
  status: true,
  accomplishments: true,
  current_work: true,
  learning: true,
  blockers: true,
  support_needed: true,
  next_week_priorities: true,
  submitted_at: true,
  reviewed_at: true,
  review_comment: true,
  updated_at: true,
  reviewer: { select: personSelect },
  intern: { select: internPlacementSelect },
} as const satisfies Prisma.WeeklyCheckinSelect

/** Interns may write this week's check-in or catch up on last week's. */
function allowedWeeks(today: Date) {
  const current = weekStart(today)
  return [formatDateOnly(current), formatDateOnly(addDays(current, -7))]
}

export const checkinService = {
  /** The intern's check-in page: this week (draft or submitted) plus history. */
  async mine(ctx: RequestContext) {
    authorizationService.require(ctx, 'checkin.create')
    const intern = await ownIntern(ctx)
    if (!intern) throw new NotFoundError('Intern profile')
    const today = todayIn(ctx.organization.timezone)
    const current = weekStart(today)
    const rows = await prisma.weeklyCheckin.findMany({
      where: { intern_id: intern.id },
      orderBy: { week_start: 'desc' },
      take: 26,
      select: checkinSelect,
    })
    const thisWeek = rows.find((r) => r.week_start.getTime() === current.getTime()) ?? null
    const lastWeekStart = addDays(current, -7)
    const lastWeek = rows.find((r) => r.week_start.getTime() === lastWeekStart.getTime()) ?? null
    return {
      weekStart: current,
      thisWeek,
      // Offer last week only if it was never submitted.
      catchUpWeek: !lastWeek || lastWeek.status === 'DRAFT' ? lastWeekStart : null,
      lastWeekDraft: lastWeek?.status === 'DRAFT' ? lastWeek : null,
      history: rows.filter((r) => r.status !== 'DRAFT'),
    }
  },

  /** Save a draft or submit (the intern's own check-in only). */
  async save(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'checkin.create')
    const data = parseInput(saveSchema, input)
    const intern = await ownIntern(ctx)
    if (!intern) throw new ForbiddenError('Only interns write weekly check-ins')
    const today = todayIn(ctx.organization.timezone)
    if (!allowedWeeks(today).includes(data.weekStart)) {
      throw new ValidationError('Check-ins are for this week or last week')
    }
    const week = parseDateOnly(data.weekStart)
    if (week.getTime() !== weekStart(week).getTime()) throw new ValidationError('A week starts on Monday')
    const values = Object.fromEntries(CHECKIN_QUESTIONS.map((q) => [q.key, data[q.key] ?? null])) as Record<
      (typeof CHECKIN_QUESTIONS)[number]['key'],
      string | null
    >
    if (data.submit && !values.accomplishments && !values.current_work) {
      throw new ValidationError('Describe what you accomplished or are working on', { accomplishments: 'Required' })
    }
    const existing = await prisma.weeklyCheckin.findUnique({
      where: { intern_id_week_start: { intern_id: intern.id, week_start: week } },
      select: { id: true, status: true },
    })
    if (existing && !canEditCheckin(existing.status)) throw new ConflictError('This check-in was already submitted')
    const now = new Date()
    const status = data.submit ? ('SUBMITTED' as const) : ('DRAFT' as const)
    let id: string
    if (existing) {
      // Guarded: a concurrent submit can't be overwritten by a late draft save.
      const { count } = await prisma.weeklyCheckin.updateMany({
        where: { id: existing.id, status: 'DRAFT' },
        data: { ...values, status, submitted_at: data.submit ? now : null },
      })
      if (!count) throw new ConflictError('This check-in was already submitted')
      id = existing.id
    } else {
      id = (
        await prisma.weeklyCheckin.create({
          data: {
            ...values,
            organization_id: ctx.organization.id,
            intern_id: intern.id,
            week_start: week,
            status,
            submitted_at: data.submit ? now : null,
          },
          select: { id: true },
        })
      ).id
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.CHECKIN_CREATED,
        resourceType: 'checkin',
        resourceId: id,
        metadata: { weekStart: data.weekStart },
      })
    }
    if (data.submit) {
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.CHECKIN_SUBMITTED,
        resourceType: 'checkin',
        resourceId: id,
        metadata: { weekStart: data.weekStart },
      })
    }
    return { id, status }
  },

  async get(ctx: RequestContext, checkinId: string) {
    const row = await prisma.weeklyCheckin.findFirst({
      where: { id: parseInput(z.uuid(), checkinId), organization_id: ctx.organization.id },
      select: checkinSelect,
    })
    if (!row || !covers(ctx, 'checkin.read', row.intern)) throw new NotFoundError('Check-in')
    const rel = relation(ctx, row.intern)
    // Drafts are private to the intern.
    if (row.status === 'DRAFT' && !rel.isSelf) throw new NotFoundError('Check-in')
    return {
      checkin: row,
      relation: rel,
      can: {
        edit: rel.isSelf && canEditCheckin(row.status),
        review: !rel.isSelf && row.status === 'SUBMITTED' && covers(ctx, 'checkin.review', row.intern),
      },
    }
  },

  /** Reviewer list: submitted / reviewed check-ins of interns in checkin.read scope (drafts never listed). */
  async list(ctx: RequestContext, query: unknown = {}) {
    const where = scopedInternWhere(ctx, 'checkin.read')
    if (!where) throw new ForbiddenError()
    const filters = parseInput(checkinFilterSchema, query)
    const rows = await prisma.weeklyCheckin.findMany({
      where: {
        organization_id: ctx.organization.id,
        intern: { AND: [where, { user_id: { not: ctx.actor.userId } }] },
        status: filters.status && filters.status !== 'DRAFT' ? filters.status : { not: 'DRAFT' },
        ...(filters.internId ? { intern_id: filters.internId } : {}),
        ...(filters.week ? { week_start: weekStart(parseDateOnly(filters.week)) } : {}),
      },
      orderBy: [{ status: 'asc' }, { week_start: 'desc' }],
      take: 200,
      select: {
        id: true,
        week_start: true,
        status: true,
        submitted_at: true,
        reviewed_at: true,
        blockers: true,
        support_needed: true,
        intern: { select: { id: true, user: { select: personSelect } } },
      },
    })
    return { filters, checkins: rows, can: { review: authorizationService.can(ctx, 'checkin.review') } }
  },

  /** This week's submission status for each tracked intern in scope (who hasn't checked in yet). */
  async weekStatus(ctx: RequestContext) {
    const where = scopedInternWhere(ctx, 'checkin.read')
    if (!where) return null
    const week = weekStart(todayIn(ctx.organization.timezone))
    const interns = await prisma.intern.findMany({
      where: { AND: [where, { status: { in: TRACKED_STATUSES }, user_id: { not: ctx.actor.userId } }] },
      select: { id: true, weekly_checkins: { where: { week_start: week }, select: { id: true, status: true } } },
    })
    const status = (s: string) => interns.filter((i) => i.weekly_checkins[0]?.status === s).length
    return {
      weekStart: week,
      interns: interns.length,
      submitted: status('SUBMITTED'),
      reviewed: status('REVIEWED'),
      missing: interns.filter((i) => !i.weekly_checkins[0] || i.weekly_checkins[0].status === 'DRAFT').length,
    }
  },

  async review(ctx: RequestContext, input: unknown) {
    const data = parseInput(reviewSchema, input)
    const row = await prisma.weeklyCheckin.findFirst({
      where: { id: data.checkinId, organization_id: ctx.organization.id },
      select: { id: true, status: true, week_start: true, intern: { select: internPlacementSelect } },
    })
    if (!row || !covers(ctx, 'checkin.read', row.intern)) throw new NotFoundError('Check-in')
    if (!covers(ctx, 'checkin.review', row.intern)) throw new ForbiddenError()
    if (row.intern.user_id === ctx.actor.userId) throw new ForbiddenError('You can’t review your own check-in')
    const { count } = await prisma.weeklyCheckin.updateMany({
      where: { id: row.id, status: 'SUBMITTED' },
      data: { status: 'REVIEWED', reviewed_by: ctx.actor.userId, reviewed_at: new Date(), review_comment: data.comment },
    })
    if (!count) throw new ConflictError('This check-in isn’t waiting for review')
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.CHECKIN_REVIEWED,
      resourceType: 'checkin',
      resourceId: row.id,
      metadata: { internId: row.intern.id, weekStart: formatDateOnly(row.week_start) },
    })
    await domainEvents.emit('performance.checkin_reviewed', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { checkinId: row.id, internUserId: row.intern.user_id },
    })
  },
}

/**
 * Daily job: on Monday (organization time) every tracked intern is told the
 * week's check-in is open; on Friday those who haven't submitted are
 * reminded. Running the job twice on the same day doesn't double-notify
 * (the subscriber skips a reminder already sent for that week).
 */
export const checkinJobs = {
  async emitReminders(options: { organizationId?: string; now?: Date } = {}) {
    const organizations = await prisma.organization.findMany({
      where: options.organizationId ? { id: options.organizationId } : {},
      select: { id: true, timezone: true },
    })
    let open = 0
    let due = 0
    for (const org of organizations) {
      const today = todayIn(org.timezone, options.now)
      const day = today.getUTCDay() // 1 = Monday, 5 = Friday
      if (day !== 1 && day !== 5) continue
      const week = weekStart(today)
      const interns = await prisma.intern.findMany({
        where: {
          organization_id: org.id,
          deleted_at: null,
          status: { in: TRACKED_STATUSES },
          ...(day === 5 ? { weekly_checkins: { none: { week_start: week, status: { not: 'DRAFT' } } } } : {}),
        },
        select: { user_id: true },
      })
      for (const intern of interns) {
        if (day === 1) open++
        else due++
        await domainEvents.emit('performance.checkin_reminder', {
          organizationId: org.id,
          actorUserId: null,
          payload: { internUserId: intern.user_id, kind: day === 1 ? 'OPEN' : 'DUE', weekStart: formatDateOnly(week) },
        })
      }
    }
    return { checkinOpen: open, checkinDue: due }
  },
}

export type CheckinMine = Awaited<ReturnType<typeof checkinService.mine>>
export type CheckinDetail = Awaited<ReturnType<typeof checkinService.get>>
export type CheckinList = Awaited<ReturnType<typeof checkinService.list>>
