import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { formatDateOnly, parseDateOnly } from '@/lib/interns/dates'
import { isoDateSchema, parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { optionalText, optionalUuid, personSelect } from './hr-shared'
import { covers, internPlacementSelect, relation, requireInternFor } from './performance-access'

/**
 * Development plans: focus areas with concrete actions, owners and target
 * dates, optionally linked to a review, a recommended course or a goal.
 * Managers / mentors / HR create and edit them (performance.update over the
 * intern); the intern sees their plans and updates the status and evidence of
 * items they own.
 */

const optionalDate = z
  .string()
  .optional()
  .transform((v) => v || undefined)
  .pipe(isoDateSchema.optional())

const planSchema = z.strictObject({
  internId: z.uuid(),
  title: z.string().trim().min(3, 'Add a title').max(200),
  reviewId: optionalUuid,
})

const itemSchema = z.strictObject({
  planId: z.uuid(),
  itemId: optionalUuid,
  area: z.string().trim().min(2, 'Name the focus area').max(200),
  action: z.string().trim().min(3, 'Describe the action').max(2000),
  ownerId: optionalUuid,
  targetDate: optionalDate,
  courseId: optionalUuid,
  goalId: optionalUuid,
})

const itemStatusSchema = z.strictObject({
  itemId: z.uuid(),
  status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
  evidence: optionalText(2000),
})

async function loadPlan(ctx: RequestContext, planId: string) {
  const plan = await prisma.developmentPlan.findFirst({
    where: { id: parseInput(z.uuid(), planId), organization_id: ctx.organization.id },
    select: {
      id: true,
      title: true,
      status: true,
      created_at: true,
      updated_at: true,
      review_id: true,
      creator: { select: personSelect },
      review: { select: { id: true, status: true, cycle: { select: { name: true } } } },
      intern: { select: internPlacementSelect },
      items: {
        orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
        select: {
          id: true,
          area: true,
          action: true,
          status: true,
          target_date: true,
          evidence: true,
          owner_id: true,
          owner: { select: personSelect },
          course: { select: { id: true, title: true } },
          goal: { select: { id: true, title: true, status: true } },
        },
      },
    },
  })
  if (!plan || !covers(ctx, 'performance.read', plan.intern)) throw new NotFoundError('Development plan')
  const rel = relation(ctx, plan.intern)
  // The intern sees a plan linked to a review once that review is completed.
  if (rel.isSelf && plan.review && plan.review.status !== 'COMPLETED') throw new NotFoundError('Development plan')
  return { plan, rel, edit: !rel.isSelf && covers(ctx, 'performance.update', plan.intern) }
}

async function assertLinks(ctx: RequestContext, internId: string, internUserId: string, data: z.infer<typeof itemSchema>) {
  if (data.courseId) {
    const course = await prisma.course.count({
      where: { id: data.courseId, organization_id: ctx.organization.id, deleted_at: null, status: 'PUBLISHED' },
    })
    if (!course) throw new ValidationError('Choose a published course', { courseId: 'Not found' })
  }
  if (data.goalId) {
    const goal = await prisma.performanceGoal.count({ where: { id: data.goalId, intern_id: internId } })
    if (!goal) throw new ValidationError('Choose one of the intern’s goals', { goalId: 'Not found' })
  }
  if (data.ownerId && data.ownerId !== internUserId) {
    const owner = await prisma.user.count({
      where: { id: data.ownerId, organization_id: ctx.organization.id, status: 'ACTIVE', deleted_at: null },
    })
    if (!owner) throw new ValidationError('Choose an active person', { ownerId: 'Not found' })
  }
}

export const developmentPlanService = {
  async get(ctx: RequestContext, planId: string) {
    const { plan, rel, edit } = await loadPlan(ctx, planId)
    const [courses, goals] = edit
      ? await Promise.all([
          prisma.course.findMany({
            where: { organization_id: ctx.organization.id, deleted_at: null, status: 'PUBLISHED' },
            orderBy: { title: 'asc' },
            select: { id: true, title: true },
          }),
          prisma.performanceGoal.findMany({
            where: { intern_id: plan.intern.id, status: { not: 'CANCELLED' } },
            orderBy: { created_at: 'desc' },
            select: { id: true, title: true },
          }),
        ])
      : [[], []]
    const ownerOptions = edit
      ? await prisma.user.findMany({
          where: {
            id: { in: [plan.intern.user_id, plan.intern.manager_id, plan.intern.mentor_id].filter((x): x is string => Boolean(x)) },
          },
          select: personSelect,
        })
      : []
    const active = plan.status === 'ACTIVE'
    return {
      plan: {
        ...plan,
        items: plan.items.map((item) => ({
          ...item,
          canUpdate: active && (edit || (rel.isSelf && (item.owner_id === ctx.actor.userId || item.owner_id === null))),
        })),
      },
      relation: rel,
      options: { courses, goals, owners: ownerOptions },
      can: { edit },
    }
  },

  async forIntern(ctx: RequestContext, internId: string) {
    const intern = await requireInternFor(ctx, 'performance.read', internId)
    const self = intern.user_id === ctx.actor.userId
    const plans = await prisma.developmentPlan.findMany({
      where: {
        intern_id: intern.id,
        ...(self ? { OR: [{ review_id: null }, { review: { status: 'COMPLETED' } }] } : {}),
      },
      orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
      select: {
        id: true,
        title: true,
        status: true,
        created_at: true,
        items: { select: { status: true } },
      },
    })
    return {
      plans: plans.map(({ items, ...p }) => ({
        ...p,
        total: items.filter((i) => i.status !== 'CANCELLED').length,
        done: items.filter((i) => i.status === 'COMPLETED').length,
      })),
      can: { create: !self && covers(ctx, 'performance.update', intern) },
    }
  },

  async create(ctx: RequestContext, input: unknown) {
    const data = parseInput(planSchema, input)
    const intern = await requireInternFor(ctx, 'performance.update', data.internId)
    if (intern.user_id === ctx.actor.userId) throw new ForbiddenError('Development plans are written by your manager or mentor')
    if (data.reviewId) {
      const review = await prisma.performanceReview.count({ where: { id: data.reviewId, intern_id: intern.id } })
      if (!review) throw new ValidationError('Choose one of the intern’s reviews', { reviewId: 'Not found' })
    }
    const plan = await prisma.developmentPlan.create({
      data: {
        organization_id: ctx.organization.id,
        intern_id: intern.id,
        review_id: data.reviewId ?? null,
        title: data.title,
        created_by: ctx.actor.userId,
      },
      select: { id: true },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.DEVELOPMENT_PLAN_CREATED,
      resourceType: 'development_plan',
      resourceId: plan.id,
      metadata: { internId: intern.id, reviewId: data.reviewId ?? null },
    })
    await domainEvents.emit('performance.development_plan_created', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { planId: plan.id, internUserId: intern.user_id },
    })
    return { id: plan.id }
  },

  async saveItem(ctx: RequestContext, input: unknown) {
    const data = parseInput(itemSchema, input)
    const { plan, edit } = await loadPlan(ctx, data.planId)
    if (!edit) throw new ForbiddenError()
    await assertLinks(ctx, plan.intern.id, plan.intern.user_id, data)
    const values = {
      area: data.area,
      action: data.action,
      owner_id: data.ownerId ?? plan.intern.user_id,
      target_date: data.targetDate ? parseDateOnly(data.targetDate) : null,
      course_id: data.courseId ?? null,
      goal_id: data.goalId ?? null,
    }
    if (data.itemId) {
      const before = plan.items.find((i) => i.id === data.itemId)
      if (!before) throw new NotFoundError('Item')
      await prisma.developmentPlanItem.update({ where: { id: before.id }, data: values })
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.DEVELOPMENT_PLAN_UPDATED,
        resourceType: 'development_plan',
        resourceId: plan.id,
        metadata: {
          itemId: before.id,
          before: { area: before.area, target: before.target_date ? formatDateOnly(before.target_date) : null },
          after: { area: data.area, target: data.targetDate ?? null },
        },
      })
    } else {
      await prisma.developmentPlanItem.create({ data: { ...values, plan_id: plan.id, position: plan.items.length } })
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.DEVELOPMENT_PLAN_UPDATED,
        resourceType: 'development_plan',
        resourceId: plan.id,
        metadata: { itemAdded: data.area },
      })
    }
    await prisma.developmentPlan.update({ where: { id: plan.id }, data: { updated_at: new Date() } })
  },

  /** Status and evidence: plan editors, or the intern for items they own. */
  async setItemStatus(ctx: RequestContext, input: unknown) {
    const data = parseInput(itemStatusSchema, input)
    const item = await prisma.developmentPlanItem.findFirst({
      where: { id: data.itemId, plan: { organization_id: ctx.organization.id } },
      select: { id: true, plan_id: true, owner_id: true, status: true },
    })
    if (!item) throw new NotFoundError('Item')
    const { plan, rel, edit } = await loadPlan(ctx, item.plan_id)
    const ownsItem = rel.isSelf && (item.owner_id === ctx.actor.userId || item.owner_id === null)
    if (!edit && !(ownsItem && ctx.actor.permissions.has('performance.update'))) throw new ForbiddenError()
    if (rel.isSelf && data.status === 'CANCELLED') throw new ForbiddenError('Ask your manager or mentor to cancel an item')
    if (plan.status !== 'ACTIVE') throw new ValidationError('This plan is closed')
    await prisma.developmentPlanItem.update({
      where: { id: item.id },
      data: { status: data.status, ...(data.evidence !== undefined ? { evidence: data.evidence } : {}) },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.DEVELOPMENT_PLAN_UPDATED,
      resourceType: 'development_plan',
      resourceId: plan.id,
      metadata: { itemId: item.id, before: item.status, after: data.status },
    })
  },

  async setPlanStatus(ctx: RequestContext, input: unknown) {
    const data = parseInput(z.strictObject({ planId: z.uuid(), status: z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED']) }), input)
    const { plan, edit } = await loadPlan(ctx, data.planId)
    if (!edit) throw new ForbiddenError()
    await prisma.developmentPlan.update({ where: { id: plan.id }, data: { status: data.status } })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.DEVELOPMENT_PLAN_UPDATED,
      resourceType: 'development_plan',
      resourceId: plan.id,
      metadata: { before: plan.status, after: data.status },
    })
  },
}

export type DevelopmentPlanDetail = Awaited<ReturnType<typeof developmentPlanService.get>>
