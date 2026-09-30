import type { LeaveStatus, Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { ACTIVE_LEAVE, canCancelLeave, canReviewLeave, leaveBalance, workingDaysBetween } from '@/lib/hr/leave'
import { toCsv } from '@/lib/hr/operations'
import { dayKey, monthRange, parseMonth, formatMonth } from '@/lib/hr/time'
import { addDays, daysBetween, parseDateOnly, todayIn } from '@/lib/interns/dates'
import { getStorageService } from '@/lib/storage'
import { fullName } from '@/lib/utils/format'
import { isoDateSchema, parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { userScope } from '../repositories/scope'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import {
  forbidSelf,
  holidaySet,
  optionalText,
  optionalUuid,
  personSelect,
  requireUserInScope,
  scopedUsers,
  trackedInterns,
} from './hr-shared'
import { skipTake, toPage } from './pagination'
import { settingsService } from './settings.service'

/**
 * Leave: configurable types (quota or unlimited), requests counted in working
 * days (weekends and holidays excluded), overlap validation (HR may override
 * with an audited reason), approval without self-approval, balances, calendar.
 */

const requestSchema = z
  .strictObject({
    leaveTypeId: z.uuid({ message: 'Choose a leave type' }),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    reason: z.string().trim().min(3, 'Give a short reason').max(1000),
    /** HR only: request on someone's behalf. */
    userId: optionalUuid,
    /** HR only: accept an overlap with an explicit reason. */
    overrideReason: optionalText(500),
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: 'The end date must be on or after the start date',
    path: ['endDate'],
  })

const reviewSchema = z
  .strictObject({
    leaveId: z.uuid(),
    decision: z.enum(['APPROVED', 'REJECTED']),
    comment: optionalText(1000),
    overrideReason: optionalText(500),
  })
  .refine((value) => value.decision === 'APPROVED' || value.comment, {
    message: 'Give a reason for rejecting',
    path: ['comment'],
  })

const typeSchema = z.strictObject({
  leaveTypeId: optionalUuid,
  name: z.string().trim().min(2, 'Enter a name').max(60),
  description: optionalText(300),
  quotaDays: z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : null))
    .pipe(z.number().int().min(0).max(366).nullable()),
  requiresApproval: z.preprocess((value) => value === 'on' || value === 'true' || value === true, z.boolean()),
  requiresAttachment: z.preprocess((value) => value === 'on' || value === 'true' || value === true, z.boolean()),
  isActive: z.preprocess((value) => value === 'on' || value === 'true' || value === true, z.boolean()),
})

const balanceSchema = z.strictObject({
  userId: z.uuid(),
  leaveTypeId: z.uuid(),
  allocatedDays: z.coerce.number().int().min(0).max(366),
  notes: optionalText(300),
})

export const leaveQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional().catch(undefined),
  type: z.uuid().optional().catch(undefined),
  user: z.uuid().optional().catch(undefined),
  from: isoDateSchema.optional().catch(undefined),
  to: isoDateSchema.optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
})

const leaveSelect = {
  id: true,
  user_id: true,
  start_date: true,
  end_date: true,
  days: true,
  reason: true,
  status: true,
  attachment_path: true,
  review_comment: true,
  reviewed_at: true,
  cancelled_at: true,
  overlap_override: true,
  override_reason: true,
  created_at: true,
  created_by: true,
  leave_type: { select: { id: true, name: true, slug: true } },
  user: { select: personSelect },
  reviewer: { select: personSelect },
} as const satisfies Prisma.LeaveRequestSelect

type LeaveRow = Prisma.LeaveRequestGetPayload<{ select: typeof leaveSelect }>

function toView(row: LeaveRow) {
  const { attachment_path, ...rest } = row
  return {
    ...rest,
    hasAttachment: Boolean(attachment_path),
    userName: fullName(row.user),
    reviewerName: row.reviewer ? fullName(row.reviewer) : null,
  }
}
export type LeaveView = ReturnType<typeof toView>

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

async function activeTypes(organizationId: string) {
  return prisma.leaveType.findMany({
    where: { organization_id: organizationId, is_active: true },
    orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      quota_days: true,
      requires_approval: true,
      requires_attachment: true,
    },
  })
}

/** Balances per active type for one user (all-time for the internship; unlimited types have no cap). */
async function balancesFor(organizationId: string, userId: string) {
  const [types, overrides, sums] = await Promise.all([
    activeTypes(organizationId),
    prisma.leaveBalance.findMany({
      where: { organization_id: organizationId, user_id: userId },
      select: { leave_type_id: true, allocated_days: true },
    }),
    prisma.leaveRequest.groupBy({
      by: ['leave_type_id', 'status'],
      where: { organization_id: organizationId, user_id: userId, status: { in: [...ACTIVE_LEAVE] } },
      _sum: { days: true },
    }),
  ])
  const allocated = new Map(overrides.map((o) => [o.leave_type_id, o.allocated_days]))
  const sum = (typeId: string, status: LeaveStatus) =>
    sums.find((s) => s.leave_type_id === typeId && s.status === status)?._sum.days ?? 0
  return types.map((type) => ({
    type,
    ...leaveBalance({
      allocated: allocated.has(type.id) ? allocated.get(type.id)! : type.quota_days,
      used: sum(type.id, 'APPROVED'),
      pending: sum(type.id, 'PENDING'),
    }),
  }))
}

async function overlapping(organizationId: string, userId: string, start: Date, end: Date, excludeId?: string) {
  return prisma.leaveRequest.findMany({
    where: {
      organization_id: organizationId,
      user_id: userId,
      status: { in: [...ACTIVE_LEAVE] },
      start_date: { lte: end },
      end_date: { gte: start },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, start_date: true, end_date: true, status: true },
  })
}

export const leaveService = {
  types(ctx: RequestContext) {
    return activeTypes(ctx.organization.id)
  },

  async allTypes(ctx: RequestContext) {
    authorizationService.require(ctx, 'leave_type.manage')
    return prisma.leaveType.findMany({
      where: { organization_id: ctx.organization.id },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        quota_days: true,
        requires_approval: true,
        requires_attachment: true,
        is_active: true,
        _count: { select: { leave_requests: true } },
      },
    })
  },

  /** The signed-in person's leave: balances, requests and types. */
  async mine(ctx: RequestContext) {
    authorizationService.require(ctx, 'leave.read')
    const today = todayIn(ctx.organization.timezone)
    const [balances, requests, policy] = await Promise.all([
      balancesFor(ctx.organization.id, ctx.actor.userId),
      prisma.leaveRequest.findMany({
        where: { organization_id: ctx.organization.id, user_id: ctx.actor.userId },
        orderBy: { start_date: 'desc' },
        take: 100,
        select: leaveSelect,
      }),
      settingsService.leavePolicy(ctx.organization.id),
    ])
    return {
      today,
      balances,
      policy,
      canRequest: authorizationService.can(ctx, 'leave.request'),
      requests: requests.map((row) => ({
        ...toView(row),
        canCancel: canCancelLeave({
          status: row.status,
          startDate: row.start_date,
          today,
          isRequester: true,
          canManage: false,
        }),
      })),
    }
  },

  async request(ctx: RequestContext, input: unknown, attachment?: { name: string; type: string; bytes: Uint8Array }) {
    const data = parseInput(requestSchema, input)
    const onBehalf = Boolean(data.userId && data.userId !== ctx.actor.userId)
    let userId = ctx.actor.userId
    if (onBehalf) {
      await requireUserInScope(ctx, 'leave.manage', data.userId!)
      userId = data.userId!
    } else {
      authorizationService.require(ctx, 'leave.request')
      if (data.overrideReason) throw new ForbiddenError('Only HR can override leave rules')
    }

    const org = ctx.organization.id
    const today = todayIn(ctx.organization.timezone)
    const start = parseDateOnly(data.startDate)
    const end = parseDateOnly(data.endDate)
    const [type, policy, rules, holidays] = await Promise.all([
      prisma.leaveType.findFirst({
        where: { id: data.leaveTypeId, organization_id: org, is_active: true },
        select: { id: true, name: true, requires_approval: true, requires_attachment: true },
      }),
      settingsService.leavePolicy(org),
      settingsService.attendanceRules(org),
      holidaySet(org, start, end),
    ])
    if (!type) throw new ValidationError('Choose a leave type', { leaveTypeId: 'Not available' })
    if (!onBehalf && start < addDays(today, -policy.backdateDays)) {
      throw new ValidationError(`Leave can start at most ${policy.backdateDays} days in the past`, {
        startDate: 'Too far in the past',
      })
    }
    if (daysBetween(start, end) + 1 > policy.maxRequestDays) {
      throw new ValidationError(`A single request can cover at most ${policy.maxRequestDays} days`, {
        endDate: 'Range too long',
      })
    }
    const days = workingDaysBetween(start, end, { workingDays: rules.workingDays, holidays })
    if (days === 0) {
      throw new ValidationError('Those dates are all weekends or holidays — no leave is needed', {
        startDate: 'No working days in range',
      })
    }
    if (type.requires_attachment && !attachment?.bytes.byteLength) {
      throw new ValidationError(`${type.name} needs a supporting document`, { attachment: 'Required' })
    }

    const clashes = await overlapping(org, userId, start, end)
    const override = clashes.length > 0
    if (override) {
      if (!onBehalf || !data.overrideReason) {
        throw new ValidationError('These dates overlap another leave request', {
          startDate: `Overlaps leave from ${dayKey(clashes[0].start_date)} to ${dayKey(clashes[0].end_date)}`,
        })
      }
    }

    const balance = (await balancesFor(org, userId)).find((b) => b.type.id === type.id)
    if (balance && !balance.unlimited && days > (balance.remaining ?? 0) && !data.overrideReason) {
      throw new ValidationError(
        `Not enough ${type.name.toLowerCase()} left: ${balance.remaining} day(s) remaining, ${days} requested`,
        { leaveTypeId: 'Insufficient balance' },
      )
    }

    let attachmentPath: string | null = null
    if (attachment?.bytes.byteLength) {
      const stored = await getStorageService().upload({
        organizationId: org,
        category: 'document',
        fileName: attachment.name,
        mimeType: attachment.type,
        data: attachment.bytes,
      })
      attachmentPath = stored.storagePath
    }
    const autoApprove = !type.requires_approval
    const leave = await prisma.leaveRequest.create({
      data: {
        organization_id: org,
        user_id: userId,
        leave_type_id: type.id,
        start_date: start,
        end_date: end,
        days,
        reason: data.reason,
        attachment_path: attachmentPath,
        status: autoApprove ? 'APPROVED' : 'PENDING',
        reviewed_at: autoApprove ? new Date() : null,
        review_comment: autoApprove ? 'Approved automatically (no approval required for this type)' : null,
        created_by: ctx.actor.userId,
        overlap_override: override,
        override_reason: override ? (data.overrideReason ?? null) : null,
      },
      select: { id: true, status: true },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.LEAVE_REQUESTED,
      resourceType: 'leave',
      resourceId: leave.id,
      metadata: { userId, type: type.name, start: data.startDate, end: data.endDate, days, onBehalf },
    })
    if (override) {
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.LEAVE_OVERLAP_OVERRIDDEN,
        resourceType: 'leave',
        resourceId: leave.id,
        metadata: { userId, overlaps: clashes.map((c) => c.id), reason: data.overrideReason },
      })
    }
    if (leave.status === 'PENDING') {
      await domainEvents.emit('leave.requested', {
        organizationId: org,
        actorUserId: ctx.actor.userId,
        payload: { leaveId: leave.id, userId },
      })
    }
    return { id: leave.id, status: leave.status, days }
  },

  async cancel(ctx: RequestContext, leaveId: string) {
    const id = parseInput(z.uuid(), leaveId)
    const leave = await prisma.leaveRequest.findFirst({
      where: { id, organization_id: ctx.organization.id },
      select: { id: true, user_id: true, status: true, start_date: true },
    })
    if (!leave) throw new NotFoundError('Leave request')
    const isRequester = leave.user_id === ctx.actor.userId
    const manageScope = authorizationService.scopeOf(ctx, 'leave.manage')
    const canManage =
      !isRequester &&
      Boolean(manageScope) &&
      (await prisma.user.count({ where: { id: leave.user_id, ...userScope(ctx.actor, manageScope!) } })) > 0
    if (!isRequester && !canManage) throw new NotFoundError('Leave request')
    if (isRequester) authorizationService.require(ctx, 'leave.cancel')
    const today = todayIn(ctx.organization.timezone)
    if (!canCancelLeave({ status: leave.status, startDate: leave.start_date, today, isRequester, canManage })) {
      throw new ConflictError(
        leave.status === 'APPROVED'
          ? 'Approved leave that has started can only be cancelled by HR'
          : 'This request can’t be cancelled',
      )
    }
    const { count } = await prisma.leaveRequest.updateMany({
      where: { id: leave.id, status: leave.status },
      data: { status: 'CANCELLED', cancelled_at: new Date(), cancelled_by: ctx.actor.userId },
    })
    if (!count) throw new ConflictError('This request changed — refresh and try again')
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.LEAVE_CANCELLED,
      resourceType: 'leave',
      resourceId: leave.id,
      metadata: { userId: leave.user_id, before: leave.status, after: 'CANCELLED', byRequester: isRequester },
    })
    await domainEvents.emit('leave.cancelled', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { leaveId: leave.id, userId: leave.user_id, wasApproved: leave.status === 'APPROVED' },
    })
  },

  /** Approve or reject a PENDING request of someone in scope — never your own. */
  async review(ctx: RequestContext, input: unknown) {
    const data = parseInput(reviewSchema, input)
    const permission = data.decision === 'APPROVED' ? 'leave.approve' : 'leave.reject'
    authorizationService.require(ctx, permission)
    const where = scopedUsers(ctx, permission)!
    const leave = await prisma.leaveRequest.findFirst({
      where: { id: data.leaveId, organization_id: ctx.organization.id, user: where },
      select: { id: true, user_id: true, status: true, start_date: true, end_date: true, days: true },
    })
    if (!leave) throw new NotFoundError('Leave request')
    forbidSelf(ctx, leave.user_id, 'approve or reject')
    if (!canReviewLeave({ status: leave.status, isRequester: false })) {
      throw new ConflictError('This request has already been decided')
    }
    let override = false
    if (data.decision === 'APPROVED') {
      const clashes = (
        await overlapping(ctx.organization.id, leave.user_id, leave.start_date, leave.end_date, leave.id)
      ).filter((c) => c.status === 'APPROVED')
      if (clashes.length) {
        if (!authorizationService.can(ctx, 'leave.manage') || !data.overrideReason) {
          throw new ValidationError('This overlaps approved leave. HR can approve with an override reason.', {
            overrideReason: 'Needed to approve an overlap',
          })
        }
        override = true
      }
    }
    const { count } = await prisma.leaveRequest.updateMany({
      where: { id: leave.id, status: 'PENDING' },
      data: {
        status: data.decision,
        reviewed_by: ctx.actor.userId,
        reviewed_at: new Date(),
        review_comment: data.comment ?? null,
        ...(override ? { overlap_override: true, override_reason: data.overrideReason } : {}),
      },
    })
    if (!count) throw new ConflictError('This request has already been decided')
    await auditService.logForContext(ctx, {
      action: data.decision === 'APPROVED' ? AUDIT_ACTIONS.LEAVE_APPROVED : AUDIT_ACTIONS.LEAVE_REJECTED,
      resourceType: 'leave',
      resourceId: leave.id,
      metadata: {
        userId: leave.user_id,
        before: 'PENDING',
        after: data.decision,
        days: leave.days,
        reason: data.comment,
        override: override ? data.overrideReason : undefined,
      },
    })
    await domainEvents.emit('leave.reviewed', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { leaveId: leave.id, userId: leave.user_id, decision: data.decision },
    })
  },

  /** Requests of people in the viewer's leave.read scope (excluding their own), filtered and paginated. */
  async queue(ctx: RequestContext, rawQuery: unknown) {
    const where = scopedUsers(ctx, 'leave.read')
    if (!where) throw new ForbiddenError()
    const query = leaveQuerySchema.parse(rawQuery ?? {})
    const filter = queueFilter(ctx, where, query)
    const pagination = { page: query.page, pageSize: 25 }
    const today = todayIn(ctx.organization.timezone)
    const canApprove = authorizationService.can(ctx, 'leave.approve')
    const canReject = authorizationService.can(ctx, 'leave.reject')
    const canManage = authorizationService.can(ctx, 'leave.manage')
    const [rows, total, pending] = await Promise.all([
      prisma.leaveRequest.findMany({
        where: filter,
        orderBy:
          query.status === 'PENDING' || !query.status
            ? [{ status: 'asc' }, { start_date: 'asc' }]
            : [{ start_date: 'desc' }],
        ...skipTake(pagination),
        select: leaveSelect,
      }),
      prisma.leaveRequest.count({ where: filter }),
      prisma.leaveRequest.count({
        where: {
          organization_id: ctx.organization.id,
          status: 'PENDING',
          user: where,
          user_id: { not: ctx.actor.userId },
        },
      }),
    ])
    return {
      query,
      pending,
      can: { approve: canApprove, reject: canReject, manage: canManage },
      page: toPage(
        rows.map((row) => ({
          ...toView(row),
          canReview: row.status === 'PENDING' && (canApprove || canReject),
          canCancel:
            canManage &&
            canCancelLeave({ status: row.status, startDate: row.start_date, today, isRequester: false, canManage }),
        })),
        total,
        pagination,
      ),
    }
  },

  /** Leave (approved + pending) and holidays in a month, for everyone in scope (or just yourself). */
  async calendar(ctx: RequestContext, monthInput?: string, onlySelf = false) {
    authorizationService.require(ctx, 'leave.read')
    const where = onlySelf ? { id: ctx.actor.userId } : scopedUsers(ctx, 'leave.read')!
    const today = todayIn(ctx.organization.timezone)
    const month = parseMonth(monthInput) ?? parseMonth(formatMonth(today))!
    const [start, end] = monthRange(month)
    const [leave, holidays] = await Promise.all([
      prisma.leaveRequest.findMany({
        where: {
          organization_id: ctx.organization.id,
          status: { in: [...ACTIVE_LEAVE] },
          start_date: { lte: end },
          end_date: { gte: start },
          user: where,
        },
        orderBy: { start_date: 'asc' },
        select: leaveSelect,
      }),
      prisma.holiday.findMany({
        where: { organization_id: ctx.organization.id, date: { gte: start, lte: end } },
        orderBy: { date: 'asc' },
        select: { date: true, name: true, is_optional: true },
      }),
    ])
    return { month, start, end, today, leave: leave.map(toView), holidays }
  },

  /** Balances + requests for one person in scope (intern profile tab). */
  async forUser(ctx: RequestContext, userId: string) {
    if (userId !== ctx.actor.userId) await requireUserInScope(ctx, 'leave.read', userId)
    else authorizationService.require(ctx, 'leave.read')
    const [balances, requests] = await Promise.all([
      balancesFor(ctx.organization.id, userId),
      prisma.leaveRequest.findMany({
        where: { organization_id: ctx.organization.id, user_id: userId },
        orderBy: { start_date: 'desc' },
        take: 50,
        select: leaveSelect,
      }),
    ])
    return { balances, requests: requests.map(toView), canManage: authorizationService.can(ctx, 'leave.manage') }
  },

  /** People whose leave the viewer manages (leave.manage), for "record leave" and balances. */
  async managedPeople(ctx: RequestContext) {
    const where = scopedUsers(ctx, 'leave.manage')
    if (!where) return []
    const rows = await trackedInterns(ctx.organization.id, where)
    return rows.filter((r) => r.user_id !== ctx.actor.userId).map((r) => ({ id: r.user_id, name: fullName(r.user) }))
  },

  async setBalance(ctx: RequestContext, input: unknown) {
    const data = parseInput(balanceSchema, input)
    await requireUserInScope(ctx, 'leave.manage', data.userId)
    const type = await prisma.leaveType.findFirst({
      where: { id: data.leaveTypeId, organization_id: ctx.organization.id },
      select: { id: true, name: true, quota_days: true },
    })
    if (!type) throw new NotFoundError('Leave type')
    const existing = await prisma.leaveBalance.findUnique({
      where: { user_id_leave_type_id: { user_id: data.userId, leave_type_id: type.id } },
      select: { allocated_days: true },
    })
    await prisma.leaveBalance.upsert({
      where: { user_id_leave_type_id: { user_id: data.userId, leave_type_id: type.id } },
      create: {
        organization_id: ctx.organization.id,
        user_id: data.userId,
        leave_type_id: type.id,
        allocated_days: data.allocatedDays,
        notes: data.notes ?? null,
        updated_by: ctx.actor.userId,
      },
      update: { allocated_days: data.allocatedDays, notes: data.notes ?? null, updated_by: ctx.actor.userId },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.LEAVE_BALANCE_UPDATED,
      resourceType: 'leave_balance',
      resourceId: data.userId,
      metadata: {
        userId: data.userId,
        type: type.name,
        before: existing?.allocated_days ?? type.quota_days,
        after: data.allocatedDays,
        reason: data.notes,
      },
    })
  },

  async saveType(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'leave_type.manage')
    const data = parseInput(typeSchema, input)
    const org = ctx.organization.id
    const values = {
      name: data.name,
      description: data.description ?? null,
      quota_days: data.quotaDays,
      requires_approval: data.requiresApproval,
      requires_attachment: data.requiresAttachment,
      is_active: data.isActive,
    }
    let before: unknown = null
    let id: string
    if (data.leaveTypeId) {
      const existing = await prisma.leaveType.findFirst({
        where: { id: data.leaveTypeId, organization_id: org },
        select: {
          id: true,
          name: true,
          quota_days: true,
          requires_approval: true,
          requires_attachment: true,
          is_active: true,
        },
      })
      if (!existing) throw new NotFoundError('Leave type')
      before = existing
      id = (await prisma.leaveType.update({ where: { id: existing.id }, data: values, select: { id: true } })).id
    } else {
      const slug = slugify(data.name)
      if (!slug) throw new ValidationError('Use letters or numbers in the name', { name: 'Invalid' })
      if (await prisma.leaveType.count({ where: { organization_id: org, slug } })) {
        throw new ConflictError('A leave type with that name already exists')
      }
      const last = await prisma.leaveType.aggregate({ where: { organization_id: org }, _max: { sort_order: true } })
      id = (
        await prisma.leaveType.create({
          data: { ...values, organization_id: org, slug, sort_order: (last._max.sort_order ?? 0) + 1 },
          select: { id: true },
        })
      ).id
    }
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.LEAVE_TYPE_SAVED,
      resourceType: 'leave_type',
      resourceId: id,
      metadata: { before, after: values },
    })
  },

  /** Streams a request's supporting document to the requester or someone who may review it. */
  async attachment(ctx: RequestContext, leaveId: string) {
    const id = parseInput(z.uuid(), leaveId)
    const leave = await prisma.leaveRequest.findFirst({
      where: { id, organization_id: ctx.organization.id },
      select: { user_id: true, attachment_path: true },
    })
    if (!leave?.attachment_path) throw new NotFoundError('Attachment')
    if (leave.user_id !== ctx.actor.userId) {
      await requireUserInScope(ctx, 'leave.read', leave.user_id).catch(() => {
        throw new NotFoundError('Attachment')
      })
    }
    const bytes = await getStorageService().download(leave.attachment_path)
    const ext = leave.attachment_path.slice(leave.attachment_path.lastIndexOf('.'))
    const mime =
      ext === '.pdf'
        ? 'application/pdf'
        : ext === '.png'
          ? 'image/png'
          : ext === '.docx'
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'image/jpeg'
    return { bytes, fileName: `leave-attachment${ext}`, mimeType: mime }
  },

  async counts(ctx: RequestContext) {
    const where = scopedUsers(ctx, 'leave.read')
    if (!where) return null
    const today = todayIn(ctx.organization.timezone)
    const [pending, onLeaveToday] = await Promise.all([
      prisma.leaveRequest.count({
        where: {
          organization_id: ctx.organization.id,
          status: 'PENDING',
          user: where,
          user_id: { not: ctx.actor.userId },
        },
      }),
      prisma.leaveRequest.count({
        where: {
          organization_id: ctx.organization.id,
          status: 'APPROVED',
          user: where,
          start_date: { lte: today },
          end_date: { gte: today },
        },
      }),
    ])
    return { pending, onLeaveToday }
  },

  async exportCsv(ctx: RequestContext, rawQuery: unknown) {
    authorizationService.require(ctx, 'leave.export')
    const where = scopedUsers(ctx, 'leave.export')!
    const query = leaveQuerySchema.parse(rawQuery ?? {})
    const rows = await prisma.leaveRequest.findMany({
      where: queueFilter(ctx, where, query, false),
      orderBy: { start_date: 'asc' },
      take: 10_000,
      select: {
        ...leaveSelect,
        user: { select: { ...personSelect, email: true, intern: { select: { employee_code: true } } } },
      },
    })
    const csv = toCsv(
      [
        'Employee code',
        'Name',
        'Email',
        'Type',
        'Start',
        'End',
        'Working days',
        'Status',
        'Reason',
        'Reviewer',
        'Review comment',
      ],
      rows.map((r) => [
        r.user.intern?.employee_code ?? '',
        fullName(r.user),
        r.user.email,
        r.leave_type.name,
        dayKey(r.start_date),
        dayKey(r.end_date),
        r.days,
        r.status,
        r.reason ?? '',
        r.reviewer ? fullName(r.reviewer) : '',
        r.review_comment ?? '',
      ]),
    )
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.EXPORT_GENERATED,
      resourceType: 'leave',
      metadata: { kind: 'leave', rows: rows.length, filter: query },
    })
    return { csv, fileName: `leave-${dayKey(todayIn(ctx.organization.timezone))}.csv` }
  },
}

function queueFilter(
  ctx: RequestContext,
  where: Prisma.UserWhereInput,
  query: z.infer<typeof leaveQuerySchema>,
  excludeSelf = true,
): Prisma.LeaveRequestWhereInput {
  return {
    organization_id: ctx.organization.id,
    user: { AND: [where, query.user ? { id: query.user } : {}] },
    ...(excludeSelf ? { user_id: { not: ctx.actor.userId } } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.type ? { leave_type_id: query.type } : {}),
    ...(query.from ? { end_date: { gte: parseDateOnly(query.from) } } : {}),
    ...(query.to ? { start_date: { lte: parseDateOnly(query.to) } } : {}),
  }
}

export type LeaveQueue = Awaited<ReturnType<typeof leaveService.queue>>
