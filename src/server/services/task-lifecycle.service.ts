import type { Prisma, TaskStatus } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, ForbiddenError, ValidationError } from '@/lib/errors'
import { OPEN_PROJECT_STATUSES } from '@/lib/work/projects'
import { CLOSED_STATUSES, findTransition, TASK_STATUS_LABELS, TASK_STATUSES } from '@/lib/work/tasks'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { projectProgressService } from './project-progress.service'
import { resolveTaskAccess } from './work-access'

type Tx = Prisma.TransactionClient

export const transitionTaskSchema = z.strictObject({
  taskId: z.uuid(),
  to: z.enum(TASK_STATUSES as [TaskStatus, ...TaskStatus[]]),
  reason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => value || undefined),
})

interface TransitionTarget {
  id: string
  status: TaskStatus
  project_id: string | null
  milestone_id: string | null
}

/**
 * Writes a status change with optimistic concurrency (only if the status is
 * still `from`) and the lifecycle bookkeeping: previous status, blocker
 * reason, first start time, completion time (cleared on reopen), updater.
 * Shared by manual transitions and the submission/review workflow.
 */
export async function writeTransition(
  tx: Tx,
  task: TransitionTarget,
  to: TaskStatus,
  actorUserId: string,
  reason?: string,
) {
  const now = new Date()
  const current = await tx.task.findUniqueOrThrow({ where: { id: task.id }, select: { started_at: true } })
  const { count } = await tx.task.updateMany({
    where: { id: task.id, status: task.status, deleted_at: null },
    data: {
      status: to,
      previous_status: task.status,
      updated_by: actorUserId,
      blocked_reason: to === 'BLOCKED' ? (reason ?? null) : null,
      ...(to === 'IN_PROGRESS' && !current.started_at ? { started_at: now } : {}),
      ...(to === 'COMPLETED' ? { completed_at: now } : task.status === 'COMPLETED' ? { completed_at: null } : {}),
    },
  })
  if (count === 0) throw new ConflictError('This task just changed. Refresh and try again.')
  // A milestone becomes active when work on it starts.
  if (to === 'IN_PROGRESS' && task.milestone_id) {
    await tx.milestone.updateMany({ where: { id: task.milestone_id, status: 'UPCOMING' }, data: { status: 'ACTIVE' } })
  }
}

/** Audit + progress + event after a committed status change. */
export async function afterTransition(
  ctx: RequestContext,
  task: TransitionTarget,
  from: TaskStatus,
  to: TaskStatus,
  meta: { reason?: string; via?: 'manual' | 'submission' | 'review' } = {},
) {
  if (task.project_id && (CLOSED_STATUSES.includes(to) || CLOSED_STATUSES.includes(from))) {
    await projectProgressService.recompute(task.project_id)
  }
  await auditService.logForContext(ctx, {
    action: AUDIT_ACTIONS.TASK_STATUS_CHANGED,
    resourceType: 'task',
    resourceId: task.id,
    metadata: { projectId: task.project_id, from, to, reason: meta.reason, via: meta.via ?? 'manual' },
  })
  await domainEvents.emit('task.status_changed', {
    organizationId: ctx.organization.id,
    actorUserId: ctx.actor.userId,
    payload: { taskId: task.id, projectId: task.project_id, from, to },
  })
}

/**
 * The single entry point for manual task status changes (buttons, menus,
 * board drag-and-drop, bulk actions). Review-driven statuses go through
 * taskSubmissionService instead.
 */
export const taskLifecycleService = {
  async transitionStatus(ctx: RequestContext, input: unknown) {
    const data = parseInput(transitionTaskSchema, input)
    const access = await resolveTaskAccess(ctx, data.taskId)
    const { task } = access
    const from = task.status
    if (from === data.to) return { from, to: data.to, changed: false }

    const rule = findTransition(from, data.to)
    if (!rule) {
      throw new ValidationError(`A task can’t move from ${TASK_STATUS_LABELS[from]} to ${TASK_STATUS_LABELS[data.to]}`)
    }
    if (rule.by.length === 1 && rule.by[0] === 'review') {
      throw new ValidationError(
        data.to === 'IN_REVIEW'
          ? 'Submit the work for review instead of moving it'
          : 'Use Approve or Request changes to review this task',
      )
    }
    if (!rule.by.some((actor) => access.actors.includes(actor))) {
      throw new ForbiddenError('You can’t move this task to that status')
    }
    if (rule.reason && !data.reason) throw new ValidationError('Give a reason for this change', { reason: 'Required' })
    if (task.project && !OPEN_PROJECT_STATUSES.includes(task.project.status)) {
      throw new ValidationError('This project is closed. Reopen it to change its tasks.')
    }

    if (data.to === 'ASSIGNED' && task.assignees.length === 0) {
      throw new ValidationError('Assign someone before moving the task to Assigned')
    }
    if (data.to === 'IN_PROGRESS' && from !== 'COMPLETED') {
      const blockers = await prisma.taskDependency.findMany({
        where: {
          task_id: task.id,
          depends_on: { deleted_at: null, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        },
        select: { depends_on: { select: { title: true } } },
      })
      if (blockers.length > 0) {
        throw new ValidationError(
          `Waiting on ${blockers.map((b) => `“${b.depends_on.title}”`).join(', ')} to be completed first`,
        )
      }
    }
    if (data.to === 'COMPLETED') {
      const openSubtasks = await prisma.task.count({
        where: { parent_task_id: task.id, deleted_at: null, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      })
      if (openSubtasks > 0) throw new ValidationError('Finish or cancel the subtasks first')
    }

    await prisma.$transaction((tx) => writeTransition(tx, task, data.to, ctx.actor.userId, data.reason))
    await afterTransition(ctx, task, from, data.to, { reason: data.reason })
    return { from, to: data.to, changed: true }
  },
}
