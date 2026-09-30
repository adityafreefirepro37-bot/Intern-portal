import type { OffboardingItemStatus } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { parseEndingWindow, type EndingWindow } from '@/lib/hr/operations'
import { addDays, daysBetween, todayIn } from '@/lib/interns/dates'
import { fullName } from '@/lib/utils/format'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { lifecycleRepository } from '../repositories/lifecycle.repository'
import { internScope } from '../repositories/scope'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { completionByIntern } from './document.service'
import { optionalText, personSelect } from './hr-shared'
import { resolveInternAccess, scopeCovers } from './intern-access'
import { settingsService } from './settings.service'

/**
 * Ending internships and offboarding preparation. This is the foundation:
 * a per-intern checklist plus the facts HR needs before an internship ends
 * (open work, documents, certificate). Exit interviews, certificates and
 * experience letters are generated in later phases.
 */

const OPEN_TASK = { notIn: ['COMPLETED', 'CANCELLED'] as ('COMPLETED' | 'CANCELLED')[] }

const itemSchema = z.strictObject({
  itemId: z.uuid(),
  status: z.enum(['PENDING', 'DONE', 'SKIPPED']),
  note: optionalText(500),
})

export const offboardingService = {
  /**
   * Interns whose internship ends within `window` days (or has passed its end
   * date while still active), with the open work and paperwork to wrap up.
   */
  async endingSoon(ctx: RequestContext, windowInput?: unknown) {
    const scope = authorizationService.require(ctx, 'offboarding.read')
    const window: EndingWindow = parseEndingWindow(windowInput)
    const today = todayIn(ctx.organization.timezone)
    const interns = await prisma.intern.findMany({
      where: {
        AND: [
          internScope(ctx.actor, scope),
          {
            deleted_at: null,
            status: { in: ['ACTIVE', 'ENDING_SOON'] },
            expected_end_date: { not: null, lte: addDays(today, window) },
          },
        ],
      },
      orderBy: { expected_end_date: 'asc' },
      select: {
        id: true,
        user_id: true,
        employee_code: true,
        status: true,
        expected_end_date: true,
        user: { select: personSelect },
        department: { select: { name: true } },
        manager: { select: personSelect },
        certificates: { orderBy: { created_at: 'desc' }, take: 1, select: { status: true, certificate_type: true } },
        offboarding: {
          select: { id: true, completed_at: true, items: { select: { status: true } } },
        },
      },
    })
    const ids = interns.map((i) => i.id)
    const userIds = interns.map((i) => i.user_id)
    const [openTasks, documents] = await Promise.all([
      prisma.taskAssignee.groupBy({
        by: ['user_id'],
        where: { user_id: { in: userIds }, task: { status: OPEN_TASK, deleted_at: null } },
        _count: { _all: true },
      }),
      completionByIntern(ctx.organization.id, ids, today),
    ])
    const canManage = authorizationService.can(ctx, 'offboarding.manage')
    return {
      window,
      today,
      rows: interns.map((intern) => {
        const items = intern.offboarding?.items ?? []
        const done = items.filter((i) => i.status !== 'PENDING').length
        return {
          id: intern.id,
          code: intern.employee_code,
          status: intern.status,
          name: fullName(intern.user),
          user: intern.user,
          department: intern.department?.name ?? null,
          manager: intern.manager ? fullName(intern.manager) : null,
          endDate: intern.expected_end_date!,
          daysLeft: daysBetween(today, intern.expected_end_date!),
          openTasks: openTasks.find((t) => t.user_id === intern.user_id)?._count._all ?? 0,
          documents: documents.get(intern.id)!,
          certificate: intern.certificates[0] ?? null,
          checklist: intern.offboarding
            ? { total: items.length, done, completed: Boolean(intern.offboarding.completed_at) }
            : null,
          canStart: canManage && !intern.offboarding,
        }
      }),
    }
  },

  async checklist(ctx: RequestContext, internId: string) {
    authorizationService.require(ctx, 'offboarding.read')
    const access = await resolveInternAccess(ctx, parseInput(z.uuid(), internId))
    if (!scopeCovers(ctx, 'offboarding.read', access.record)) throw new NotFoundError('Intern')
    const checklist = await prisma.offboardingChecklist.findUnique({
      where: { intern_id: access.record.id },
      select: {
        id: true,
        started_at: true,
        completed_at: true,
        starter: { select: personSelect },
        items: {
          orderBy: { sort_order: 'asc' },
          select: {
            id: true,
            title: true,
            status: true,
            note: true,
            completed_at: true,
            completer: { select: personSelect },
          },
        },
      },
    })
    return {
      checklist,
      canManage: !access.isSelf && scopeCovers(ctx, 'offboarding.manage', access.record),
    }
  },

  /** Creates the checklist from the organization's default items (HR settings). */
  async start(ctx: RequestContext, internId: string) {
    authorizationService.require(ctx, 'offboarding.manage')
    const access = await resolveInternAccess(ctx, parseInput(z.uuid(), internId))
    if (access.isSelf || !scopeCovers(ctx, 'offboarding.manage', access.record)) throw new ForbiddenError()
    const existing = await prisma.offboardingChecklist.count({ where: { intern_id: access.record.id } })
    if (existing) throw new ConflictError('Offboarding has already started for this intern')
    const titles = await settingsService.offboardingItems(ctx.organization.id)
    const due = access.record.expected_end_date
    const checklist = await prisma.offboardingChecklist.create({
      data: {
        organization_id: ctx.organization.id,
        intern_id: access.record.id,
        internship_id: access.record.internships[0]?.id ?? null,
        started_by: ctx.actor.userId,
        items: { create: titles.map((title, index) => ({ title, sort_order: index, due_date: due })) },
      },
      select: { id: true },
    })
    await lifecycleRepository.record(prisma, {
      organizationId: ctx.organization.id,
      internId: access.record.id,
      type: 'OFFBOARDING_STARTED',
      description: 'Offboarding started',
      actorUserId: ctx.actor.userId,
      metadata: { checklistId: checklist.id },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.OFFBOARDING_STARTED,
      resourceType: 'offboarding',
      resourceId: checklist.id,
      metadata: { internId: access.record.id, items: titles.length },
    })
    return checklist
  },

  async setItem(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'offboarding.manage')
    const data = parseInput(itemSchema, input)
    const item = await prisma.offboardingItem.findFirst({
      where: { id: data.itemId, checklist: { organization_id: ctx.organization.id } },
      select: { id: true, status: true, checklist: { select: { id: true, intern_id: true } } },
    })
    if (!item) throw new NotFoundError('Checklist item')
    const access = await resolveInternAccess(ctx, item.checklist.intern_id).catch(() => {
      throw new NotFoundError('Checklist item')
    })
    if (access.isSelf || !scopeCovers(ctx, 'offboarding.manage', access.record)) throw new ForbiddenError()
    const status = data.status as OffboardingItemStatus
    await prisma.$transaction(async (tx) => {
      await tx.offboardingItem.update({
        where: { id: item.id },
        data: {
          status,
          note: data.note ?? null,
          completed_by: status === 'PENDING' ? null : ctx.actor.userId,
          completed_at: status === 'PENDING' ? null : new Date(),
        },
      })
      const pending = await tx.offboardingItem.count({ where: { checklist_id: item.checklist.id, status: 'PENDING' } })
      await tx.offboardingChecklist.update({
        where: { id: item.checklist.id },
        data: { completed_at: pending === 0 ? new Date() : null },
      })
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.OFFBOARDING_ITEM_UPDATED,
      resourceType: 'offboarding',
      resourceId: item.checklist.id,
      metadata: { itemId: item.id, before: item.status, after: status, note: data.note },
    })
  },
}

export type EndingSoonView = Awaited<ReturnType<typeof offboardingService.endingSoon>>
