import type { InternStatus } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, ForbiddenError, ValidationError } from '@/lib/errors'
import { addDays, formatDateOnly, todayIn } from '@/lib/interns/dates'
import {
  canTransition,
  INTERN_STATUSES,
  internshipStatusFor,
  permissionForTransition,
  requiresReason,
  STATUS_LABELS,
} from '@/lib/interns/lifecycle'
import { onboardingProgress } from '@/lib/interns/progress'
import { logger } from '@/lib/logging'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { lifecycleRepository } from '../repositories/lifecycle.repository'
import { onboardingRepository } from '../repositories/onboarding.repository'
import { templateRepository } from '../repositories/template.repository'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { resolveInternAccess, scopeCovers } from './intern-access'
import { generateOnboarding } from './onboarding.service'
import { settingsService } from './settings.service'

export const transitionSchema = z.strictObject({
  internId: z.uuid(),
  to: z.enum(INTERN_STATUSES as [InternStatus, ...InternStatus[]]),
  reason: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((value) => value || undefined),
  /** ONBOARDING → ACTIVE before every required item is done (needs a reason). */
  override: z.preprocess((value) => value === true || value === 'on' || value === 'true', z.boolean()).default(false),
  templateId: z
    .string()
    .optional()
    .transform((value) => value || undefined)
    .pipe(z.uuid().optional()),
})

/**
 * The single place intern status changes happen. Enforces the transition
 * table, permissions, reasons and business checks; updates the intern and
 * internship atomically (guarded against concurrent changes); then records a
 * lifecycle event, an audit entry and a domain event.
 */
export const internLifecycleService = {
  async transitionStatus(ctx: RequestContext, input: unknown) {
    const data = parseInput(transitionSchema, input)
    const access = await resolveInternAccess(ctx, data.internId)
    const r = access.record
    const from = r.status
    const to = data.to

    const permission = permissionForTransition(to)
    if (access.isSelf || !scopeCovers(ctx, permission, r)) {
      throw new ForbiddenError('You can’t change this intern’s status')
    }
    if (!canTransition(from, to)) {
      throw new ValidationError(`An intern can’t move from ${STATUS_LABELS[from]} to ${STATUS_LABELS[to]}`)
    }
    if (requiresReason(from, to) && !data.reason) {
      throw new ValidationError('Give a reason for this change', { reason: 'Required' })
    }

    const internship = r.internships[0] ?? null
    const today = todayIn(ctx.organization.timezone)

    if (from === 'ONBOARDING' && to === 'ACTIVE') {
      const items = internship?.onboarding ? await onboardingRepository.itemsForInternship(internship.id) : []
      const progress = onboardingProgress(items, today)
      if (internship?.onboarding && !progress.complete) {
        if (!data.override) {
          throw new ValidationError(
            `Onboarding isn’t finished (${progress.requiredDone} of ${progress.requiredTotal} required items). Complete it or override with a reason.`,
          )
        }
        if (!data.reason) throw new ValidationError('Give a reason for activating before onboarding is complete', { reason: 'Required' })
        if (!scopeCovers(ctx, 'onboarding.manage', r)) throw new ForbiddenError('Only HR can override onboarding')
      }
    }

    // SELECTED → ONBOARDING generates the checklist if it doesn't exist yet.
    const needsOnboarding = to === 'ONBOARDING' && internship && !internship.onboarding
    const templateId = needsOnboarding
      ? (data.templateId ?? (await templateRepository.pickFor(ctx.organization.id, { departmentId: r.department_id, positionId: r.position_id })))
      : null
    if (needsOnboarding && !templateId) throw new ValidationError('Choose an onboarding template', { templateId: 'Required' })

    const closing = to === 'COMPLETED' || to === 'TERMINATED'
    const generated = await prisma.$transaction(async (tx) => {
      // Optimistic guard: only succeeds if nobody changed the status meanwhile.
      const { count } = await tx.intern.updateMany({
        where: { id: r.id, status: from },
        data: { status: to, ...(closing ? { actual_end_date: today } : {}) },
      })
      if (count === 0) throw new ConflictError('This intern’s status just changed. Refresh and try again.')
      if (internship) {
        await tx.internship.update({
          where: { id: internship.id },
          data: { status: internshipStatusFor(to), ...(closing ? { actual_end_date: today } : {}) },
        })
      }
      await lifecycleRepository.record(tx, {
        organizationId: ctx.organization.id,
        internId: r.id,
        type: 'STATUS_CHANGED',
        description: `${STATUS_LABELS[from]} → ${STATUS_LABELS[to]}${data.reason ? `: ${data.reason}` : ''}`,
        actorUserId: ctx.actor.userId,
        metadata: { from, to, reason: data.reason, override: data.override || undefined },
      })
      if (needsOnboarding && internship && templateId) {
        return generateOnboarding(tx, {
          organizationId: ctx.organization.id,
          internship: { id: internship.id, start_date: internship.start_date },
          intern: r,
          templateId,
          actorUserId: ctx.actor.userId,
        })
      }
      return null
    })

    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.STATUS_CHANGED,
      resourceType: 'intern',
      resourceId: r.id,
      metadata: { from, to, reason: data.reason, override: data.override || undefined },
    })
    if (generated) {
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.ONBOARDING_CREATED,
        resourceType: 'onboarding',
        resourceId: generated.onboardingId,
        metadata: { internId: r.id, template: generated.templateName },
      })
      await domainEvents.emit('onboarding.created', {
        organizationId: ctx.organization.id,
        actorUserId: ctx.actor.userId,
        payload: { internId: r.id, onboardingId: generated.onboardingId, itemCount: generated.itemCount },
      })
    }
    await domainEvents.emit('intern.status_changed', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { internId: r.id, from, to, automated: false },
    })
    return { from, to }
  },

  /**
   * Scheduled job: ACTIVE interns whose expected end date is within the
   * organization's threshold (default 14 days) become ENDING_SOON.
   * Idempotent per intern and end date — rerunning is safe, and an intern HR
   * moved back to ACTIVE isn't flipped again until their end date changes.
   */
  async markEndingSoon(options: { organizationId?: string; now?: Date } = {}) {
    const organizations = await prisma.organization.findMany({
      where: options.organizationId ? { id: options.organizationId } : {},
      select: { id: true, timezone: true },
    })
    let marked = 0
    for (const org of organizations) {
      const today = todayIn(org.timezone, options.now)
      const days = await settingsService.endingSoonDays(org.id)
      const candidates = await prisma.intern.findMany({
        where: {
          organization_id: org.id,
          deleted_at: null,
          status: 'ACTIVE',
          expected_end_date: { gte: today, lte: addDays(today, days) },
        },
        select: { id: true, expected_end_date: true, internships: { orderBy: { start_date: 'desc' }, take: 1, select: { id: true } } },
      })
      for (const intern of candidates) {
        const endDate = formatDateOnly(intern.expected_end_date!)
        const key = `ending_soon:${intern.id}:${endDate}`
        const done = await prisma.$transaction(async (tx) => {
          const seen = await tx.internLifecycleEvent.findUnique({ where: { idempotency_key: key }, select: { id: true } })
          if (seen) return false
          const { count } = await tx.intern.updateMany({ where: { id: intern.id, status: 'ACTIVE' }, data: { status: 'ENDING_SOON' } })
          if (count === 0) return false
          return lifecycleRepository.record(tx, {
            organizationId: org.id,
            internId: intern.id,
            type: 'STATUS_CHANGED',
            description: `Active → Ending soon (internship ends ${endDate})`,
            metadata: { from: 'ACTIVE', to: 'ENDING_SOON', automated: true },
            idempotencyKey: key,
          })
        })
        if (!done) continue
        marked += 1
        await auditService.log({
          organizationId: org.id,
          action: AUDIT_ACTIONS.STATUS_CHANGED,
          resourceType: 'intern',
          resourceId: intern.id,
          metadata: { from: 'ACTIVE', to: 'ENDING_SOON', automated: true },
        })
        await domainEvents.emit('intern.status_changed', {
          organizationId: org.id,
          actorUserId: null,
          payload: { internId: intern.id, from: 'ACTIVE', to: 'ENDING_SOON', automated: true },
        })
        await domainEvents.emit('internship.ending_soon', {
          organizationId: org.id,
          actorUserId: null,
          payload: { internId: intern.id, expectedEndDate: endDate },
        })
      }
    }
    logger.info('Ending-soon job finished', { marked })
    return { marked }
  },

  /**
   * Scheduled job: emits `onboarding.item_overdue` for open items that became
   * overdue today (due yesterday). Daily runs therefore notify once per item.
   */
  async emitOverdueOnboarding(options: { organizationId?: string; now?: Date } = {}) {
    const organizations = await prisma.organization.findMany({
      where: options.organizationId ? { id: options.organizationId } : {},
      select: { id: true, timezone: true },
    })
    let emitted = 0
    for (const org of organizations) {
      const today = todayIn(org.timezone, options.now)
      const yesterday = addDays(today, -1)
      const items = await onboardingRepository.listOverdueItems(org.id, today, ['PENDING', 'IN_PROGRESS', 'BLOCKED'])
      for (const item of items) {
        const intern = item.internship.intern
        if (!intern || intern.deleted_at || item.due_date?.getTime() !== yesterday.getTime()) continue
        emitted += 1
        await domainEvents.emit('onboarding.item_overdue', {
          organizationId: org.id,
          actorUserId: null,
          payload: { internId: intern.id, itemId: item.id, assigneeId: item.assigned_to },
        })
      }
    }
    return { emitted }
  },
}
