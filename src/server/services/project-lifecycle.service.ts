import type { ProjectStatus } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, ForbiddenError, ValidationError } from '@/lib/errors'
import {
  canTransitionProject,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUSES,
  projectTransitionNeedsReason,
} from '@/lib/work/projects'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditProject } from './project.service'
import { projectProgressService } from './project-progress.service'
import { resolveProjectAccess } from './work-access'

export const projectTransitionSchema = z.strictObject({
  projectId: z.uuid(),
  to: z.enum(PROJECT_STATUSES as [ProjectStatus, ...ProjectStatus[]]),
  reason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => value || undefined),
})

/**
 * The single entry point for project status changes. Validates the
 * transition, permission (edit, or owner-level `project.delete` to archive)
 * and reason; guards against concurrent changes; records the audit entry and
 * emits project.status_changed.
 */
export const projectLifecycleService = {
  async transitionStatus(ctx: RequestContext, input: unknown) {
    const data = parseInput(projectTransitionSchema, input)
    const access = await resolveProjectAccess(ctx, data.projectId)
    const from = access.project.status
    if (from === data.to) return { from, to: data.to, changed: false }
    const allowed = data.to === 'ARCHIVED' ? access.can.archive || access.can.changeStatus : access.can.changeStatus
    if (!allowed) throw new ForbiddenError('You can’t change this project’s status')
    if (!canTransitionProject(from, data.to)) {
      throw new ValidationError(
        `A project can’t move from ${PROJECT_STATUS_LABELS[from]} to ${PROJECT_STATUS_LABELS[data.to]}`,
      )
    }
    if (projectTransitionNeedsReason(from, data.to) && !data.reason) {
      throw new ValidationError('Give a reason for this change', { reason: 'Required' })
    }
    if (data.to === 'COMPLETED') {
      const open = await prisma.task.count({
        where: { project_id: access.project.id, deleted_at: null, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      })
      if (open > 0) throw new ValidationError(`Finish or cancel the ${open} open task${open === 1 ? '' : 's'} first`)
    }
    const { count } = await prisma.project.updateMany({
      where: { id: access.project.id, status: from },
      data: {
        status: data.to,
        ...(data.to === 'COMPLETED'
          ? { completed_at: new Date() }
          : from === 'COMPLETED'
            ? { completed_at: null }
            : {}),
      },
    })
    if (count === 0) throw new ConflictError('This project just changed. Refresh and try again.')
    await projectProgressService.recompute(access.project.id)
    await auditProject(ctx, AUDIT_ACTIONS.PROJECT_STATUS_CHANGED, access.project.id, {
      from,
      to: data.to,
      reason: data.reason,
    })
    await domainEvents.emit('project.status_changed', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { projectId: access.project.id, from, to: data.to },
    })
    return { from, to: data.to, changed: true }
  },
}
