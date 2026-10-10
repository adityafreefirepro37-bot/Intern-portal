import type { GoalStatus, Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { addDays, formatDateOnly, parseDateOnly, todayIn } from '@/lib/interns/dates'
import { isSafeResourceUrl } from '@/lib/learning/content'
import { canMoveGoal, GOAL_PROGRESS_STEPS, GOAL_STATUS_LABELS, reconcileGoal } from '@/lib/performance/rules'
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
  relation,
  requireInternFor,
  resolveRecord,
  resolveRecords,
  scopedInternWhere,
  type RecordType,
} from './performance-access'

/**
 * Development goals. Progress is set by people in explicit 25% steps; evidence
 * links to existing records (tasks, projects, submissions, courses, feedback,
 * documents) or adds a link / note — it never copies data.
 */

const optionalDate = z
  .string()
  .optional()
  .transform((v) => v || undefined)
  .pipe(isoDateSchema.optional())

const CATEGORIES = ['TECHNICAL', 'COMMUNICATION', 'PROJECT', 'LEARNING', 'LEADERSHIP', 'PROCESS', 'OTHER'] as const
const STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'AT_RISK', 'COMPLETED', 'CANCELLED'] as const

const goalSchema = z
  .strictObject({
    goalId: optionalUuid,
    internId: optionalUuid,
    title: z.string().trim().min(3, 'Add a title').max(200),
    description: optionalText(4000),
    category: z.enum(CATEGORIES),
    startDate: optionalDate,
    targetDate: optionalDate,
  })
  .refine((v) => !v.startDate || !v.targetDate || v.targetDate >= v.startDate, {
    message: 'The target date is before the start date',
    path: ['targetDate'],
  })

const progressSchema = z.strictObject({
  goalId: z.uuid(),
  status: z.enum(STATUSES),
  progress: z.coerce
    .number()
    .int()
    .refine((v) => (GOAL_PROGRESS_STEPS as readonly number[]).includes(v), 'Use 0, 25, 50, 75 or 100%'),
  note: optionalText(1000),
})

const evidenceSchema = z
  .strictObject({
    goalId: z.uuid(),
    type: z.enum(['TASK', 'PROJECT', 'SUBMISSION', 'COURSE', 'FEEDBACK', 'DOCUMENT', 'LINK', 'NOTE']),
    referenceId: optionalUuid,
    url: optionalText(2000),
    note: optionalText(2000),
  })
  .refine((v) => v.type !== 'LINK' || (v.url && isSafeResourceUrl(v.url)), {
    message: 'Use a secure https:// link',
    path: ['url'],
  })
  .refine((v) => v.type !== 'NOTE' || v.note, { message: 'Write the note', path: ['note'] })
  .refine((v) => ['LINK', 'NOTE'].includes(v.type) || v.referenceId, { message: 'Choose the record', path: ['referenceId'] })

export const goalFilterSchema = z.object({
  status: z
    .enum([...STATUSES, ''])
    .optional()
    .transform((v) => v || undefined),
  category: z
    .enum([...CATEGORIES, ''])
    .optional()
    .transform((v) => v || undefined),
  internId: optionalUuid,
  q: optionalText(100),
})

const goalListSelect = {
  id: true,
  title: true,
  category: true,
  status: true,
  progress: true,
  start_date: true,
  target_date: true,
  completed_at: true,
  updated_at: true,
  intern: { select: { id: true, user: { select: personSelect } } },
  _count: { select: { evidence: true } },
} as const satisfies Prisma.PerformanceGoalSelect

async function loadGoal(ctx: RequestContext, goalId: string) {
  const goal = await prisma.performanceGoal.findFirst({
    where: { id: parseInput(z.uuid(), goalId), organization_id: ctx.organization.id },
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      status: true,
      progress: true,
      start_date: true,
      target_date: true,
      completed_at: true,
      created_at: true,
      updated_at: true,
      created_by: true,
      owner: { select: personSelect },
      creator: { select: personSelect },
      intern: { select: internPlacementSelect },
      evidence: {
        orderBy: { created_at: 'desc' },
        select: { id: true, evidence_type: true, reference_id: true, url: true, note: true, created_at: true, adder: { select: personSelect } },
      },
    },
  })
  if (!goal || !covers(ctx, 'goal.read', goal.intern)) throw new NotFoundError('Goal')
  return goal
}

function goalPermissions(ctx: RequestContext, goal: { status: GoalStatus; created_by: string | null; intern: Parameters<typeof covers>[2] }) {
  const update = covers(ctx, 'goal.update', goal.intern)
  const review = covers(ctx, 'goal.review', goal.intern) && goal.intern.user_id !== ctx.actor.userId
  // Closing (complete / cancel) is a review decision, except for goals people set for themselves.
  const ownGoal = goal.created_by === ctx.actor.userId
  return { update, close: review || (update && ownGoal), review }
}

export const goalService = {
  async list(ctx: RequestContext, query: unknown = {}) {
    const where = scopedInternWhere(ctx, 'goal.read')
    if (!where) throw new ForbiddenError()
    const filters = parseInput(goalFilterSchema, query)
    const today = todayIn(ctx.organization.timezone)
    const rows = await prisma.performanceGoal.findMany({
      where: {
        organization_id: ctx.organization.id,
        intern: where,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.category ? { category: filters.category } : {}),
        ...(filters.internId ? { intern_id: filters.internId } : {}),
        ...(filters.q ? { title: { contains: filters.q, mode: 'insensitive' as const } } : {}),
      },
      orderBy: [{ status: 'asc' }, { target_date: { sort: 'asc', nulls: 'last' } }],
      take: 200,
      select: goalListSelect,
    })
    const interns = await prisma.intern.findMany({
      where: { AND: [where, { user_id: { not: ctx.actor.userId } }] },
      orderBy: { user: { first_name: 'asc' } },
      take: 300,
      select: { id: true, user: { select: personSelect } },
    })
    return {
      filters,
      goals: rows.map((g) => ({
        ...g,
        overdue: Boolean(g.target_date && g.target_date < today && !['COMPLETED', 'CANCELLED'].includes(g.status)),
      })),
      interns,
      can: { create: authorizationService.can(ctx, 'goal.create') },
    }
  },

  /** Global search: goals of interns in goal.read scope. */
  async search(ctx: RequestContext, term: string, take: number) {
    const where = scopedInternWhere(ctx, 'goal.read')
    if (!where) return []
    return prisma.performanceGoal.findMany({
      where: { organization_id: ctx.organization.id, intern: where, title: { contains: term, mode: 'insensitive' } },
      take,
      orderBy: { updated_at: 'desc' },
      select: { id: true, title: true, status: true, intern: { select: { user: { select: personSelect } } } },
    })
  },

  async get(ctx: RequestContext, goalId: string) {
    const goal = await loadGoal(ctx, goalId)
    const records = await resolveRecords(
      ctx.organization.id,
      goal.evidence.map((e) =>
        e.reference_id && !['LINK', 'NOTE'].includes(e.evidence_type)
          ? { intern: goal.intern, type: e.evidence_type as RecordType, id: e.reference_id }
          : null,
      ),
    )
    const evidence = goal.evidence.map((e, index) => ({ ...e, record: records[index] }))
    const today = todayIn(ctx.organization.timezone)
    return {
      goal: { ...goal, evidence },
      overdue: Boolean(goal.target_date && goal.target_date < today && !['COMPLETED', 'CANCELLED'].includes(goal.status)),
      relation: relation(ctx, goal.intern),
      can: goalPermissions(ctx, goal),
    }
  },

  /** Create (intern for themself, or manager / mentor / HR for an intern in scope) or edit details. */
  async save(ctx: RequestContext, input: unknown) {
    const data = parseInput(goalSchema, input)
    const values = {
      title: data.title,
      description: data.description ?? null,
      category: data.category,
      start_date: data.startDate ? parseDateOnly(data.startDate) : null,
      target_date: data.targetDate ? parseDateOnly(data.targetDate) : null,
    }
    if (data.goalId) {
      const goal = await loadGoal(ctx, data.goalId)
      if (!goalPermissions(ctx, goal).update) throw new ForbiddenError('You can’t edit this goal')
      await prisma.performanceGoal.update({ where: { id: goal.id }, data: values })
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.GOAL_UPDATED,
        resourceType: 'goal',
        resourceId: goal.id,
        metadata: {
          before: { title: goal.title, category: goal.category, target: goal.target_date ? formatDateOnly(goal.target_date) : null },
          after: { title: data.title, category: data.category, target: data.targetDate ?? null },
        },
      })
      return { id: goal.id }
    }
    let internId = data.internId
    if (!internId) {
      const own = await prisma.intern.findFirst({
        where: { user_id: ctx.actor.userId, organization_id: ctx.organization.id, deleted_at: null },
        select: { id: true },
      })
      if (!own) throw new ValidationError('Choose the intern', { internId: 'Required' })
      internId = own.id
    }
    const intern = await requireInternFor(ctx, 'goal.create', internId)
    const goal = await prisma.performanceGoal.create({
      data: {
        ...values,
        organization_id: ctx.organization.id,
        intern_id: intern.id,
        owner_id: intern.user_id,
        created_by: ctx.actor.userId,
      },
      select: { id: true },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.GOAL_CREATED,
      resourceType: 'goal',
      resourceId: goal.id,
      metadata: { internId: intern.id, title: data.title, category: data.category },
    })
    await domainEvents.emit('performance.goal_created', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { goalId: goal.id, internId: intern.id, ownerId: intern.user_id },
    })
    return { id: goal.id }
  },

  /** Status and progress move together (see reconcileGoal); completing or cancelling is a closing decision. */
  async setProgress(ctx: RequestContext, input: unknown) {
    const data = parseInput(progressSchema, input)
    const goal = await loadGoal(ctx, data.goalId)
    const can = goalPermissions(ctx, goal)
    if (!can.update) throw new ForbiddenError('You can’t update this goal')
    if (!canMoveGoal(goal.status, data.status)) {
      throw new ValidationError(`A goal can’t move from ${GOAL_STATUS_LABELS[goal.status]} to ${GOAL_STATUS_LABELS[data.status]}`)
    }
    const closing = ['COMPLETED', 'CANCELLED'].includes(data.status) || ['COMPLETED', 'CANCELLED'].includes(goal.status)
    if (closing && data.status !== goal.status && !can.close) {
      throw new ForbiddenError('Ask your manager or mentor to close or reopen this goal')
    }
    const next = reconcileGoal({ from: goal.status, to: data.status, progress: data.progress })
    const completedNow = next.status === 'COMPLETED' && goal.status !== 'COMPLETED'
    await prisma.performanceGoal.update({
      where: { id: goal.id },
      data: {
        status: next.status,
        progress: next.progress,
        completed_at: next.status === 'COMPLETED' ? (goal.completed_at ?? new Date()) : null,
      },
    })
    if (data.note) {
      await prisma.goalEvidence.create({
        data: { goal_id: goal.id, evidence_type: 'NOTE', note: data.note, added_by: ctx.actor.userId },
      })
    }
    await auditService.logForContext(ctx, {
      action: completedNow ? AUDIT_ACTIONS.GOAL_COMPLETED : AUDIT_ACTIONS.GOAL_UPDATED,
      resourceType: 'goal',
      resourceId: goal.id,
      metadata: { before: { status: goal.status, progress: goal.progress }, after: next },
    })
    return next
  },

  async addEvidence(ctx: RequestContext, input: unknown) {
    const data = parseInput(evidenceSchema, input)
    const goal = await loadGoal(ctx, data.goalId)
    if (!goalPermissions(ctx, goal).update) throw new ForbiddenError('You can’t add evidence to this goal')
    if (data.referenceId && !['LINK', 'NOTE'].includes(data.type)) {
      const record = await resolveRecord(ctx.organization.id, goal.intern, data.type as RecordType, data.referenceId)
      if (!record) throw new ValidationError('That record isn’t connected to this intern', { referenceId: 'Not found' })
    }
    await prisma.goalEvidence.create({
      data: {
        goal_id: goal.id,
        evidence_type: data.type,
        reference_id: ['LINK', 'NOTE'].includes(data.type) ? null : data.referenceId!,
        url: data.type === 'LINK' ? data.url! : null,
        note: data.note ?? null,
        added_by: ctx.actor.userId,
      },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.GOAL_UPDATED,
      resourceType: 'goal',
      resourceId: goal.id,
      metadata: { evidenceAdded: data.type, referenceId: data.referenceId ?? null },
    })
  },

  /** Evidence is removed by whoever added it, or by a reviewer. */
  async removeEvidence(ctx: RequestContext, evidenceId: string) {
    const row = await prisma.goalEvidence.findFirst({
      where: { id: parseInput(z.uuid(), evidenceId), goal: { organization_id: ctx.organization.id } },
      select: { id: true, goal_id: true, added_by: true, evidence_type: true },
    })
    if (!row) throw new NotFoundError('Evidence')
    const goal = await loadGoal(ctx, row.goal_id)
    const can = goalPermissions(ctx, goal)
    if (!(can.update && row.added_by === ctx.actor.userId) && !can.review) throw new ForbiddenError()
    await prisma.goalEvidence.delete({ where: { id: row.id } })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.GOAL_UPDATED,
      resourceType: 'goal',
      resourceId: goal.id,
      metadata: { evidenceRemoved: row.evidence_type },
    })
  },

  /** Records the intern can link as evidence (their own tasks, projects, submissions, courses, feedback). */
  async evidenceOptions(ctx: RequestContext, goalId: string) {
    const goal = await loadGoal(ctx, goalId)
    const userId = goal.intern.user_id
    const [tasks, projects, submissions, courses] = await Promise.all([
      prisma.task.findMany({
        where: { organization_id: ctx.organization.id, deleted_at: null, assignees: { some: { user_id: userId } } },
        orderBy: { updated_at: 'desc' },
        take: 50,
        select: { id: true, title: true },
      }),
      prisma.project.findMany({
        where: { organization_id: ctx.organization.id, deleted_at: null, members: { some: { user_id: userId } } },
        orderBy: { updated_at: 'desc' },
        take: 30,
        select: { id: true, name: true },
      }),
      prisma.taskSubmission.findMany({
        where: { submitted_by: userId, task: { organization_id: ctx.organization.id } },
        orderBy: { submitted_at: 'desc' },
        take: 30,
        select: { id: true, task: { select: { title: true } } },
      }),
      prisma.courseEnrollment.findMany({
        where: { user_id: userId, organization_id: ctx.organization.id, status: { not: 'CANCELLED' } },
        take: 50,
        select: { course: { select: { id: true, title: true } } },
      }),
    ])
    return {
      TASK: tasks.map((t) => ({ id: t.id, label: t.title })),
      PROJECT: projects.map((p) => ({ id: p.id, label: p.name })),
      SUBMISSION: submissions.map((s) => ({ id: s.id, label: s.task.title })),
      COURSE: courses.map((c) => ({ id: c.course.id, label: c.course.title })),
    }
  },
}

/** Daily job: reminders three days before a goal's target date. */
export const goalJobs = {
  async emitDeadlines(options: { organizationId?: string; now?: Date } = {}) {
    const organizations = await prisma.organization.findMany({
      where: options.organizationId ? { id: options.organizationId } : {},
      select: { id: true, timezone: true },
    })
    let emitted = 0
    for (const org of organizations) {
      const today = todayIn(org.timezone, options.now)
      const goals = await prisma.performanceGoal.findMany({
        where: {
          organization_id: org.id,
          status: { in: ['NOT_STARTED', 'IN_PROGRESS', 'AT_RISK'] },
          target_date: addDays(today, 3),
        },
        select: { id: true, owner_id: true },
      })
      for (const goal of goals) {
        emitted++
        await domainEvents.emit('performance.goal_deadline', {
          organizationId: org.id,
          actorUserId: null,
          payload: { goalId: goal.id, ownerId: goal.owner_id },
        })
      }
    }
    return { goalReminders: emitted }
  },
}

export type GoalList = Awaited<ReturnType<typeof goalService.list>>
export type GoalDetail = Awaited<ReturnType<typeof goalService.get>>
