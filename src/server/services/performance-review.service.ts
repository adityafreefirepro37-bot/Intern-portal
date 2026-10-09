import type { PerformanceReviewStatus, Prisma, ReviewRespondent } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { addDays, parseDateOnly, todayIn } from '@/lib/interns/dates'
import {
  canSeeAnswers,
  firstStage,
  nextStage,
  respondentFor,
  respondentForStage,
  reviewStages,
  validateReviewAnswer,
  type ReviewStage,
  type ReviewViewer,
  type StageConfig,
} from '@/lib/performance/rules'
import { isoDateSchema, parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { optionalText, optionalUuid, personSelect, TRACKED_STATUSES } from './hr-shared'
import { usersWithPermission } from './notification.service'
import { covers, internPlacementSelect, RECORD_TYPES, requireInternFor, resolveRecord, scopedInternWhere } from './performance-access'

/**
 * Performance reviews: configurable templates (sections → questions, each
 * section answered by chosen respondents), review cycles that create one
 * review per intern, and a staged workflow
 *   SELF_REVIEW → MANAGER_REVIEW → MENTOR_REVIEW → HR_REVIEW → COMPLETED
 * (self, mentor and HR stages are configurable). Each respondent's answers
 * are kept separately; who sees what is decided by `canSeeAnswers`. A
 * completed review is locked; HR corrections keep the previous value in a
 * revision and are audited; reopening needs a reason.
 */

const date = isoDateSchema
const optionalDate = z
  .string()
  .optional()
  .transform((v) => v || undefined)
  .pipe(isoDateSchema.optional())
const RESPONDENTS = ['SELF', 'MANAGER', 'MENTOR', 'HR'] as const
const flag = z
  .union([z.boolean(), z.literal('on'), z.literal('true'), z.literal('false'), z.literal('')])
  .optional()
  .transform((v) => v === true || v === 'on' || v === 'true')

// ── Schemas ─────────────────────────────────────────────────────────────────

const templateSchema = z.strictObject({
  templateId: optionalUuid,
  name: z.string().trim().min(3, 'Add a name').max(160),
  description: optionalText(2000),
  active: flag,
})

const sectionSchema = z.strictObject({
  templateId: z.uuid(),
  sectionId: optionalUuid,
  title: z.string().trim().min(2, 'Add a title').max(160),
  description: optionalText(2000),
  respondents: z.array(z.enum(RESPONDENTS)).min(1, 'Choose who answers this section'),
})

const questionSchema = z
  .strictObject({
    sectionId: z.uuid(),
    questionId: optionalUuid,
    prompt: z.string().trim().min(3, 'Write the question').max(1000),
    type: z.enum(['TEXT', 'RATING', 'BOOLEAN', 'MULTI_SELECT']),
    guidance: optionalText(2000),
    options: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
    required: flag,
    requiresEvidence: flag,
  })
  .refine((v) => v.type !== 'MULTI_SELECT' || v.options.length >= 2, {
    message: 'Add at least two options',
    path: ['options'],
  })

const cycleSchema = z
  .strictObject({
    cycleId: optionalUuid,
    name: z.string().trim().min(3, 'Add a name').max(160),
    type: z.enum(['MIDPOINT', 'FINAL', 'CUSTOM']),
    templateId: z.uuid(),
    startDate: date,
    dueDate: date,
    departmentId: optionalUuid,
    selfReview: flag,
    mentorReview: flag,
    hrReview: flag,
  })
  .refine((v) => v.dueDate >= v.startDate, { message: 'The due date is before the start', path: ['dueDate'] })

const startSchema = z
  .strictObject({
    internId: z.uuid(),
    templateId: z.uuid(),
    periodStart: date,
    periodEnd: date,
    dueDate: optionalDate,
    selfReview: flag,
    mentorReview: flag,
    hrReview: flag,
  })
  .refine((v) => v.periodEnd >= v.periodStart, { message: 'The period ends before it starts', path: ['periodEnd'] })

const answerSchema = z.strictObject({
  questionId: z.uuid(),
  rating: z.coerce.number().int().min(1).max(5).nullable().optional(),
  text: z.string().trim().max(5000).nullable().optional(),
  bool: z.boolean().nullable().optional(),
  selected: z.array(z.string().max(120)).max(12).optional(),
  evidence: z.string().trim().max(2000).nullable().optional(),
  evidenceRefs: z
    .array(z.strictObject({ type: z.enum(RECORD_TYPES), id: z.uuid() }))
    .max(10)
    .optional(),
})

const saveAnswersSchema = z.strictObject({
  reviewId: z.uuid(),
  answers: z.array(answerSchema).max(200),
  submit: z.boolean().default(false),
})

const correctSchema = z.strictObject({
  answerId: z.uuid(),
  rating: z.coerce.number().int().min(1).max(5).nullable().optional(),
  text: z.string().trim().max(5000).nullable().optional(),
  bool: z.boolean().nullable().optional(),
  selected: z.array(z.string().max(120)).max(12).optional(),
  reason: z.string().trim().min(5, 'Explain the correction').max(1000),
})

const reopenSchema = z.strictObject({
  reviewId: z.uuid(),
  stage: z.enum(['SELF_REVIEW', 'MANAGER_REVIEW', 'MENTOR_REVIEW', 'HR_REVIEW']),
  reason: z.string().trim().min(5, 'Explain why the review is reopened').max(1000),
})

export const reviewFilterSchema = z.object({
  cycleId: optionalUuid,
  internId: optionalUuid,
  status: z
    .enum(['SELF_REVIEW', 'MANAGER_REVIEW', 'MENTOR_REVIEW', 'HR_REVIEW', 'COMPLETED', 'OVERDUE', ''])
    .optional()
    .transform((v) => v || undefined),
  q: optionalText(100),
})

// ── Helpers ─────────────────────────────────────────────────────────────────

function requireTemplateManager(ctx: RequestContext) {
  if (authorizationService.scopeOf(ctx, 'performance_template.manage') !== 'ORGANIZATION') throw new ForbiddenError()
}
function requireCycleManager(ctx: RequestContext) {
  if (authorizationService.scopeOf(ctx, 'performance_cycle.manage') !== 'ORGANIZATION') throw new ForbiddenError()
}

/** A template's structure can't change once any review has answers against it. */
async function templateLocked(templateId: string) {
  return (await prisma.performanceReviewAnswer.count({ where: { review: { template_id: templateId } } })) > 0
}

async function editableTemplate(ctx: RequestContext, templateId: string) {
  requireTemplateManager(ctx)
  const template = await prisma.performanceTemplate.findFirst({
    where: { id: templateId, organization_id: ctx.organization.id },
    select: { id: true },
  })
  if (!template) throw new NotFoundError('Template')
  if (await templateLocked(template.id)) {
    throw new ConflictError('Reviews already use this template — duplicate it to make changes')
  }
  return template
}

async function sectionOf(ctx: RequestContext, sectionId: string) {
  const section = await prisma.performanceSection.findFirst({
    where: { id: sectionId, template: { organization_id: ctx.organization.id } },
    select: { id: true, template_id: true },
  })
  if (!section) throw new NotFoundError('Section')
  await editableTemplate(ctx, section.template_id)
  return section
}

async function touchTemplate(ctx: RequestContext, templateId: string, metadata: Record<string, unknown>) {
  await prisma.performanceTemplate.update({ where: { id: templateId }, data: { updated_at: new Date() } })
  await auditService.logForContext(ctx, {
    action: AUDIT_ACTIONS.REVIEW_TEMPLATE_SAVED,
    resourceType: 'performance_template',
    resourceId: templateId,
    metadata,
  })
}

async function swapPositions<T extends { id: string; position: number }>(
  rows: T[],
  id: string,
  direction: 'up' | 'down',
  write: (id: string, position: number) => Promise<unknown>,
) {
  const ids = rows.map((r) => r.id)
  const index = ids.indexOf(id)
  const target = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || target < 0 || target >= ids.length) return
  ;[ids[index], ids[target]] = [ids[target], ids[index]]
  for (const [position, rowId] of ids.entries()) await write(rowId, position)
}

function stageConfig(review: {
  self_review_enabled: boolean
  mentor_review_enabled: boolean
  hr_review_enabled: boolean
  mentor_id: string | null
}): StageConfig {
  return {
    self: review.self_review_enabled,
    mentor: review.mentor_review_enabled,
    hr: review.hr_review_enabled,
    hasMentor: Boolean(review.mentor_id),
  }
}

const NOTICE_FOR_STAGE: Record<ReviewStage, 'SELF_DUE' | 'MANAGER_DUE' | 'MENTOR_DUE' | 'HR_DUE'> = {
  SELF_REVIEW: 'SELF_DUE',
  MANAGER_REVIEW: 'MANAGER_DUE',
  MENTOR_REVIEW: 'MENTOR_DUE',
  HR_REVIEW: 'HR_DUE',
}

async function stageRecipients(
  organizationId: string,
  stage: ReviewStage,
  review: { reviewer_id: string; mentor_id: string | null; intern: { user_id: string } },
) {
  switch (stage) {
    case 'SELF_REVIEW':
      return [review.intern.user_id]
    case 'MANAGER_REVIEW':
      return [review.reviewer_id]
    case 'MENTOR_REVIEW':
      return review.mentor_id ? [review.mentor_id] : []
    case 'HR_REVIEW':
      return (await usersWithPermission(organizationId, 'performance.review')).filter((id) => id !== review.intern.user_id)
  }
}

async function noticeStage(
  organizationId: string,
  actorUserId: string | null,
  reviewId: string,
  stage: ReviewStage,
  review: Parameters<typeof stageRecipients>[2],
) {
  await domainEvents.emit('performance.review_notice', {
    organizationId,
    actorUserId,
    payload: { reviewId, kind: NOTICE_FOR_STAGE[stage], recipientIds: await stageRecipients(organizationId, stage, review) },
  })
}

const reviewCore = {
  id: true,
  organization_id: true,
  status: true,
  reviewer_id: true,
  mentor_id: true,
  cycle_id: true,
  template_id: true,
  review_period_start: true,
  review_period_end: true,
  due_date: true,
  self_review_enabled: true,
  mentor_review_enabled: true,
  hr_review_enabled: true,
  stage_submitted: true,
  completed_at: true,
  locked_at: true,
  reopened_at: true,
  reopen_reason: true,
  created_at: true,
  intern: { select: internPlacementSelect },
  reviewer: { select: personSelect },
  mentor: { select: personSelect },
  completer: { select: personSelect },
  cycle: { select: { id: true, name: true, cycle_type: true } },
} as const satisfies Prisma.PerformanceReviewSelect

type ReviewCore = Prisma.PerformanceReviewGetPayload<{ select: typeof reviewCore }>

function viewerFor(ctx: RequestContext, review: ReviewCore): ReviewViewer {
  const isSelf = review.intern.user_id === ctx.actor.userId
  return {
    isSelf,
    isManager: review.reviewer_id === ctx.actor.userId,
    isMentor: review.mentor_id === ctx.actor.userId,
    isHr: !isSelf && authorizationService.scopeOf(ctx, 'performance.review') === 'ORGANIZATION',
  }
}

/** Loads a review the viewer takes part in or may read (404 otherwise). */
async function loadReview(ctx: RequestContext, reviewId: string) {
  const review = await prisma.performanceReview.findFirst({
    where: { id: parseInput(z.uuid(), reviewId), organization_id: ctx.organization.id },
    select: reviewCore,
  })
  if (!review) throw new NotFoundError('Review')
  const viewer = viewerFor(ctx, review)
  const participant = viewer.isSelf || viewer.isManager || viewer.isMentor || viewer.isHr
  if (!participant && !covers(ctx, 'performance.read', review.intern)) throw new NotFoundError('Review')
  if (viewer.isSelf && !authorizationService.can(ctx, 'performance.read')) throw new NotFoundError('Review')
  return { review, viewer }
}

function canWrite(ctx: RequestContext, respondent: ReviewRespondent | null) {
  if (!respondent) return false
  return respondent === 'HR' ? authorizationService.can(ctx, 'performance.review') : authorizationService.can(ctx, 'performance.update')
}

async function templateStructure(templateId: string) {
  return prisma.performanceSection.findMany({
    where: { template_id: templateId },
    orderBy: [{ position: 'asc' }],
    select: {
      id: true,
      title: true,
      description: true,
      respondents: true,
      questions: {
        orderBy: [{ position: 'asc' }],
        select: {
          id: true,
          prompt: true,
          question_type: true,
          guidance: true,
          options: true,
          is_required: true,
          requires_evidence: true,
        },
      },
    },
  })
}

function answerSnapshot(a: { rating: number | null; text_value: string | null; bool_value: boolean | null; selected_options: string[] }) {
  return { rating: a.rating, text: a.text_value, bool: a.bool_value, selected: a.selected_options }
}

// ── Service ─────────────────────────────────────────────────────────────────

export const performanceReviewService = {
  // Templates
  async templates(ctx: RequestContext) {
    requireTemplateManager(ctx)
    return prisma.performanceTemplate.findMany({
      where: { organization_id: ctx.organization.id },
      orderBy: [{ is_active: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        is_active: true,
        updated_at: true,
        _count: { select: { sections: true, cycles: true, reviews: true } },
      },
    })
  },

  async activeTemplates(ctx: RequestContext) {
    return prisma.performanceTemplate.findMany({
      where: { organization_id: ctx.organization.id, is_active: true, sections: { some: { questions: { some: {} } } } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    })
  },

  async template(ctx: RequestContext, templateId: string) {
    requireTemplateManager(ctx)
    const template = await prisma.performanceTemplate.findFirst({
      where: { id: parseInput(z.uuid(), templateId), organization_id: ctx.organization.id },
      select: { id: true, name: true, description: true, is_active: true, updated_at: true },
    })
    if (!template) throw new NotFoundError('Template')
    return { template, sections: await templateStructure(template.id), locked: await templateLocked(template.id) }
  },

  async saveTemplate(ctx: RequestContext, input: unknown) {
    requireTemplateManager(ctx)
    const data = parseInput(templateSchema, input)
    const values = { name: data.name, description: data.description ?? null, is_active: data.active }
    let id = data.templateId
    if (id) {
      const { count } = await prisma.performanceTemplate.updateMany({
        where: { id, organization_id: ctx.organization.id },
        data: values,
      })
      if (!count) throw new NotFoundError('Template')
    } else {
      id = (
        await prisma.performanceTemplate.create({
          data: { ...values, is_active: true, organization_id: ctx.organization.id, created_by: ctx.actor.userId },
          select: { id: true },
        })
      ).id
    }
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.REVIEW_TEMPLATE_SAVED,
      resourceType: 'performance_template',
      resourceId: id,
      metadata: { name: data.name, active: data.templateId ? data.active : true },
    })
    return { id }
  },

  async duplicateTemplate(ctx: RequestContext, templateId: string) {
    requireTemplateManager(ctx)
    const source = await prisma.performanceTemplate.findFirst({
      where: { id: parseInput(z.uuid(), templateId), organization_id: ctx.organization.id },
      select: { name: true, description: true },
    })
    if (!source) throw new NotFoundError('Template')
    const sections = await templateStructure(templateId)
    const copy = await prisma.performanceTemplate.create({
      data: {
        organization_id: ctx.organization.id,
        name: `${source.name} (copy)`.slice(0, 160),
        description: source.description,
        created_by: ctx.actor.userId,
        sections: {
          create: sections.map((s, position) => ({
            title: s.title,
            description: s.description,
            respondents: s.respondents,
            position,
            questions: {
              create: s.questions.map((q, qPosition) => ({
                prompt: q.prompt,
                question_type: q.question_type,
                guidance: q.guidance,
                options: q.options,
                is_required: q.is_required,
                requires_evidence: q.requires_evidence,
                position: qPosition,
              })),
            },
          })),
        },
      },
      select: { id: true },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.REVIEW_TEMPLATE_SAVED,
      resourceType: 'performance_template',
      resourceId: copy.id,
      metadata: { duplicatedFrom: templateId },
    })
    return { id: copy.id }
  },

  async saveSection(ctx: RequestContext, input: unknown) {
    const data = parseInput(sectionSchema, input)
    await editableTemplate(ctx, data.templateId)
    const values = { title: data.title, description: data.description ?? null, respondents: [...new Set(data.respondents)] }
    if (data.sectionId) {
      const { count } = await prisma.performanceSection.updateMany({
        where: { id: data.sectionId, template_id: data.templateId },
        data: values,
      })
      if (!count) throw new NotFoundError('Section')
    } else {
      const position = await prisma.performanceSection.count({ where: { template_id: data.templateId } })
      await prisma.performanceSection.create({ data: { ...values, template_id: data.templateId, position } })
    }
    await touchTemplate(ctx, data.templateId, { section: data.title })
  },

  async deleteSection(ctx: RequestContext, sectionId: string) {
    const section = await sectionOf(ctx, parseInput(z.uuid(), sectionId))
    await prisma.performanceSection.delete({ where: { id: section.id } })
    await touchTemplate(ctx, section.template_id, { sectionDeleted: section.id })
  },

  async moveSection(ctx: RequestContext, input: unknown) {
    const data = parseInput(z.strictObject({ sectionId: z.uuid(), direction: z.enum(['up', 'down']) }), input)
    const section = await sectionOf(ctx, data.sectionId)
    const rows = await prisma.performanceSection.findMany({
      where: { template_id: section.template_id },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    })
    await swapPositions(rows, section.id, data.direction, (id, position) =>
      prisma.performanceSection.update({ where: { id }, data: { position } }),
    )
  },

  async saveQuestion(ctx: RequestContext, input: unknown) {
    const data = parseInput(questionSchema, input)
    const section = await sectionOf(ctx, data.sectionId)
    const values = {
      prompt: data.prompt,
      question_type: data.type,
      guidance: data.guidance ?? null,
      options: data.type === 'MULTI_SELECT' ? [...new Set(data.options)] : [],
      is_required: data.required,
      requires_evidence: data.requiresEvidence,
    }
    if (data.questionId) {
      const { count } = await prisma.performanceQuestion.updateMany({
        where: { id: data.questionId, section: { template_id: section.template_id } },
        data: { ...values, section_id: section.id },
      })
      if (!count) throw new NotFoundError('Question')
    } else {
      const position = await prisma.performanceQuestion.count({ where: { section_id: section.id } })
      await prisma.performanceQuestion.create({ data: { ...values, section_id: section.id, position } })
    }
    await touchTemplate(ctx, section.template_id, { question: data.prompt.slice(0, 80) })
  },

  async deleteQuestion(ctx: RequestContext, questionId: string) {
    const question = await prisma.performanceQuestion.findFirst({
      where: { id: parseInput(z.uuid(), questionId), section: { template: { organization_id: ctx.organization.id } } },
      select: { id: true, section_id: true },
    })
    if (!question) throw new NotFoundError('Question')
    const section = await sectionOf(ctx, question.section_id)
    await prisma.performanceQuestion.delete({ where: { id: question.id } })
    await touchTemplate(ctx, section.template_id, { questionDeleted: question.id })
  },

  async moveQuestion(ctx: RequestContext, input: unknown) {
    const data = parseInput(z.strictObject({ questionId: z.uuid(), direction: z.enum(['up', 'down']) }), input)
    const question = await prisma.performanceQuestion.findFirst({
      where: { id: data.questionId, section: { template: { organization_id: ctx.organization.id } } },
      select: { id: true, section_id: true },
    })
    if (!question) throw new NotFoundError('Question')
    await sectionOf(ctx, question.section_id)
    const rows = await prisma.performanceQuestion.findMany({
      where: { section_id: question.section_id },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    })
    await swapPositions(rows, question.id, data.direction, (id, position) =>
      prisma.performanceQuestion.update({ where: { id }, data: { position } }),
    )
  },

  // Cycles
  async cycles(ctx: RequestContext) {
    requireCycleManager(ctx)
    const cycles = await prisma.performanceCycle.findMany({
      where: { organization_id: ctx.organization.id },
      orderBy: [{ status: 'asc' }, { due_date: 'desc' }],
      select: {
        id: true,
        name: true,
        cycle_type: true,
        status: true,
        start_date: true,
        due_date: true,
        department: { select: { name: true } },
        template: { select: { id: true, name: true } },
      },
    })
    const counts = await prisma.performanceReview.groupBy({
      by: ['cycle_id', 'status'],
      where: { organization_id: ctx.organization.id, cycle_id: { in: cycles.map((c) => c.id) } },
      _count: { _all: true },
    })
    return cycles.map((c) => {
      const mine = counts.filter((x) => x.cycle_id === c.id)
      const total = mine.reduce((s, x) => s + x._count._all, 0)
      const completed = mine.find((x) => x.status === 'COMPLETED')?._count._all ?? 0
      return { ...c, reviews: total, completed }
    })
  },

  async cycle(ctx: RequestContext, cycleId: string) {
    requireCycleManager(ctx)
    const cycle = await prisma.performanceCycle.findFirst({
      where: { id: parseInput(z.uuid(), cycleId), organization_id: ctx.organization.id },
      select: {
        id: true,
        name: true,
        cycle_type: true,
        status: true,
        start_date: true,
        due_date: true,
        department_id: true,
        template_id: true,
        self_review_enabled: true,
        mentor_review_enabled: true,
        hr_review_enabled: true,
        opened_at: true,
        closed_at: true,
        department: { select: { name: true } },
        template: { select: { id: true, name: true } },
        reviews: {
          orderBy: { intern: { user: { first_name: 'asc' } } },
          select: {
            id: true,
            status: true,
            due_date: true,
            completed_at: true,
            intern: { select: { id: true, user: { select: personSelect } } },
            reviewer: { select: personSelect },
            mentor: { select: personSelect },
          },
        },
      },
    })
    if (!cycle) throw new NotFoundError('Cycle')
    const today = todayIn(ctx.organization.timezone)
    return {
      cycle,
      reviews: cycle.reviews.map((r) => ({ ...r, overdue: Boolean(r.due_date && r.due_date < today && r.status !== 'COMPLETED') })),
    }
  },

  async saveCycle(ctx: RequestContext, input: unknown) {
    requireCycleManager(ctx)
    const data = parseInput(cycleSchema, input)
    const template = await prisma.performanceTemplate.findFirst({
      where: { id: data.templateId, organization_id: ctx.organization.id, is_active: true },
      select: { id: true },
    })
    if (!template) throw new ValidationError('Choose an active template', { templateId: 'Not found' })
    if (data.departmentId) {
      const dept = await prisma.department.count({ where: { id: data.departmentId, organization_id: ctx.organization.id } })
      if (!dept) throw new ValidationError('Choose a department', { departmentId: 'Not found' })
    }
    const values = {
      name: data.name,
      cycle_type: data.type,
      template_id: template.id,
      start_date: parseDateOnly(data.startDate),
      due_date: parseDateOnly(data.dueDate),
      department_id: data.departmentId ?? null,
      self_review_enabled: data.selfReview,
      mentor_review_enabled: data.mentorReview,
      hr_review_enabled: data.hrReview,
    }
    let id = data.cycleId
    if (id) {
      const { count } = await prisma.performanceCycle.updateMany({
        where: { id, organization_id: ctx.organization.id, status: 'DRAFT' },
        data: values,
      })
      if (!count) throw new ConflictError('Only draft cycles can be edited')
    } else {
      id = (
        await prisma.performanceCycle.create({
          data: { ...values, organization_id: ctx.organization.id, created_by: ctx.actor.userId },
          select: { id: true },
        })
      ).id
    }
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.REVIEW_CYCLE_SAVED,
      resourceType: 'performance_cycle',
      resourceId: id,
      metadata: { name: data.name, type: data.type, due: data.dueDate },
    })
    return { id }
  },

  /** Opens a draft cycle: one review per in-programme intern (in the department, if set) who has a manager. */
  async openCycle(ctx: RequestContext, cycleId: string) {
    requireCycleManager(ctx)
    const cycle = await prisma.performanceCycle.findFirst({
      where: { id: parseInput(z.uuid(), cycleId), organization_id: ctx.organization.id },
      select: {
        id: true,
        status: true,
        template_id: true,
        start_date: true,
        due_date: true,
        department_id: true,
        self_review_enabled: true,
        mentor_review_enabled: true,
        hr_review_enabled: true,
      },
    })
    if (!cycle) throw new NotFoundError('Cycle')
    if (cycle.status !== 'DRAFT') throw new ConflictError('This cycle is already open')
    const questions = await prisma.performanceQuestion.count({ where: { section: { template_id: cycle.template_id } } })
    if (!questions) throw new ValidationError('The template has no questions yet')
    const { count } = await prisma.performanceCycle.updateMany({
      where: { id: cycle.id, status: 'DRAFT' },
      data: { status: 'OPEN', opened_at: new Date() },
    })
    if (!count) throw new ConflictError('This cycle is already open')
    const interns = await prisma.intern.findMany({
      where: {
        organization_id: ctx.organization.id,
        deleted_at: null,
        status: { in: TRACKED_STATUSES },
        ...(cycle.department_id ? { department_id: cycle.department_id } : {}),
      },
      select: { id: true, user_id: true, manager_id: true, mentor_id: true },
    })
    let created = 0
    const skipped: string[] = []
    for (const intern of interns) {
      if (!intern.manager_id) {
        skipped.push(intern.id)
        continue
      }
      const config = {
        self: cycle.self_review_enabled,
        mentor: cycle.mentor_review_enabled,
        hr: cycle.hr_review_enabled,
        hasMentor: Boolean(intern.mentor_id),
      }
      const stage = firstStage(config)
      // One review per intern and cycle (partial unique index); an existing one is left alone.
      const exists = await prisma.performanceReview.count({ where: { cycle_id: cycle.id, intern_id: intern.id } })
      if (exists) continue
      const review = await prisma.performanceReview.create({
        data: {
          organization_id: ctx.organization.id,
          intern_id: intern.id,
          reviewer_id: intern.manager_id,
          mentor_id: intern.mentor_id,
          cycle_id: cycle.id,
          template_id: cycle.template_id,
          review_period_start: cycle.start_date,
          review_period_end: cycle.due_date,
          due_date: cycle.due_date,
          self_review_enabled: cycle.self_review_enabled,
          mentor_review_enabled: cycle.mentor_review_enabled,
          hr_review_enabled: cycle.hr_review_enabled,
          status: stage,
        },
        select: { id: true },
      })
      created++
      await domainEvents.emit('performance.review_notice', {
        organizationId: ctx.organization.id,
        actorUserId: ctx.actor.userId,
        payload: { reviewId: review.id, kind: 'OPENED', recipientIds: [intern.user_id] },
      })
      await noticeStage(ctx.organization.id, ctx.actor.userId, review.id, stage, {
        reviewer_id: intern.manager_id,
        mentor_id: intern.mentor_id,
        intern: { user_id: intern.user_id },
      })
    }
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.REVIEW_CYCLE_OPENED,
      resourceType: 'performance_cycle',
      resourceId: cycle.id,
      metadata: { reviews: created, skippedWithoutManager: skipped.length },
    })
    return { created, skipped: skipped.length }
  },

  async setCycleStatus(ctx: RequestContext, input: unknown) {
    requireCycleManager(ctx)
    const data = parseInput(z.strictObject({ cycleId: z.uuid(), status: z.enum(['IN_REVIEW', 'COMPLETED', 'ARCHIVED']) }), input)
    const cycle = await prisma.performanceCycle.findFirst({
      where: { id: data.cycleId, organization_id: ctx.organization.id },
      select: { id: true, status: true },
    })
    if (!cycle) throw new NotFoundError('Cycle')
    const allowed: Record<string, string[]> = { OPEN: ['IN_REVIEW', 'COMPLETED'], IN_REVIEW: ['COMPLETED'], COMPLETED: ['ARCHIVED'] }
    if (!allowed[cycle.status]?.includes(data.status)) throw new ConflictError('That change isn’t possible for this cycle')
    if (data.status === 'COMPLETED') {
      const open = await prisma.performanceReview.count({ where: { cycle_id: cycle.id, status: { not: 'COMPLETED' } } })
      if (open) throw new ValidationError(`${open} review${open === 1 ? ' is' : 's are'} not completed yet`)
    }
    await prisma.performanceCycle.update({
      where: { id: cycle.id },
      data: { status: data.status, ...(data.status === 'COMPLETED' ? { closed_at: new Date() } : {}) },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.REVIEW_CYCLE_SAVED,
      resourceType: 'performance_cycle',
      resourceId: cycle.id,
      metadata: { before: cycle.status, after: data.status },
    })
  },

  // Reviews
  async list(ctx: RequestContext, query: unknown = {}) {
    authorizationService.require(ctx, 'performance.read')
    const filters = parseInput(reviewFilterSchema, query)
    const internWhere = scopedInternWhere(ctx, 'performance.read')
    const me = ctx.actor.userId
    const today = todayIn(ctx.organization.timezone)
    const statusWhere: Prisma.PerformanceReviewWhereInput =
      filters.status === 'OVERDUE'
        ? { status: { not: 'COMPLETED' }, due_date: { lt: today } }
        : filters.status
          ? { status: filters.status }
          : {}
    const rows = await prisma.performanceReview.findMany({
      where: {
        AND: [
          { organization_id: ctx.organization.id, template_id: { not: null } },
          { OR: [{ reviewer_id: me }, { mentor_id: me }, ...(internWhere ? [{ intern: internWhere }] : [])] },
          statusWhere,
          filters.cycleId ? { cycle_id: filters.cycleId } : {},
          filters.internId ? { intern_id: filters.internId } : {},
          filters.q
            ? {
                OR: [
                  { intern: { user: { first_name: { contains: filters.q, mode: 'insensitive' } } } },
                  { intern: { user: { last_name: { contains: filters.q, mode: 'insensitive' } } } },
                  { cycle: { name: { contains: filters.q, mode: 'insensitive' } } },
                ],
              }
            : {},
        ],
      },
      orderBy: [{ due_date: { sort: 'asc', nulls: 'last' } }, { created_at: 'desc' }],
      take: 200,
      select: {
        id: true,
        status: true,
        due_date: true,
        review_period_start: true,
        review_period_end: true,
        completed_at: true,
        self_review_enabled: true,
        mentor_review_enabled: true,
        hr_review_enabled: true,
        reviewer_id: true,
        mentor_id: true,
        cycle: { select: { id: true, name: true } },
        intern: { select: { id: true, user_id: true, user: { select: personSelect } } },
        reviewer: { select: personSelect },
      },
    })
    const hr = authorizationService.scopeOf(ctx, 'performance.review') === 'ORGANIZATION'
    const reviews = rows.map((r) => {
      const viewer = {
        isSelf: r.intern.user_id === me,
        isManager: r.reviewer_id === me,
        isMentor: r.mentor_id === me,
        isHr: hr && r.intern.user_id !== me,
      }
      return {
        ...r,
        overdue: Boolean(r.due_date && r.due_date < today && r.status !== 'COMPLETED'),
        myTurn: Boolean(respondentFor(viewer, r.status)),
      }
    })
    const cycles = await prisma.performanceCycle.findMany({
      where: { organization_id: ctx.organization.id, status: { not: 'DRAFT' } },
      orderBy: { due_date: 'desc' },
      select: { id: true, name: true },
    })
    return {
      filters,
      reviews,
      cycles,
      can: {
        start: authorizationService.can(ctx, 'performance.create'),
        manageCycles: authorizationService.scopeOf(ctx, 'performance_cycle.manage') === 'ORGANIZATION',
        manageTemplates: authorizationService.scopeOf(ctx, 'performance_template.manage') === 'ORGANIZATION',
      },
    }
  },

  /** Global search: reviews the viewer takes part in or may read, by intern or cycle name. */
  async search(ctx: RequestContext, term: string, take: number) {
    const page = await this.list(ctx, { q: term })
    return page.reviews.slice(0, take)
  },

  /** A review with exactly the answers this viewer may see, plus the form for their own part. */
  async get(ctx: RequestContext, reviewId: string) {
    const { review, viewer } = await loadReview(ctx, reviewId)
    const sections = review.template_id ? await templateStructure(review.template_id) : []
    const answers = await prisma.performanceReviewAnswer.findMany({
      where: { review_id: review.id },
      select: {
        id: true,
        question_id: true,
        respondent: true,
        rating: true,
        text_value: true,
        bool_value: true,
        selected_options: true,
        evidence: true,
        evidence_refs: true,
        updated_at: true,
        author: { select: personSelect },
      },
    })
    const visible = answers.filter((a) => canSeeAnswers(a.respondent, viewer, review))
    const config = stageConfig(review)
    const myRespondent = review.locked_at ? null : respondentFor(viewer, review.status)
    const writable = canWrite(ctx, myRespondent)
    const revisions = viewer.isHr
      ? await prisma.performanceReviewRevision.findMany({
          where: { review_id: review.id },
          orderBy: { created_at: 'desc' },
          select: { id: true, reason: true, before: true, after: true, created_at: true, answer_id: true, actor: { select: personSelect } },
        })
      : []
    const plans = await prisma.developmentPlan.findMany({
      where: { review_id: review.id },
      select: { id: true, title: true, status: true },
    })
    const showPlans = viewer.isHr || viewer.isManager || viewer.isMentor || (viewer.isSelf && review.status === 'COMPLETED')
    return {
      review,
      viewer,
      stages: reviewStages(config).map((stage) => ({
        stage,
        respondent: respondentForStage(stage)!,
        submitted: review.stage_submitted.includes(respondentForStage(stage)!),
        current: review.status === stage,
      })),
      sections: sections.map((s) => ({
        ...s,
        questions: s.questions.map((q) => ({
          ...q,
          answers: visible.filter((a) => a.question_id === q.id),
        })),
      })),
      myRespondent: writable ? myRespondent : null,
      revisions,
      plans: showPlans ? plans : [],
      can: {
        write: writable,
        correct: viewer.isHr && review.status === 'COMPLETED',
        reopen: viewer.isHr && review.status === 'COMPLETED',
        plan: !viewer.isSelf && covers(ctx, 'performance.update', review.intern),
      },
    }
  },

  /** Save (draft) or submit the viewer's part for the current stage. */
  async saveAnswers(ctx: RequestContext, input: unknown) {
    const data = parseInput(saveAnswersSchema, input)
    const { review, viewer } = await loadReview(ctx, data.reviewId)
    if (review.locked_at || review.status === 'COMPLETED') throw new ConflictError('This review is completed and locked')
    const respondent = respondentFor(viewer, review.status)
    if (!respondent || !canWrite(ctx, respondent)) throw new ForbiddenError('It isn’t your turn on this review')
    if (!review.template_id) throw new ValidationError('This review has no template')
    const sections = (await templateStructure(review.template_id)).filter((s) => s.respondents.includes(respondent))
    const questions = new Map(sections.flatMap((s) => s.questions).map((q) => [q.id, q]))
    const errors: Record<string, string> = {}
    for (const answer of data.answers) {
      const question = questions.get(answer.questionId)
      if (!question) throw new ValidationError('That question isn’t part of your section')
      const error = validateReviewAnswer(question, answer, false)
      if (error) errors[answer.questionId] = error
      for (const ref of answer.evidenceRefs ?? []) {
        if (!(await resolveRecord(ctx.organization.id, review.intern, ref.type, ref.id))) {
          errors[answer.questionId] = 'Linked evidence must be this intern’s records'
        }
      }
    }
    if (Object.keys(errors).length) throw new ValidationError('Check the highlighted answers', errors)

    for (const answer of data.answers) {
      const question = questions.get(answer.questionId)!
      const values = {
        rating: question.question_type === 'RATING' ? (answer.rating ?? null) : null,
        text_value: question.question_type === 'TEXT' ? answer.text || null : null,
        bool_value: question.question_type === 'BOOLEAN' ? (answer.bool ?? null) : null,
        selected_options: question.question_type === 'MULTI_SELECT' ? (answer.selected ?? []) : [],
        evidence: answer.evidence || null,
        evidence_refs: (answer.evidenceRefs ?? []) as Prisma.InputJsonValue,
        author_id: ctx.actor.userId,
      }
      await prisma.performanceReviewAnswer.upsert({
        where: {
          review_id_question_id_respondent: { review_id: review.id, question_id: question.id, respondent },
        },
        create: { ...values, review_id: review.id, question_id: question.id, respondent },
        update: values,
      })
    }
    if (!data.submit) {
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.REVIEW_UPDATED,
        resourceType: 'review',
        resourceId: review.id,
        metadata: { respondent, answers: data.answers.length },
      })
      return { submitted: false as const, status: review.status }
    }

    // Final check over every question of the respondent's sections (including ones not sent now).
    const saved = await prisma.performanceReviewAnswer.findMany({
      where: { review_id: review.id, respondent },
      select: { question_id: true, rating: true, text_value: true, bool_value: true, selected_options: true, evidence: true },
    })
    for (const question of questions.values()) {
      const a = saved.find((s) => s.question_id === question.id)
      const error = validateReviewAnswer(
        question,
        { rating: a?.rating, text: a?.text_value, bool: a?.bool_value, selected: a?.selected_options ?? [], evidence: a?.evidence },
        true,
      )
      if (error) errors[question.id] = error
    }
    if (Object.keys(errors).length) throw new ValidationError('Answer the required questions before submitting', errors)

    const stage = review.status as ReviewStage
    const next = nextStage(stage, stageConfig(review))
    const now = new Date()
    const { count } = await prisma.performanceReview.updateMany({
      where: { id: review.id, status: review.status, locked_at: null },
      data: {
        status: next,
        stage_submitted: { push: respondent },
        submitted_at: now,
        ...(next === 'COMPLETED' ? { completed_at: now, completed_by: ctx.actor.userId, locked_at: now } : {}),
      },
    })
    if (!count) throw new ConflictError('The review moved on — refresh and try again')
    await auditService.logForContext(ctx, {
      action: next === 'COMPLETED' ? AUDIT_ACTIONS.REVIEW_COMPLETED : AUDIT_ACTIONS.REVIEW_SUBMITTED,
      resourceType: 'review',
      resourceId: review.id,
      metadata: { respondent, from: review.status, to: next, internId: review.intern.id },
    })
    if (next === 'COMPLETED') {
      await domainEvents.emit('performance.review_notice', {
        organizationId: ctx.organization.id,
        actorUserId: ctx.actor.userId,
        payload: {
          reviewId: review.id,
          kind: 'COMPLETED',
          recipientIds: [review.intern.user_id, review.reviewer_id, review.mentor_id].filter((x): x is string => Boolean(x)),
        },
      })
    } else {
      await noticeStage(ctx.organization.id, ctx.actor.userId, review.id, next, review)
    }
    return { submitted: true as const, status: next }
  },

  /** HR correction of a locked review: the previous value is kept as a revision and audited. */
  async correctAnswer(ctx: RequestContext, input: unknown) {
    const data = parseInput(correctSchema, input)
    const answer = await prisma.performanceReviewAnswer.findFirst({
      where: { id: data.answerId, review: { organization_id: ctx.organization.id } },
      select: {
        id: true,
        review_id: true,
        respondent: true,
        rating: true,
        text_value: true,
        bool_value: true,
        selected_options: true,
        question: { select: { question_type: true, options: true, is_required: true, requires_evidence: false } },
      },
    })
    if (!answer) throw new NotFoundError('Answer')
    const { review, viewer } = await loadReview(ctx, answer.review_id)
    if (!viewer.isHr || !authorizationService.can(ctx, 'performance.review')) throw new ForbiddenError()
    if (review.status !== 'COMPLETED') throw new ConflictError('Only completed reviews are corrected — edit open ones directly')
    const type = answer.question.question_type
    const error = validateReviewAnswer(
      { ...answer.question, requires_evidence: false },
      { rating: data.rating, text: data.text, bool: data.bool, selected: data.selected },
      true,
    )
    if (error) throw new ValidationError(error)
    const after = {
      rating: type === 'RATING' ? (data.rating ?? null) : null,
      text_value: type === 'TEXT' ? data.text || null : null,
      bool_value: type === 'BOOLEAN' ? (data.bool ?? null) : null,
      selected_options: type === 'MULTI_SELECT' ? (data.selected ?? []) : [],
    }
    const before = answerSnapshot(answer)
    await prisma.$transaction([
      prisma.performanceReviewRevision.create({
        data: {
          review_id: review.id,
          answer_id: answer.id,
          actor_id: ctx.actor.userId,
          reason: data.reason,
          before: before as Prisma.InputJsonValue,
          after: answerSnapshot(after) as Prisma.InputJsonValue,
        },
      }),
      prisma.performanceReviewAnswer.update({ where: { id: answer.id }, data: after }),
    ])
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.REVIEW_CORRECTED,
      resourceType: 'review',
      resourceId: review.id,
      metadata: { answerId: answer.id, respondent: answer.respondent, reason: data.reason, before, after: answerSnapshot(after) },
    })
  },

  /** HR reopens a completed review at a chosen stage (that stage and later ones are submitted again). */
  async reopen(ctx: RequestContext, input: unknown) {
    const data = parseInput(reopenSchema, input)
    const { review, viewer } = await loadReview(ctx, data.reviewId)
    if (!viewer.isHr || !authorizationService.can(ctx, 'performance.review')) throw new ForbiddenError()
    if (review.status !== 'COMPLETED') throw new ConflictError('Only completed reviews can be reopened')
    const stages = reviewStages(stageConfig(review))
    const index = stages.indexOf(data.stage)
    if (index < 0) throw new ValidationError('That stage isn’t part of this review')
    const keep = stages.slice(0, index).map((s) => respondentForStage(s)!)
    const { count } = await prisma.performanceReview.updateMany({
      where: { id: review.id, status: 'COMPLETED' },
      data: {
        status: data.stage as PerformanceReviewStatus,
        stage_submitted: review.stage_submitted.filter((r) => keep.includes(r)),
        locked_at: null,
        completed_at: null,
        completed_by: null,
        reopened_at: new Date(),
        reopen_reason: data.reason,
      },
    })
    if (!count) throw new ConflictError('This review was already reopened')
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.REVIEW_REOPENED,
      resourceType: 'review',
      resourceId: review.id,
      metadata: { stage: data.stage, reason: data.reason },
    })
    await noticeStage(ctx.organization.id, ctx.actor.userId, review.id, data.stage, review)
  },

  /** An ad-hoc review outside a cycle (manager or HR). */
  async start(ctx: RequestContext, input: unknown) {
    const data = parseInput(startSchema, input)
    const intern = await requireInternFor(ctx, 'performance.create', data.internId).catch(async (error) => {
      if (authorizationService.scopeOf(ctx, 'performance_cycle.manage') === 'ORGANIZATION') {
        return requireInternFor(ctx, 'performance.read', data.internId)
      }
      throw error
    })
    if (intern.user_id === ctx.actor.userId) throw new ForbiddenError('You can’t start your own review')
    if (!intern.manager_id) throw new ValidationError('Assign a manager to the intern first')
    const template = await prisma.performanceTemplate.findFirst({
      where: { id: data.templateId, organization_id: ctx.organization.id, is_active: true },
      select: { id: true },
    })
    if (!template) throw new ValidationError('Choose an active template', { templateId: 'Not found' })
    const config = { self: data.selfReview, mentor: data.mentorReview, hr: data.hrReview, hasMentor: Boolean(intern.mentor_id) }
    const stage = firstStage(config)
    const review = await prisma.performanceReview.create({
      data: {
        organization_id: ctx.organization.id,
        intern_id: intern.id,
        reviewer_id: intern.manager_id,
        mentor_id: intern.mentor_id,
        template_id: template.id,
        review_period_start: parseDateOnly(data.periodStart),
        review_period_end: parseDateOnly(data.periodEnd),
        due_date: data.dueDate ? parseDateOnly(data.dueDate) : null,
        self_review_enabled: data.selfReview,
        mentor_review_enabled: data.mentorReview,
        hr_review_enabled: data.hrReview,
        status: stage,
      },
      select: { id: true },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.REVIEW_CREATED,
      resourceType: 'review',
      resourceId: review.id,
      metadata: { internId: intern.id, templateId: template.id, stages: reviewStages(config) },
    })
    await domainEvents.emit('performance.review_notice', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { reviewId: review.id, kind: 'OPENED', recipientIds: [intern.user_id] },
    })
    await noticeStage(ctx.organization.id, ctx.actor.userId, review.id, stage, {
      reviewer_id: intern.manager_id,
      mentor_id: intern.mentor_id,
      intern: { user_id: intern.user_id },
    })
    return { id: review.id }
  },

  /** Interns the viewer may start a review for. */
  async startOptions(ctx: RequestContext) {
    const where =
      authorizationService.scopeOf(ctx, 'performance_cycle.manage') === 'ORGANIZATION'
        ? scopedInternWhere(ctx, 'performance.read')
        : scopedInternWhere(ctx, 'performance.create')
    if (!where) return { interns: [], templates: [] }
    const [interns, templates] = await Promise.all([
      prisma.intern.findMany({
        where: { AND: [where, { user_id: { not: ctx.actor.userId }, status: { in: TRACKED_STATUSES }, manager_id: { not: null } }] },
        orderBy: { user: { first_name: 'asc' } },
        select: { id: true, user: { select: personSelect } },
      }),
      this.activeTemplates(ctx),
    ])
    return { interns, templates }
  },
}

/** Daily job: overdue notices the day after a review's due date (to whoever's stage it is). */
export const reviewJobs = {
  async emitOverdue(options: { organizationId?: string; now?: Date } = {}) {
    const organizations = await prisma.organization.findMany({
      where: options.organizationId ? { id: options.organizationId } : {},
      select: { id: true, timezone: true },
    })
    let emitted = 0
    for (const org of organizations) {
      const today = todayIn(org.timezone, options.now)
      const reviews = await prisma.performanceReview.findMany({
        where: {
          organization_id: org.id,
          template_id: { not: null },
          status: { in: ['SELF_REVIEW', 'MANAGER_REVIEW', 'MENTOR_REVIEW', 'HR_REVIEW'] },
          due_date: addDays(today, -1),
        },
        select: { id: true, status: true, reviewer_id: true, mentor_id: true, intern: { select: { user_id: true } } },
      })
      for (const review of reviews) {
        emitted++
        await domainEvents.emit('performance.review_notice', {
          organizationId: org.id,
          actorUserId: null,
          payload: {
            reviewId: review.id,
            kind: 'OVERDUE',
            recipientIds: await stageRecipients(org.id, review.status as ReviewStage, review),
          },
        })
      }
    }
    return { reviewsOverdue: emitted }
  },
}

export type ReviewList = Awaited<ReturnType<typeof performanceReviewService.list>>
export type ReviewDetail = Awaited<ReturnType<typeof performanceReviewService.get>>
export type TemplateDetail = Awaited<ReturnType<typeof performanceReviewService.template>>
export type CycleDetail = Awaited<ReturnType<typeof performanceReviewService.cycle>>
