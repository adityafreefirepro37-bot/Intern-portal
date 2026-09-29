import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { addDays, formatDateOnly, parseDateOnly, todayIn } from '@/lib/interns/dates'
import { isoDateSchema, parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditProject } from './project.service'
import { resolveProjectAccess } from './work-access'

const optionalDate = z
  .string()
  .optional()
  .transform((value) => value || undefined)
  .pipe(isoDateSchema.optional())

export const milestoneSchema = z
  .strictObject({
    name: z.string().trim().min(2, 'Enter a name').max(120),
    description: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((value) => value || undefined),
    startDate: optionalDate,
    dueDate: optionalDate,
  })
  .refine((v) => !v.startDate || !v.dueDate || v.dueDate >= v.startDate, {
    message: 'The due date must be on or after the start date',
    path: ['dueDate'],
  })

async function loadForEdit(ctx: RequestContext, milestoneId: string) {
  const milestone = await prisma.milestone.findFirst({
    where: { id: parseInput(z.uuid(), milestoneId), project: { organization_id: ctx.organization.id } },
    select: { id: true, project_id: true, name: true, status: true, position: true },
  })
  if (!milestone) throw new NotFoundError('Milestone')
  const access = await resolveProjectAccess(ctx, milestone.project_id).catch(() => {
    throw new NotFoundError('Milestone')
  })
  if (!access.can.manageMilestones) throw new ForbiddenError('You can’t manage this project’s milestones')
  return { milestone, access }
}

/**
 * Milestones break a project into stages. Progress is computed from their
 * top-level tasks; OVERDUE is derived from the due date at read time.
 * UPCOMING becomes ACTIVE automatically when work on one of its tasks starts;
 * completing a milestone is an explicit decision by a project lead.
 */
export const milestoneService = {
  async create(ctx: RequestContext, projectId: string, input: unknown) {
    const access = await resolveProjectAccess(ctx, parseInput(z.uuid(), projectId))
    if (!access.can.manageMilestones) throw new ForbiddenError('You can’t manage this project’s milestones')
    const data = parseInput(milestoneSchema, input)
    const last = await prisma.milestone.aggregate({
      where: { project_id: access.project.id },
      _max: { position: true },
    })
    const milestone = await prisma.milestone.create({
      data: {
        project_id: access.project.id,
        name: data.name,
        description: data.description ?? null,
        start_date: data.startDate ? parseDateOnly(data.startDate) : null,
        due_date: data.dueDate ? parseDateOnly(data.dueDate) : null,
        position: (last._max.position ?? -1) + 1,
      },
      select: { id: true },
    })
    await auditProject(
      ctx,
      AUDIT_ACTIONS.MILESTONE_CREATED,
      access.project.id,
      { name: data.name },
      {
        type: 'milestone',
        id: milestone.id,
      },
    )
    return milestone
  },

  async update(ctx: RequestContext, milestoneId: string, input: unknown) {
    const { milestone, access } = await loadForEdit(ctx, milestoneId)
    const data = parseInput(milestoneSchema, input)
    await prisma.milestone.update({
      where: { id: milestone.id },
      data: {
        name: data.name,
        description: data.description ?? null,
        start_date: data.startDate ? parseDateOnly(data.startDate) : null,
        due_date: data.dueDate ? parseDateOnly(data.dueDate) : null,
      },
    })
    await auditProject(
      ctx,
      AUDIT_ACTIONS.MILESTONE_UPDATED,
      access.project.id,
      { name: data.name },
      {
        type: 'milestone',
        id: milestone.id,
      },
    )
  },

  /** complete | reopen | cancel | up | down | delete */
  async command(ctx: RequestContext, input: unknown) {
    const data = parseInput(
      z.strictObject({
        milestoneId: z.uuid(),
        command: z.enum(['complete', 'reopen', 'cancel', 'up', 'down', 'delete']),
      }),
      input,
    )
    const { milestone, access } = await loadForEdit(ctx, data.milestoneId)
    const ref = { type: 'milestone', id: milestone.id }
    switch (data.command) {
      case 'complete': {
        if (milestone.status === 'COMPLETED') return
        const open = await prisma.task.count({
          where: { milestone_id: milestone.id, deleted_at: null, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        })
        if (open > 0)
          throw new ValidationError(`${open} task${open === 1 ? ' is' : 's are'} still open in this milestone`)
        await prisma.milestone.update({
          where: { id: milestone.id },
          data: { status: 'COMPLETED', completed_at: new Date() },
        })
        await auditProject(ctx, AUDIT_ACTIONS.MILESTONE_COMPLETED, access.project.id, { name: milestone.name }, ref)
        return
      }
      case 'reopen':
        await prisma.milestone.update({ where: { id: milestone.id }, data: { status: 'ACTIVE', completed_at: null } })
        await auditProject(
          ctx,
          AUDIT_ACTIONS.MILESTONE_UPDATED,
          access.project.id,
          { name: milestone.name, status: 'ACTIVE' },
          ref,
        )
        return
      case 'cancel':
        await prisma.milestone.update({ where: { id: milestone.id }, data: { status: 'CANCELLED' } })
        await auditProject(
          ctx,
          AUDIT_ACTIONS.MILESTONE_UPDATED,
          access.project.id,
          { name: milestone.name, status: 'CANCELLED' },
          ref,
        )
        return
      case 'delete':
        // Tasks keep existing; their milestone link is cleared (ON DELETE SET NULL).
        await prisma.milestone.delete({ where: { id: milestone.id } })
        await auditProject(
          ctx,
          AUDIT_ACTIONS.MILESTONE_UPDATED,
          access.project.id,
          { name: milestone.name, deleted: true },
          ref,
        )
        return
      case 'up':
      case 'down': {
        const all = await prisma.milestone.findMany({
          where: { project_id: milestone.project_id },
          orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
          select: { id: true },
        })
        const index = all.findIndex((m) => m.id === milestone.id)
        const swap = data.command === 'up' ? index - 1 : index + 1
        if (swap < 0 || swap >= all.length) return
        ;[all[index], all[swap]] = [all[swap], all[index]]
        await prisma.$transaction(
          all.map((m, position) => prisma.milestone.update({ where: { id: m.id }, data: { position } })),
        )
        return
      }
    }
  },

  /** Daily job: milestones due tomorrow → project.milestone_due (once per milestone per due date). */
  async emitDueSoon(options: { organizationId?: string; now?: Date } = {}) {
    const organizations = await prisma.organization.findMany({
      where: options.organizationId ? { id: options.organizationId } : {},
      select: { id: true, timezone: true },
    })
    let emitted = 0
    for (const org of organizations) {
      const tomorrow = addDays(todayIn(org.timezone, options.now), 1)
      const milestones = await prisma.milestone.findMany({
        where: {
          due_date: tomorrow,
          status: { in: ['UPCOMING', 'ACTIVE'] },
          project: { organization_id: org.id, deleted_at: null, status: { in: ['PLANNING', 'ACTIVE'] } },
        },
        select: { id: true, project_id: true, due_date: true },
      })
      for (const milestone of milestones) {
        emitted += 1
        await domainEvents.emit('project.milestone_due', {
          organizationId: org.id,
          actorUserId: null,
          payload: {
            projectId: milestone.project_id,
            milestoneId: milestone.id,
            dueDate: formatDateOnly(milestone.due_date!),
          },
        })
      }
    }
    return { emitted }
  },
}
