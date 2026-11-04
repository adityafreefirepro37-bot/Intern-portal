import 'server-only'
import type { AiActionStatus, Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { logger } from '@/lib/logging'
import { fullName } from '@/lib/utils/format'
import { isoDateSchema, parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { userScope } from '../repositories/scope'
import { AUDIT_ACTIONS } from '../services/audit-actions'
import { auditService } from '../services/audit.service'
import { authorizationService } from '../services/authorization.service'
import { rateLimitService } from '../services/rate-limit.service'
import { taskService } from '../services/task.service'
import { aiSettingsService } from './settings.service'

/**
 * AI action requests: the model may only *propose*. A proposal is stored,
 * validated and shown as a card; nothing runs until its owner confirms. On
 * confirmation the payload is validated again and executed through the normal
 * domain service, which re-checks permissions, writes its own audit entries and
 * sends its own notifications. Proposals expire after 15 minutes and run once.
 *
 * Decisions (approving leave, ratings, roles, termination, pay…) have no action
 * type here, so there is no code path by which the AI could perform them.
 */

const PROPOSAL_TTL_MS = 15 * 60 * 1000

const createTaskPayload = z.strictObject({
  title: z.string().trim().min(2, 'Enter a title').max(200),
  description: z.string().trim().max(2000).optional(),
  dueDate: isoDateSchema.optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  projectId: z.uuid().optional(),
  assigneeIds: z.array(z.uuid()).max(10).default([]),
})

const createSubtasksPayload = z.strictObject({
  parentTaskId: z.uuid(),
  titles: z.array(z.string().trim().min(2).max(200)).min(1).max(10),
})

export type AiActionType = 'create_task' | 'create_subtasks'
export type CreateTaskPayload = z.infer<typeof createTaskPayload>
export type CreateSubtasksPayload = z.infer<typeof createSubtasksPayload>

export interface PersonOption {
  id: string
  name: string
}

export interface ActionProposal {
  id: string
  type: AiActionType
  status: AiActionStatus
  expiresAt: string
  payload: CreateTaskPayload | CreateSubtasksPayload
  /** Names for the card (resolved on the server). */
  display: { assignees?: string[]; project?: string | null; parentTask?: string }
  warnings: string[]
  /** People who can be picked when editing the card. */
  assignees: PersonOption[]
  result?: { href?: string; message?: string } | null
  error?: string | null
}

/** People this user may assign outside a project (their task.assign scope). */
async function assignablePeople(ctx: RequestContext): Promise<PersonOption[]> {
  const scope = ctx.actor.permissions.get('task.assign')
  if (!scope) return []
  const rows = await prisma.user.findMany({
    where: { AND: [userScope(ctx.actor, scope), { status: 'ACTIVE', deleted_at: null }] },
    orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
    take: 200,
    select: { id: true, first_name: true, last_name: true, display_name: true },
  })
  return rows.map((row) => ({ id: row.id, name: fullName(row) }))
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()

/** Unique match on full or first name; anything ambiguous stays unresolved for the user to pick. */
export function matchPerson(name: string, people: PersonOption[]): PersonOption | null {
  const wanted = normalize(name)
  if (!wanted) return null
  const exact = people.filter((p) => normalize(p.name) === wanted)
  if (exact.length === 1) return exact[0]
  const partial = people.filter((p) => normalize(p.name).split(' ').includes(wanted) || normalize(p.name).startsWith(`${wanted} `))
  return partial.length === 1 ? partial[0] : null
}

async function toProposal(ctx: RequestContext, row: {
  id: string
  action_type: string
  status: AiActionStatus
  expires_at: Date
  payload: Prisma.JsonValue
  result: Prisma.JsonValue
  error: string | null
}): Promise<ActionProposal> {
  const stored = row.payload as unknown as { data: CreateTaskPayload | CreateSubtasksPayload; warnings?: string[]; display?: ActionProposal['display'] }
  const isTask = row.action_type === 'create_task'
  return {
    id: row.id,
    type: row.action_type as AiActionType,
    status: row.status,
    expiresAt: row.expires_at.toISOString(),
    payload: stored.data,
    display: stored.display ?? {},
    warnings: stored.warnings ?? [],
    assignees: isTask && row.status === 'PROPOSED' ? await assignablePeople(ctx) : [],
    result: (row.result as ActionProposal['result']) ?? null,
    error: row.error,
  }
}

export const aiActionService = {
  assignablePeople,

  /** Stores a validated proposal. Nothing is executed. */
  async propose(
    ctx: RequestContext,
    input: {
      type: AiActionType
      payload: unknown
      display?: ActionProposal['display']
      warnings?: string[]
      conversationId?: string | null
      messageId?: string | null
    },
  ): Promise<ActionProposal> {
    const settings = await aiSettingsService.get(ctx.organization.id)
    if (!settings.actions) throw new ForbiddenError('AI actions are turned off for your organization')
    let data: CreateTaskPayload | CreateSubtasksPayload
    if (input.type === 'create_task') {
      authorizationService.require(ctx, 'task.create')
      data = parseInput(createTaskPayload, input.payload)
    } else {
      const subtasks = parseInput(createSubtasksPayload, input.payload)
      const detail = await taskService.getDetail(ctx, subtasks.parentTaskId)
      if (!detail.can.createSubtasks) throw new ForbiddenError('You can’t add subtasks to this task')
      data = subtasks
    }
    const row = await prisma.aiActionRequest.create({
      data: {
        organization_id: ctx.organization.id,
        user_id: ctx.actor.userId,
        conversation_id: input.conversationId ?? null,
        message_id: input.messageId ?? null,
        action_type: input.type,
        payload: { data, warnings: input.warnings ?? [], display: input.display ?? {} } as unknown as Prisma.InputJsonValue,
        expires_at: new Date(Date.now() + PROPOSAL_TTL_MS),
      },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.AI_ACTION_PROPOSED,
      resourceType: 'ai_action_request',
      resourceId: row.id,
      metadata: { type: input.type },
    })
    await aiSettingsService.record(ctx, { feature: 'ACTION', conversationId: input.conversationId, intent: input.type, success: true })
    return toProposal(ctx, row)
  },

  /** Only the owner sees a proposal; anyone else gets 404. */
  async owned(ctx: RequestContext, id: string) {
    const actionId = parseInput(z.uuid(), id)
    const row = await prisma.aiActionRequest.findFirst({
      where: { id: actionId, organization_id: ctx.organization.id, user_id: ctx.actor.userId },
    })
    if (!row) throw new NotFoundError('Action')
    return row
  },

  async get(ctx: RequestContext, id: string) {
    return toProposal(ctx, await this.owned(ctx, id))
  },

  /**
   * Claims a PROPOSED row exactly once (a double click, replay or second tab
   * can't execute twice), merges the user's edits, re-validates and executes.
   */
  async confirm(ctx: RequestContext, id: string, edits: Record<string, string> = {}): Promise<ActionProposal> {
    await rateLimitService.consume('aiAction', ctx.actor.userId)
    const row = await this.owned(ctx, id)
    if (row.status !== 'PROPOSED') throw new ConflictError('This proposal has already been handled')
    if (row.expires_at.getTime() < Date.now()) {
      await prisma.aiActionRequest.updateMany({ where: { id: row.id, status: 'PROPOSED' }, data: { status: 'EXPIRED' } })
      throw new ConflictError('This proposal has expired. Ask AYAVA AI again.')
    }
    const stored = row.payload as unknown as { data: Record<string, unknown>; warnings?: string[]; display?: ActionProposal['display'] }
    let data: CreateTaskPayload | CreateSubtasksPayload
    let display = stored.display ?? {}
    if (row.action_type === 'create_task') {
      const base = stored.data as CreateTaskPayload
      const assigneeIds = edits.assigneeId === undefined ? base.assigneeIds : edits.assigneeId ? [edits.assigneeId] : []
      data = parseInput(createTaskPayload, {
        ...base,
        ...(edits.title !== undefined ? { title: edits.title } : {}),
        ...(edits.priority ? { priority: edits.priority } : {}),
        ...(edits.dueDate !== undefined ? { dueDate: edits.dueDate || undefined } : {}),
        assigneeIds,
      })
      if (edits.assigneeId !== undefined) {
        const people = await assignablePeople(ctx)
        display = { ...display, assignees: assigneeIds.map((a) => people.find((p) => p.id === a)?.name ?? 'Selected person') }
      }
    } else if (row.action_type === 'create_subtasks') {
      data = parseInput(createSubtasksPayload, stored.data)
    } else {
      throw new ValidationError('Unknown action')
    }

    const claim = await prisma.aiActionRequest.updateMany({
      where: { id: row.id, status: 'PROPOSED' },
      data: {
        status: 'CONFIRMED',
        confirmed_at: new Date(),
        payload: { ...stored, data, display } as unknown as Prisma.InputJsonValue,
      },
    })
    if (claim.count !== 1) throw new ConflictError('This proposal has already been handled')
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.AI_ACTION_CONFIRMED,
      resourceType: 'ai_action_request',
      resourceId: row.id,
      metadata: { type: row.action_type },
    })

    try {
      const result = await this.execute(ctx, row.action_type as AiActionType, data)
      const done = await prisma.aiActionRequest.update({
        where: { id: row.id },
        data: { status: 'EXECUTED', executed_at: new Date(), result: result as Prisma.InputJsonValue },
      })
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.AI_ACTION_EXECUTED,
        resourceType: 'ai_action_request',
        resourceId: row.id,
        metadata: { type: row.action_type, created: result.created },
      })
      return toProposal(ctx, done)
    } catch (error) {
      const message = error instanceof AppError && error.status < 500 ? error.message : 'The action could not be completed.'
      if (!(error instanceof AppError) || error.status >= 500) logger.error('AI action failed', { actionId: row.id, error })
      const failed = await prisma.aiActionRequest.update({ where: { id: row.id }, data: { status: 'FAILED', error: message } })
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.AI_ACTION_FAILED,
        resourceType: 'ai_action_request',
        resourceId: row.id,
        status: 'FAILURE',
        metadata: { type: row.action_type, error: message },
      })
      return toProposal(ctx, failed)
    }
  },

  /** Runs through taskService: its permission checks, audit entries and notifications all apply. */
  async execute(ctx: RequestContext, type: AiActionType, data: CreateTaskPayload | CreateSubtasksPayload) {
    if (type === 'create_task') {
      const task = data as CreateTaskPayload
      const created = await taskService.create(ctx, {
        title: task.title,
        description: task.description,
        projectId: task.projectId,
        priority: task.priority,
        dueDate: task.dueDate,
        assigneeIds: task.assigneeIds,
      })
      return { created: 1, href: `/tasks/${created.id}`, message: 'Task created.' }
    }
    const { parentTaskId, titles } = data as CreateSubtasksPayload
    for (const title of titles) await taskService.create(ctx, { title, parentTaskId, assigneeIds: [] })
    return { created: titles.length, href: `/tasks/${parentTaskId}`, message: `${titles.length} subtasks added.` }
  },

  async cancel(ctx: RequestContext, id: string): Promise<ActionProposal> {
    const row = await this.owned(ctx, id)
    if (row.status !== 'PROPOSED') throw new ConflictError('This proposal has already been handled')
    const claim = await prisma.aiActionRequest.updateMany({ where: { id: row.id, status: 'PROPOSED' }, data: { status: 'CANCELLED' } })
    if (claim.count !== 1) throw new ConflictError('This proposal has already been handled')
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.AI_ACTION_CANCELLED,
      resourceType: 'ai_action_request',
      resourceId: row.id,
      metadata: { type: row.action_type },
    })
    return toProposal(ctx, { ...row, status: 'CANCELLED' })
  },
}
