import type { HrRequestCategory, HrRequestStatus, Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import {
  HR_REQUEST_CATEGORIES,
  HR_REQUEST_STATUSES,
  isClosed,
  requesterCanCancel,
  staffTargets,
} from '@/lib/hr/requests'
import { getStorageService } from '@/lib/storage'
import { fullName } from '@/lib/utils/format'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { optionalText, optionalUuid, personSelect } from './hr-shared'
import { usersWithPermission } from './notification.service'
import { skipTake, toPage } from './pagination'

/**
 * HR requests (helpdesk): anyone raises a request about their own records;
 * HR (hr_request.manage) triages, asks for information, approves/rejects and
 * resolves. Requesters see only their own requests.
 */

const MAX_FILES = 3

const createSchema = z.strictObject({
  category: z.enum(HR_REQUEST_CATEGORIES as [HrRequestCategory, ...HrRequestCategory[]]),
  subject: z.string().trim().min(3, 'Add a short subject').max(200),
  description: z.string().trim().min(1, 'Describe what you need').max(5000),
})

const commentSchema = z.strictObject({
  requestId: z.uuid(),
  body: z.string().trim().min(1, 'Write a message').max(5000),
})

const transitionSchema = z
  .strictObject({
    requestId: z.uuid(),
    to: z.enum(HR_REQUEST_STATUSES as [HrRequestStatus, ...HrRequestStatus[]]),
    note: optionalText(2000),
  })
  .refine((value) => !['REJECTED', 'WAITING_FOR_USER'].includes(value.to) || value.note, {
    message: 'Add a note explaining the decision or what you need',
    path: ['note'],
  })

const assignSchema = z.strictObject({ requestId: z.uuid(), assigneeId: optionalUuid })

export const requestQuerySchema = z.object({
  status: z
    .enum([...(HR_REQUEST_STATUSES as [HrRequestStatus, ...HrRequestStatus[]]), 'ACTIVE'])
    .optional()
    .catch(undefined),
  category: z
    .enum(HR_REQUEST_CATEGORIES as [HrRequestCategory, ...HrRequestCategory[]])
    .optional()
    .catch(undefined),
  assignee: z.enum(['me', 'none']).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
})

const listSelect = {
  id: true,
  category: true,
  subject: true,
  status: true,
  created_at: true,
  updated_at: true,
  requester_id: true,
  requester: { select: personSelect },
  assignee: { select: personSelect },
  _count: { select: { comments: true, attachments: { where: { deleted_at: null } } } },
} as const satisfies Prisma.HrRequestSelect

/** org-wide readers see everything; everyone else only their own requests. */
function readWhere(ctx: RequestContext): Prisma.HrRequestWhereInput {
  const scope = authorizationService.require(ctx, 'hr_request.read')
  return {
    organization_id: ctx.organization.id,
    deleted_at: null,
    ...(scope === 'ORGANIZATION' ? {} : { requester_id: ctx.actor.userId }),
  }
}

async function load(ctx: RequestContext, requestId: string) {
  const id = parseInput(z.uuid(), requestId)
  const request = await prisma.hrRequest.findFirst({
    where: { id, ...readWhere(ctx) },
    select: {
      id: true,
      category: true,
      subject: true,
      description: true,
      status: true,
      resolution: true,
      resolved_at: true,
      created_at: true,
      updated_at: true,
      requester_id: true,
      assigned_to: true,
      requester: { select: { ...personSelect, email: true } },
      assignee: { select: personSelect },
      resolver: { select: personSelect },
    },
  })
  if (!request) throw new NotFoundError('Request')
  return request
}

async function storeFiles(organizationId: string, files: { name: string; type: string; bytes: Uint8Array }[]) {
  const storage = getStorageService()
  const stored = []
  try {
    for (const file of files) {
      stored.push(
        await storage.upload({
          organizationId,
          category: 'document',
          fileName: file.name,
          mimeType: file.type,
          data: file.bytes,
        }),
      )
    }
  } catch (error) {
    await Promise.all(stored.map((s) => storage.delete(s.storagePath).catch(() => undefined)))
    throw error
  }
  return stored
}

export const hrRequestService = {
  async list(ctx: RequestContext, rawQuery: unknown, options: { mine?: boolean } = {}) {
    const base = readWhere(ctx)
    const query = requestQuerySchema.parse(rawQuery ?? {})
    const where: Prisma.HrRequestWhereInput = {
      ...base,
      ...(options.mine ? { requester_id: ctx.actor.userId } : {}),
      ...(query.status === 'ACTIVE'
        ? { status: { in: ['OPEN', 'IN_REVIEW', 'WAITING_FOR_USER', 'APPROVED'] } }
        : query.status
          ? { status: query.status }
          : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.assignee === 'me' ? { assigned_to: ctx.actor.userId } : {}),
      ...(query.assignee === 'none' ? { assigned_to: null } : {}),
    }
    const pagination = { page: query.page, pageSize: 25 }
    const [rows, total, counts] = await Promise.all([
      prisma.hrRequest.findMany({
        where,
        orderBy: { updated_at: 'desc' },
        ...skipTake(pagination),
        select: listSelect,
      }),
      prisma.hrRequest.count({ where }),
      prisma.hrRequest.groupBy({
        by: ['status'],
        where: { ...base, ...(options.mine ? { requester_id: ctx.actor.userId } : {}) },
        _count: { _all: true },
      }),
    ])
    const count = (status: HrRequestStatus) => counts.find((c) => c.status === status)?._count._all ?? 0
    return {
      query,
      stats: {
        open: count('OPEN'),
        inReview: count('IN_REVIEW'),
        waiting: count('WAITING_FOR_USER'),
        closed: count('RESOLVED') + count('REJECTED') + count('CANCELLED'),
      },
      page: toPage(
        rows.map((row) => ({
          ...row,
          requesterName: fullName(row.requester),
          assigneeName: row.assignee ? fullName(row.assignee) : null,
        })),
        total,
        pagination,
      ),
    }
  },

  async get(ctx: RequestContext, requestId: string) {
    const request = await load(ctx, requestId)
    const canManage = authorizationService.scopeOf(ctx, 'hr_request.manage') === 'ORGANIZATION'
    const isRequester = request.requester_id === ctx.actor.userId
    const [comments, attachments, handlers] = await Promise.all([
      prisma.hrRequestComment.findMany({
        where: { request_id: request.id },
        orderBy: { created_at: 'asc' },
        select: { id: true, body: true, created_at: true, author_id: true, author: { select: personSelect } },
      }),
      prisma.hrRequestAttachment.findMany({
        where: { request_id: request.id, deleted_at: null },
        orderBy: { created_at: 'asc' },
        select: { id: true, file_name: true, file_size: true, mime_type: true, created_at: true, uploaded_by: true },
      }),
      canManage
        ? usersWithPermission(ctx.organization.id, 'hr_request.manage').then((ids) =>
            prisma.user.findMany({
              where: { id: { in: ids } },
              orderBy: { first_name: 'asc' },
              select: personSelect,
            }),
          )
        : Promise.resolve([]),
    ])
    return {
      ...request,
      requesterName: fullName(request.requester),
      comments: comments.map((c) => ({
        ...c,
        authorName: fullName(c.author),
        fromRequester: c.author_id === request.requester_id,
      })),
      attachments,
      handlers: handlers.map((h) => ({ id: h.id, name: fullName(h) })),
      can: {
        manage: canManage && !isRequester,
        comment: (canManage || isRequester) && !isClosed(request.status),
        cancel: isRequester && requesterCanCancel(request.status),
        attach: (canManage || isRequester) && !isClosed(request.status),
      },
      targets: canManage && !isRequester ? staffTargets(request.status) : [],
      isRequester,
    }
  },

  async create(ctx: RequestContext, input: unknown, files: { name: string; type: string; bytes: Uint8Array }[] = []) {
    authorizationService.require(ctx, 'hr_request.create')
    const data = parseInput(createSchema, input)
    const uploads = files.filter((f) => f.bytes.byteLength > 0)
    if (uploads.length > MAX_FILES)
      throw new ValidationError(`Attach at most ${MAX_FILES} files`, { files: 'Too many files' })
    const stored = await storeFiles(ctx.organization.id, uploads)
    const request = await prisma.hrRequest.create({
      data: {
        organization_id: ctx.organization.id,
        requester_id: ctx.actor.userId,
        category: data.category,
        subject: data.subject,
        description: data.description,
        attachments: {
          create: stored.map((s) => ({
            uploaded_by: ctx.actor.userId,
            file_name: s.fileName,
            storage_path: s.storagePath,
            mime_type: s.mimeType,
            file_size: s.fileSize,
          })),
        },
      },
      select: { id: true },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.HR_REQUEST_CREATED,
      resourceType: 'hr_request',
      resourceId: request.id,
      metadata: { category: data.category, attachments: stored.length },
    })
    await domainEvents.emit('hr_request.created', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { requestId: request.id },
    })
    return request
  },

  async comment(ctx: RequestContext, input: unknown, files: { name: string; type: string; bytes: Uint8Array }[] = []) {
    const data = parseInput(commentSchema, input)
    const view = await this.get(ctx, data.requestId)
    if (!view.can.comment) throw new ForbiddenError('This request is closed')
    const uploads = files.filter((f) => f.bytes.byteLength > 0)
    if (view.attachments.length + uploads.length > 10) throw new ValidationError('A request can hold at most 10 files')
    const stored = await storeFiles(ctx.organization.id, uploads)
    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.hrRequestComment.create({
        data: { request_id: view.id, author_id: ctx.actor.userId, body: data.body },
        select: { id: true },
      })
      if (stored.length) {
        await tx.hrRequestAttachment.createMany({
          data: stored.map((s) => ({
            request_id: view.id,
            uploaded_by: ctx.actor.userId,
            file_name: s.fileName,
            storage_path: s.storagePath,
            mime_type: s.mimeType,
            file_size: s.fileSize,
          })),
        })
      }
      // The requester answering brings a "waiting for you" request back to HR.
      await tx.hrRequest.update({
        where: { id: view.id },
        data:
          view.isRequester && view.status === 'WAITING_FOR_USER' ? { status: 'IN_REVIEW' } : { updated_at: new Date() },
      })
      return created
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.HR_REQUEST_COMMENTED,
      resourceType: 'hr_request',
      resourceId: view.id,
      metadata: { commentId: comment.id, attachments: stored.length },
    })
    await domainEvents.emit('hr_request.commented', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { requestId: view.id, commentId: comment.id, byRequester: view.isRequester },
    })
  },

  async transition(ctx: RequestContext, input: unknown) {
    const data = parseInput(transitionSchema, input)
    const view = await this.get(ctx, data.requestId)
    if (data.to === 'CANCELLED') {
      if (!view.can.cancel) throw new ForbiddenError('Only the requester can cancel an open request')
    } else {
      if (!view.can.manage) throw new ForbiddenError()
      if (!view.targets.includes(data.to))
        throw new ConflictError(`A ${view.status.toLowerCase()} request can’t move there`)
    }
    const closing = ['APPROVED', 'REJECTED', 'RESOLVED'].includes(data.to)
    const { count } = await prisma.$transaction(async (tx) => {
      const updated = await tx.hrRequest.updateMany({
        where: { id: view.id, status: view.status },
        data: {
          status: data.to,
          ...(closing
            ? { resolution: data.note ?? view.resolution, resolved_at: new Date(), resolved_by: ctx.actor.userId }
            : { resolved_at: null, resolved_by: null }),
          ...(data.to === 'IN_REVIEW' && !view.assigned_to ? { assigned_to: ctx.actor.userId } : {}),
        },
      })
      if (updated.count && data.note) {
        await tx.hrRequestComment.create({
          data: { request_id: view.id, author_id: ctx.actor.userId, body: data.note },
        })
      }
      return updated
    })
    if (!count) throw new ConflictError('This request changed — refresh and try again')
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.HR_REQUEST_UPDATED,
      resourceType: 'hr_request',
      resourceId: view.id,
      metadata: { before: view.status, after: data.to, note: data.note },
    })
    await domainEvents.emit('hr_request.updated', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { requestId: view.id, from: view.status, to: data.to },
    })
  },

  async assign(ctx: RequestContext, input: unknown) {
    const data = parseInput(assignSchema, input)
    const view = await this.get(ctx, data.requestId)
    if (!view.can.manage) throw new ForbiddenError()
    if (data.assigneeId && !view.handlers.some((h) => h.id === data.assigneeId)) {
      throw new ValidationError('Choose someone who handles HR requests', { assigneeId: 'Not an HR handler' })
    }
    await prisma.hrRequest.update({ where: { id: view.id }, data: { assigned_to: data.assigneeId ?? null } })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.HR_REQUEST_UPDATED,
      resourceType: 'hr_request',
      resourceId: view.id,
      metadata: { before: { assignee: view.assigned_to }, after: { assignee: data.assigneeId ?? null } },
    })
  },

  async attachment(ctx: RequestContext, attachmentId: string) {
    const id = parseInput(z.uuid(), attachmentId)
    const file = await prisma.hrRequestAttachment.findFirst({
      where: { id, deleted_at: null, request: readWhere(ctx) },
      select: { file_name: true, mime_type: true, storage_path: true },
    })
    if (!file) throw new NotFoundError('Attachment')
    const bytes = await getStorageService().download(file.storage_path)
    return { bytes, fileName: file.file_name, mimeType: file.mime_type }
  },

  async openCount(ctx: RequestContext) {
    if (authorizationService.scopeOf(ctx, 'hr_request.manage') !== 'ORGANIZATION') return null
    return prisma.hrRequest.count({
      where: { organization_id: ctx.organization.id, deleted_at: null, status: { in: ['OPEN', 'IN_REVIEW'] } },
    })
  },
}

export type HrRequestDetail = Awaited<ReturnType<typeof hrRequestService.get>>
export type HrRequestList = Awaited<ReturnType<typeof hrRequestService.list>>
