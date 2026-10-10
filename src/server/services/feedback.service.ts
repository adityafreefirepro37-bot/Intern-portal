import type { FeedbackContextType, FeedbackVisibility, Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { parseDateOnly } from '@/lib/interns/dates'
import { canViewFeedback } from '@/lib/performance/rules'
import { isoDateSchema, parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { optionalText, optionalUuid, personSelect } from './hr-shared'
import {
  covers,
  internPlacementSelect,
  ownIntern,
  requireInternFor,
  resolveRecord,
  resolveRecords,
  scopedInternWhere,
} from './performance-access'

/**
 * Feedback about interns. Visibility is enforced on the server for every
 * read, both in the query (rows a viewer may not see are never loaded) and
 * again per row with `canViewFeedback`:
 *   PRIVATE              the author only
 *   SHARED_WITH_INTERN   the intern, their manager and mentor, HR
 *   SHARED_WITH_MANAGER  the intern's manager and HR (not the intern)
 *   HR_ONLY              HR
 * Interns request feedback from their manager or mentor.
 */

const CONTEXTS = ['TASK', 'PROJECT', 'LEARNING', 'GOAL', 'WEEKLY_CHECKIN', 'GENERAL'] as const
const VISIBILITIES = ['PRIVATE', 'SHARED_WITH_INTERN', 'SHARED_WITH_MANAGER', 'HR_ONLY'] as const

const giveSchema = z
  .strictObject({
    internId: z.uuid(),
    contextType: z.enum(CONTEXTS).default('GENERAL'),
    contextId: optionalUuid,
    feedbackType: z.enum(['POSITIVE', 'DEVELOPMENTAL', 'GENERAL']),
    visibility: z.enum(VISIBILITIES),
    body: z.string().trim().min(10, 'Write at least a sentence').max(5000),
    requestId: optionalUuid,
  })
  .refine((v) => (v.contextType === 'GENERAL') === !v.contextId, {
    message: 'Choose what this feedback is about',
    path: ['contextId'],
  })

const editSchema = z.strictObject({
  feedbackId: z.uuid(),
  body: z.string().trim().min(10, 'Write at least a sentence').max(5000),
  feedbackType: z.enum(['POSITIVE', 'DEVELOPMENTAL', 'GENERAL']),
  visibility: z.enum(VISIBILITIES),
})

const requestSchema = z.strictObject({
  recipientId: z.uuid(),
  question: z.string().trim().min(5, 'Say what you’d like feedback on').max(1000),
  contextType: z.enum(CONTEXTS).default('GENERAL'),
  contextId: optionalUuid,
  dueDate: z
    .string()
    .optional()
    .transform((v) => v || undefined)
    .pipe(isoDateSchema.optional()),
})

export const feedbackFilterSchema = z.object({
  view: z
    .enum(['received', 'given', 'interns', 'requests', ''])
    .optional()
    .transform((v) => v || undefined),
  internId: optionalUuid,
  type: z
    .enum(['POSITIVE', 'DEVELOPMENTAL', 'GENERAL', ''])
    .optional()
    .transform((v) => v || undefined),
  q: optionalText(100),
})

/** Maps feedback contexts onto the record types evidence can resolve. */
const CONTEXT_RECORD: Partial<Record<FeedbackContextType, Parameters<typeof resolveRecord>[2]>> = {
  TASK: 'TASK',
  PROJECT: 'PROJECT',
  LEARNING: 'COURSE',
  GOAL: 'GOAL',
  WEEKLY_CHECKIN: 'CHECKIN',
}

const feedbackSelect = {
  id: true,
  body: true,
  feedback_type: true,
  visibility: true,
  context_type: true,
  context_id: true,
  from_user_id: true,
  to_user_id: true,
  created_at: true,
  edited_at: true,
  from_user: { select: personSelect },
  to_user: { select: personSelect },
  intern: { select: internPlacementSelect },
} as const satisfies Prisma.FeedbackSelect

type FeedbackRow = Prisma.FeedbackGetPayload<{ select: typeof feedbackSelect }>

/** The query-side twin of canViewFeedback. */
function visibleWhere(ctx: RequestContext): Prisma.FeedbackWhereInput {
  const me = ctx.actor.userId
  const orgWide = authorizationService.scopeOf(ctx, 'feedback.read') === 'ORGANIZATION'
  if (orgWide) return { OR: [{ from_user_id: me }, { visibility: { not: 'PRIVATE' } }] }
  return {
    OR: [
      { from_user_id: me },
      { visibility: 'SHARED_WITH_INTERN', to_user_id: me },
      { visibility: 'SHARED_WITH_INTERN', intern: { is: { OR: [{ manager_id: me }, { mentor_id: me }] } } },
      { visibility: 'SHARED_WITH_MANAGER', intern: { is: { manager_id: me } } },
    ],
  }
}

function viewerOf(ctx: RequestContext, row: FeedbackRow) {
  return {
    userId: ctx.actor.userId,
    isRecipient: row.to_user_id === ctx.actor.userId,
    isInternManager: row.intern?.manager_id === ctx.actor.userId,
    isInternMentor: row.intern?.mentor_id === ctx.actor.userId,
    orgWide: authorizationService.scopeOf(ctx, 'feedback.read') === 'ORGANIZATION',
  }
}

/** Rows the viewer may see (in scope + visibility), with the rule re-checked per row. */
async function visibleFeedback(ctx: RequestContext, where: Prisma.FeedbackWhereInput, take = 100) {
  const internWhere = scopedInternWhere(ctx, 'feedback.read')
  if (!internWhere) throw new ForbiddenError()
  const rows = await prisma.feedback.findMany({
    where: {
      AND: [
        { organization_id: ctx.organization.id },
        // Authors always see what they wrote; otherwise the intern must be in scope.
        { OR: [{ from_user_id: ctx.actor.userId }, { intern: { is: internWhere } }] },
        visibleWhere(ctx),
        where,
      ],
    },
    orderBy: { created_at: 'desc' },
    take,
    select: feedbackSelect,
  })
  return rows.filter((row) => canViewFeedback(row, viewerOf(ctx, row)))
}

async function withContext(ctx: RequestContext, rows: FeedbackRow[]) {
  const contexts = await resolveRecords(
    ctx.organization.id,
    rows.map((row) => {
      const type = CONTEXT_RECORD[row.context_type]
      return type && row.context_id && row.intern ? { intern: row.intern, type, id: row.context_id } : null
    }),
  )
  return rows.map((row, index) => {
    const { intern, ...rest } = row
    return {
      ...rest,
      internId: intern?.id ?? null,
      context: contexts[index],
      canEdit: row.from_user_id === ctx.actor.userId && authorizationService.can(ctx, 'feedback.update'),
    }
  })
}

export const feedbackService = {
  /** The feedback page: received / given / about my interns / requests. */
  async page(ctx: RequestContext, query: unknown = {}) {
    authorizationService.require(ctx, 'feedback.read')
    const filters = parseInput(feedbackFilterSchema, query)
    const me = ctx.actor.userId
    const intern = await ownIntern(ctx)
    const staff = authorizationService.can(ctx, 'feedback.create')
    const view = filters.view ?? (intern ? 'received' : 'interns')
    const typeFilter = filters.type ? { feedback_type: filters.type } : {}
    const search = filters.q ? { body: { contains: filters.q, mode: 'insensitive' as const } } : {}
    const where: Prisma.FeedbackWhereInput =
      view === 'received'
        ? { to_user_id: me }
        : view === 'given'
          ? { from_user_id: me }
          : { to_user_id: { not: me }, ...(filters.internId ? { intern_id: filters.internId } : {}) }
    const [rows, incoming, outgoing, interns, recipients] = await Promise.all([
      view === 'requests' ? Promise.resolve([]) : visibleFeedback(ctx, { ...where, ...typeFilter, ...search }),
      prisma.feedbackRequest.findMany({
        where: { organization_id: ctx.organization.id, recipient_id: me },
        orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
        take: 50,
        select: {
          id: true,
          question: true,
          status: true,
          due_date: true,
          created_at: true,
          context_type: true,
          requester: { select: personSelect },
          intern: { select: { id: true } },
        },
      }),
      prisma.feedbackRequest.findMany({
        where: { organization_id: ctx.organization.id, requester_id: me },
        orderBy: { created_at: 'desc' },
        take: 50,
        select: {
          id: true,
          question: true,
          status: true,
          due_date: true,
          created_at: true,
          recipient: { select: personSelect },
          feedback_id: true,
        },
      }),
      staff ? this.internOptions(ctx) : Promise.resolve([]),
      intern && authorizationService.can(ctx, 'feedback.request') ? requestRecipients(intern) : Promise.resolve([]),
    ])
    return {
      view,
      filters,
      feedback: await withContext(ctx, rows),
      requests: { incoming, outgoing },
      interns,
      recipients,
      isIntern: Boolean(intern),
      can: {
        give: staff,
        request: Boolean(intern) && authorizationService.can(ctx, 'feedback.request') && recipients.length > 0,
      },
    }
  },

  /** Global search: only feedback the viewer may see (same rules as every other read). */
  async search(ctx: RequestContext, term: string, take: number) {
    authorizationService.require(ctx, 'feedback.read')
    return visibleFeedback(ctx, { body: { contains: term, mode: 'insensitive' } }, take)
  },

  /** Feedback about one intern (profile tab), visibility-filtered. */
  async forIntern(ctx: RequestContext, internId: string) {
    const intern = await requireInternFor(ctx, 'feedback.read', internId)
    const rows = await visibleFeedback(ctx, { intern_id: intern.id })
    return {
      feedback: await withContext(ctx, rows),
      can: { give: intern.user_id !== ctx.actor.userId && covers(ctx, 'feedback.create', intern) },
    }
  },

  async internOptions(ctx: RequestContext) {
    const where = scopedInternWhere(ctx, 'feedback.create')
    if (!where) return []
    return prisma.intern.findMany({
      where: { AND: [where, { user_id: { not: ctx.actor.userId } }] },
      orderBy: { user: { first_name: 'asc' } },
      take: 300,
      select: { id: true, user: { select: personSelect } },
    })
  },

  async give(ctx: RequestContext, input: unknown) {
    const data = parseInput(giveSchema, input)
    const intern = await requireInternFor(ctx, 'feedback.create', data.internId)
    if (intern.user_id === ctx.actor.userId) throw new ForbiddenError('You can’t give feedback to yourself')
    const recordType = CONTEXT_RECORD[data.contextType]
    if (recordType && data.contextId) {
      const record = await resolveRecord(ctx.organization.id, intern, recordType, data.contextId)
      if (!record) throw new ValidationError('That record isn’t connected to this intern', { contextId: 'Not found' })
    }
    let request: { id: string } | null = null
    if (data.requestId) {
      request = await prisma.feedbackRequest.findFirst({
        where: { id: data.requestId, organization_id: ctx.organization.id, recipient_id: ctx.actor.userId, status: 'OPEN' },
        select: { id: true },
      })
      if (!request) throw new NotFoundError('Feedback request')
    }
    const legacyCategory = data.feedbackType === 'POSITIVE' ? 'PRAISE' : data.feedbackType === 'DEVELOPMENTAL' ? 'IMPROVEMENT' : 'GENERAL'
    const feedback = await prisma.feedback.create({
      data: {
        organization_id: ctx.organization.id,
        from_user_id: ctx.actor.userId,
        to_user_id: intern.user_id,
        intern_id: intern.id,
        category: legacyCategory,
        feedback_type: data.feedbackType,
        context_type: data.contextType,
        context_id: data.contextId ?? null,
        body: data.body,
        visibility: data.visibility,
      },
      select: { id: true },
    })
    if (request) {
      await prisma.feedbackRequest.updateMany({
        where: { id: request.id, status: 'OPEN' },
        data: { status: 'COMPLETED', feedback_id: feedback.id },
      })
    }
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.FEEDBACK_CREATED,
      resourceType: 'feedback',
      resourceId: feedback.id,
      // The body isn't copied into the audit log (it may be private).
      metadata: { internId: intern.id, type: data.feedbackType, visibility: data.visibility, context: data.contextType, requestId: request?.id ?? null },
    })
    await domainEvents.emit('performance.feedback_given', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { feedbackId: feedback.id, recipientId: intern.user_id, visibleToRecipient: data.visibility === 'SHARED_WITH_INTERN' },
    })
    return { id: feedback.id }
  },

  /** Authors edit their own feedback; the edit is marked and audited (before/after visibility and type). */
  async edit(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'feedback.update')
    const data = parseInput(editSchema, input)
    const row = await prisma.feedback.findFirst({
      where: { id: data.feedbackId, organization_id: ctx.organization.id, from_user_id: ctx.actor.userId },
      select: { id: true, visibility: true, feedback_type: true, to_user_id: true },
    })
    if (!row) throw new NotFoundError('Feedback')
    await prisma.feedback.update({
      where: { id: row.id },
      data: { body: data.body, feedback_type: data.feedbackType, visibility: data.visibility, edited_at: new Date() },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.FEEDBACK_UPDATED,
      resourceType: 'feedback',
      resourceId: row.id,
      metadata: {
        before: { visibility: row.visibility, type: row.feedback_type },
        after: { visibility: data.visibility, type: data.feedbackType },
      },
    })
    const newlyShared: FeedbackVisibility[] = ['SHARED_WITH_INTERN']
    if (newlyShared.includes(data.visibility) && row.visibility !== data.visibility) {
      await domainEvents.emit('performance.feedback_given', {
        organizationId: ctx.organization.id,
        actorUserId: ctx.actor.userId,
        payload: { feedbackId: row.id, recipientId: row.to_user_id, visibleToRecipient: true },
      })
    }
  },

  /** An intern asks their manager or mentor for feedback. */
  async request(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'feedback.request')
    const data = parseInput(requestSchema, input)
    const intern = await ownIntern(ctx)
    if (!intern) throw new ForbiddenError('Only interns request feedback')
    const allowed = await requestRecipients(intern)
    if (!allowed.some((r) => r.id === data.recipientId)) {
      throw new ValidationError('Ask your manager or mentor', { recipientId: 'Choose your manager or mentor' })
    }
    const recordType = CONTEXT_RECORD[data.contextType]
    if (data.contextType !== 'GENERAL') {
      if (!recordType || !data.contextId || !(await resolveRecord(ctx.organization.id, intern, recordType, data.contextId))) {
        throw new ValidationError('Choose what this is about', { contextId: 'Not found' })
      }
    }
    const open = await prisma.feedbackRequest.count({
      where: { requester_id: ctx.actor.userId, recipient_id: data.recipientId, status: 'OPEN' },
    })
    if (open >= 3) throw new ConflictError('You already have open requests with this person')
    const row = await prisma.feedbackRequest.create({
      data: {
        organization_id: ctx.organization.id,
        requester_id: ctx.actor.userId,
        recipient_id: data.recipientId,
        intern_id: intern.id,
        question: data.question,
        context_type: data.contextType,
        context_id: data.contextType === 'GENERAL' ? null : data.contextId!,
        due_date: data.dueDate ? parseDateOnly(data.dueDate) : null,
      },
      select: { id: true },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.FEEDBACK_REQUESTED,
      resourceType: 'feedback_request',
      resourceId: row.id,
      metadata: { recipientId: data.recipientId, context: data.contextType },
    })
    await domainEvents.emit('performance.feedback_requested', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { requestId: row.id, recipientId: data.recipientId },
    })
    return { id: row.id }
  },

  /** The recipient declines, or the requester cancels, an open request. */
  async closeRequest(ctx: RequestContext, input: unknown) {
    const data = parseInput(z.strictObject({ requestId: z.uuid(), action: z.enum(['DECLINE', 'CANCEL']) }), input)
    const row = await prisma.feedbackRequest.findFirst({
      where: {
        id: data.requestId,
        organization_id: ctx.organization.id,
        ...(data.action === 'DECLINE' ? { recipient_id: ctx.actor.userId } : { requester_id: ctx.actor.userId }),
      },
      select: { id: true },
    })
    if (!row) throw new NotFoundError('Feedback request')
    const { count } = await prisma.feedbackRequest.updateMany({
      where: { id: row.id, status: 'OPEN' },
      data: { status: data.action === 'DECLINE' ? 'DECLINED' : 'CANCELLED' },
    })
    if (!count) throw new ConflictError('This request is already closed')
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.FEEDBACK_REQUESTED,
      resourceType: 'feedback_request',
      resourceId: row.id,
      metadata: { closed: data.action },
    })
  },

  /** An open request addressed to the viewer (to pre-fill the give-feedback form). */
  async openRequest(ctx: RequestContext, requestId: string) {
    const row = await prisma.feedbackRequest.findFirst({
      where: { id: parseInput(z.uuid(), requestId), organization_id: ctx.organization.id, recipient_id: ctx.actor.userId, status: 'OPEN' },
      select: { id: true, question: true, context_type: true, context_id: true, intern_id: true, requester: { select: personSelect } },
    })
    if (!row) throw new NotFoundError('Feedback request')
    return row
  },
}

async function requestRecipients(intern: { manager_id: string | null; mentor_id: string | null }) {
  const ids = [intern.manager_id, intern.mentor_id].filter((x): x is string => Boolean(x))
  if (!ids.length) return []
  return prisma.user.findMany({
    where: { id: { in: ids }, status: 'ACTIVE', deleted_at: null },
    select: personSelect,
  })
}

export type FeedbackPage = Awaited<ReturnType<typeof feedbackService.page>>
export type FeedbackItem = FeedbackPage['feedback'][number]
