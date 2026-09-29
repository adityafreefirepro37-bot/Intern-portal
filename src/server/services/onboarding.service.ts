import type { OnboardingAssigneeRole, OnboardingItemStatus, Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import type { RequestMeta } from '@/lib/http/request-meta'
import { addDays, todayIn } from '@/lib/interns/dates'
import { isOverdue, onboardingProgress, type OnboardingProgress } from '@/lib/interns/progress'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { lifecycleRepository } from '../repositories/lifecycle.repository'
import { onboardingRepository, type OnboardingItemRecord } from '../repositories/onboarding.repository'
import { policyRepository } from '../repositories/document.repository'
import { internScope } from '../repositories/scope'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { resolveInternAccess, scopeCovers } from './intern-access'

type Tx = Prisma.TransactionClient

/**
 * Onboarding.
 *
 * Generation copies a template's items into an intern-specific checklist
 * (one onboarding per internship, database-enforced). The copy is an
 * independent snapshot: editing a template never changes existing checklists.
 *
 * Completion rules:
 *  - HR (onboarding.manage in scope) can complete, skip, block or reopen any item.
 *  - The person an item is assigned to can complete it with onboarding.complete
 *    in scope (interns: OWN; managers/mentors: ASSIGNED).
 *  - DOCUMENT items complete when a document of the required type is uploaded;
 *    ACKNOWLEDGEMENT items complete when the policy version is acknowledged.
 *  - When every required item is done the onboarding is marked complete and an
 *    event is recorded. The intern is NOT activated automatically — HR confirms
 *    the ONBOARDING → ACTIVE transition.
 */

export interface GenerateInput {
  organizationId: string
  internship: { id: string; start_date: Date }
  intern: { id: string; user_id: string; manager_id: string | null; mentor_id: string | null }
  templateId: string
  actorUserId: string | null
}

function assigneeFor(
  role: OnboardingAssigneeRole,
  intern: GenerateInput['intern'],
  fixedUserId: string | null,
): string | null {
  switch (role) {
    case 'INTERN':
      return intern.user_id
    case 'MANAGER':
      return intern.manager_id
    case 'MENTOR':
      return intern.mentor_id
    case 'HR':
      return fixedUserId
  }
}

/** Generates the onboarding checklist inside the caller's transaction. */
export async function generateOnboarding(tx: Tx, input: GenerateInput) {
  const existing = await tx.onboarding.findUnique({
    where: { internship_id: input.internship.id },
    select: { id: true },
  })
  if (existing) throw new ConflictError('Onboarding has already been generated for this internship')

  const template = await tx.onboardingTemplate.findFirst({
    where: { id: input.templateId, organization_id: input.organizationId, deleted_at: null, is_active: true },
    select: {
      id: true,
      name: true,
      items: { orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }] },
    },
  })
  if (!template) throw new NotFoundError('Onboarding template')

  const onboarding = await tx.onboarding.create({
    data: {
      organization_id: input.organizationId,
      internship_id: input.internship.id,
      template_id: template.id,
      template_name: template.name,
      created_by: input.actorUserId,
    },
    select: { id: true },
  })
  await tx.onboardingItem.createMany({
    data: template.items.map((item, index) => ({
      organization_id: input.organizationId,
      internship_id: input.internship.id,
      onboarding_id: onboarding.id,
      template_item_id: item.id,
      title: item.title,
      description: item.description,
      item_type: item.category,
      required: item.required,
      due_date: addDays(input.internship.start_date, item.due_days_after_start),
      assigned_role: item.assigned_role,
      assigned_to: assigneeFor(item.assigned_role, input.intern, item.assigned_user_id),
      required_document_type: item.required_document_type,
      policy_id: item.policy_id,
      sort_order: index,
    })),
  })
  await lifecycleRepository.record(tx, {
    organizationId: input.organizationId,
    internId: input.intern.id,
    type: 'ONBOARDING_STARTED',
    description: `Onboarding started (${template.name}, ${template.items.length} items)`,
    actorUserId: input.actorUserId,
    metadata: { templateId: template.id },
    idempotencyKey: `onboarding_started:${input.internship.id}`,
  })
  return { onboardingId: onboarding.id, itemCount: template.items.length, templateName: template.name }
}

export interface ChecklistItem extends OnboardingItemRecord {
  overdue: boolean
  canComplete: boolean
  canManage: boolean
  /** ACKNOWLEDGEMENT items: whether the intern acknowledged the current policy version. */
  acknowledged: boolean
}

async function loadItemForAction(ctx: RequestContext, itemId: string) {
  const id = parseInput(z.uuid(), itemId)
  const item = await onboardingRepository.findItemWithContext(ctx.organization.id, id)
  const intern = item?.internship.intern
  // Items of interns the actor can't even see are reported as missing.
  if (!item || !intern || intern.deleted_at) throw new NotFoundError('Onboarding item')
  const canView = scopeCovers(ctx, 'onboarding.read', intern) || scopeCovers(ctx, 'onboarding.manage', intern)
  if (!canView) throw new NotFoundError('Onboarding item')
  const canManage = scopeCovers(ctx, 'onboarding.manage', intern) && intern.user_id !== ctx.actor.userId
  const isAssignee = item.assigned_to === ctx.actor.userId
  const canComplete = canManage || (isAssignee && scopeCovers(ctx, 'onboarding.complete', intern))
  return { item, intern, canManage, canComplete }
}

/** Emits onboarding.item_assigned for every assigned item of a freshly generated checklist (after commit). */
export async function emitItemAssignments(ctx: RequestContext, onboardingId: string, internId: string) {
  const items = await prisma.onboardingItem.findMany({
    where: { onboarding_id: onboardingId, assigned_to: { not: null } },
    select: { id: true, assigned_to: true },
  })
  for (const item of items) {
    await domainEvents.emit('onboarding.item_assigned', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { internId, itemId: item.id, assigneeId: item.assigned_to! },
    })
  }
}

export async function afterItemChange(ctx: RequestContext, onboardingId: string | null, internId: string) {
  if (!onboardingId) return
  const onboarding = await prisma.onboarding.findUnique({
    where: { id: onboardingId },
    select: {
      id: true,
      completed_at: true,
      internship_id: true,
      items: { select: { required: true, status: true, due_date: true } },
    },
  })
  if (!onboarding) return
  const progress = onboardingProgress(onboarding.items, todayIn(ctx.organization.timezone))
  if (progress.complete && !onboarding.completed_at) {
    if (await onboardingRepository.markComplete(onboarding.id, new Date())) {
      await lifecycleRepository.record(prisma, {
        organizationId: ctx.organization.id,
        internId,
        type: 'ONBOARDING_COMPLETED',
        description: 'All required onboarding items are complete',
        actorUserId: ctx.actor.userId,
      })
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.ONBOARDING_COMPLETED,
        resourceType: 'onboarding',
        resourceId: onboarding.id,
      })
      await domainEvents.emit('onboarding.completed', {
        organizationId: ctx.organization.id,
        actorUserId: ctx.actor.userId,
        payload: { internId, onboardingId: onboarding.id },
      })
    }
  } else if (!progress.complete && onboarding.completed_at) {
    // An item was reopened: the onboarding is no longer complete.
    await onboardingRepository.reopen(onboarding.id)
  }
}

export const onboardingService = {
  /** The checklist for one intern, with per-item permissions for the viewer. */
  async getChecklist(ctx: RequestContext, internId: string) {
    const access = await resolveInternAccess(ctx, internId)
    if (!access.can.viewOnboarding && !access.can.manageOnboarding) throw new ForbiddenError()
    const internship = access.record.internships[0]
    const today = todayIn(ctx.organization.timezone)
    if (!internship?.onboarding) {
      return { access, onboarding: null, items: [] as ChecklistItem[], progress: onboardingProgress([], today) }
    }
    const items = await onboardingRepository.itemsForInternship(internship.id)
    const canManage = access.can.manageOnboarding
    const canCompleteOwnScope = scopeCovers(ctx, 'onboarding.complete', access.record)
    const policies = new Map<string, boolean>()
    for (const item of items) {
      if (item.policy_id && item.policy) {
        const ack = await policyRepository.findAcknowledgement(
          access.record.user_id,
          item.policy_id,
          item.policy.version,
        )
        policies.set(item.id, Boolean(ack))
      }
    }
    return {
      access,
      onboarding: internship.onboarding,
      items: items.map((item): ChecklistItem => ({
        ...item,
        overdue: isOverdue(item, today),
        canManage,
        canComplete: canManage || (item.assigned_to === ctx.actor.userId && canCompleteOwnScope),
        acknowledged: policies.get(item.id) ?? false,
      })),
      progress: onboardingProgress(items, today),
    }
  },

  /** Marks an item complete (non-document, non-acknowledgement items). */
  async completeItem(ctx: RequestContext, itemId: string) {
    const { item, intern, canComplete } = await loadItemForAction(ctx, itemId)
    if (!canComplete) throw new ForbiddenError('You can’t complete this item')
    if (item.status === 'COMPLETED') return { changed: false }
    if (item.item_type === 'DOCUMENT' && !item.document_id) {
      throw new ValidationError('Upload the required document to complete this item')
    }
    if (item.item_type === 'ACKNOWLEDGEMENT') {
      throw new ValidationError('Read and acknowledge the policy to complete this item')
    }
    await onboardingRepository.updateItem(item.id, {
      status: 'COMPLETED',
      completed_at: new Date(),
      completed_by: ctx.actor.userId,
      blocked_reason: null,
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.ONBOARDING_ITEM_COMPLETED,
      resourceType: 'onboarding_item',
      resourceId: item.id,
      metadata: { internId: intern.id, title: item.title },
    })
    await domainEvents.emit('onboarding.item_completed', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { internId: intern.id, itemId: item.id },
    })
    await afterItemChange(ctx, item.onboarding_id, intern.id)
    return { changed: true }
  },

  /** Records a versioned policy acknowledgement and completes the item. */
  async acknowledgeItem(ctx: RequestContext, itemId: string, meta: RequestMeta) {
    const { item, intern } = await loadItemForAction(ctx, itemId)
    // Only the intern acknowledges their own policies.
    if (intern.user_id !== ctx.actor.userId || !scopeCovers(ctx, 'onboarding.complete', intern)) {
      throw new ForbiddenError('Only the intern can acknowledge this policy')
    }
    if (item.item_type !== 'ACKNOWLEDGEMENT' || !item.policy_id)
      throw new ValidationError('This item has no policy to acknowledge')
    const policy = await policyRepository.findActive(ctx.organization.id, item.policy_id)
    if (!policy) throw new NotFoundError('Policy')
    await prisma.$transaction([
      prisma.documentAcknowledgement.upsert({
        where: {
          user_id_policy_id_policy_version: {
            user_id: ctx.actor.userId,
            policy_id: policy.id,
            policy_version: policy.version,
          },
        },
        update: {},
        create: {
          organization_id: ctx.organization.id,
          user_id: ctx.actor.userId,
          policy_id: policy.id,
          policy_version: policy.version,
          ip_address: meta.ipAddress,
          user_agent: meta.userAgent?.slice(0, 512) ?? null,
        },
      }),
      prisma.onboardingItem.update({
        where: { id: item.id },
        data: { status: 'COMPLETED', completed_at: new Date(), completed_by: ctx.actor.userId },
      }),
    ])
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.POLICY_ACKNOWLEDGED,
      resourceType: 'policy',
      resourceId: policy.id,
      metadata: { version: policy.version, itemId: item.id },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    })
    await afterItemChange(ctx, item.onboarding_id, intern.id)
  },

  /** Links an uploaded document to a DOCUMENT item and completes it (called by documentService). */
  async attachDocument(ctx: RequestContext, itemId: string, documentId: string, documentType: string) {
    const { item, intern, canComplete } = await loadItemForAction(ctx, itemId)
    if (!canComplete) throw new ForbiddenError('You can’t complete this item')
    if (item.item_type !== 'DOCUMENT') throw new ValidationError('This item doesn’t take a document')
    if (item.required_document_type && item.required_document_type !== documentType) {
      throw new ValidationError('This item needs a different type of document')
    }
    await onboardingRepository.updateItem(item.id, {
      document_id: documentId,
      status: 'COMPLETED',
      completed_at: new Date(),
      completed_by: ctx.actor.userId,
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.ONBOARDING_ITEM_COMPLETED,
      resourceType: 'onboarding_item',
      resourceId: item.id,
      metadata: { internId: intern.id, documentId },
    })
    await afterItemChange(ctx, item.onboarding_id, intern.id)
    return { internId: intern.id }
  },

  /** HR controls: reopen, skip (optional or waived items), block with reason, or start. */
  async setItemStatus(ctx: RequestContext, input: unknown) {
    const data = parseInput(
      z.object({
        itemId: z.uuid(),
        action: z.enum(['reopen', 'skip', 'block', 'start']),
        reason: z.string().trim().max(500).optional(),
      }),
      input,
    )
    const { item, intern, canManage } = await loadItemForAction(ctx, data.itemId)
    if (!canManage) throw new ForbiddenError('Only HR can change this item')
    const next: Record<typeof data.action, OnboardingItemStatus> = {
      reopen: 'PENDING',
      skip: 'SKIPPED',
      block: 'BLOCKED',
      start: 'IN_PROGRESS',
    }
    if (data.action === 'block' && !data.reason)
      throw new ValidationError('Say why the item is blocked', { reason: 'Required' })
    if (data.action === 'skip' && item.required && !data.reason) {
      throw new ValidationError('Give a reason for waiving a required item', { reason: 'Required' })
    }
    await onboardingRepository.updateItem(item.id, {
      status: next[data.action],
      blocked_reason: data.action === 'block' ? data.reason : null,
      ...(data.action === 'reopen' ? { completed_at: null, completed_by: null } : {}),
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.ONBOARDING_ITEM_UPDATED,
      resourceType: 'onboarding_item',
      resourceId: item.id,
      metadata: { internId: intern.id, action: data.action, reason: data.reason },
    })
    await afterItemChange(ctx, item.onboarding_id, intern.id)
  },

  /** HR onboarding dashboard (onboarding.manage, scoped). */
  async dashboard(ctx: RequestContext) {
    const scope = authorizationService.require(ctx, 'onboarding.manage')
    const today = todayIn(ctx.organization.timezone)
    const instances = await onboardingRepository.listInstances({
      organization_id: ctx.organization.id,
      internship: { intern: { AND: [internScope(ctx.actor, scope), { deleted_at: null }] } },
    })
    const rows = instances.map((instance) => {
      const progress: OnboardingProgress = onboardingProgress(instance.items, today)
      const dueDates = instance.items.map((item) => item.due_date).filter((d): d is Date => Boolean(d))
      const lastDue = dueDates.length ? new Date(Math.max(...dueDates.map((d) => d.getTime()))) : null
      const state = instance.completed_at
        ? 'COMPLETED'
        : progress.blocked > 0
          ? 'BLOCKED'
          : progress.overdue > 0
            ? 'OVERDUE'
            : 'IN_PROGRESS'
      return { ...instance, progress, lastDue, state }
    })
    return {
      stats: {
        total: rows.length,
        inProgress: rows.filter((row) => !row.completed_at).length,
        completed: rows.filter((row) => row.completed_at).length,
        overdue: rows.filter((row) => !row.completed_at && row.progress.overdue > 0).length,
        blocked: rows.filter((row) => !row.completed_at && row.progress.blocked > 0).length,
      },
      rows,
    }
  },
}
