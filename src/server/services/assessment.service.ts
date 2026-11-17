import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { buildAnswerGradingMessages, buildAssessmentQuestionsMessages } from '@/lib/ai/prompts'
import {
  CHUNK_SECONDS,
  CONSENT_VERSION,
  DEADLINE_GRACE_MS,
  PROCTOR_EVENT_TYPES,
  RECORDING_RETENTION_DAYS,
  UPLOAD_GRACE_MS,
  VIOLATION_TYPES,
  integrityScore,
  scorePercent,
  type ProctorEventType,
} from '@/lib/assessments/integrity'
import { prisma } from '@/lib/db/client'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import { logger } from '@/lib/logging'
import { getStorageService } from '@/lib/storage'
import { fullName } from '@/lib/utils/format'
import { parseInput } from '@/lib/validation'
import { generateStructured, getAIProvider } from '../ai/provider'
import { aiSettingsService } from '../ai/settings.service'
import type { RequestContext } from '../context'
import { userScope } from '../repositories/scope'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { NOTIFICATION_TYPES, notificationService } from './notification.service'

/**
 * Proctored task assessments.
 *
 *  intern submits a task version
 *    → assessment PREPARING; AI drafts questions from the task + submission (after the response)
 *    → AWAITING_APPROVAL: a reviewer edits / approves them (or writes them when AI is off)
 *    → READY: the intern consents and starts; camera + microphone and the entire screen
 *      are recorded in 10 s chunks, and the browser reports a timeline of events
 *    → IN_PROGRESS until submitted, timed out, or auto-submitted after too many violations
 *    → SUBMITTED: multiple choice is marked; AI suggests points for short answers
 *    → GRADED by the reviewer (final points), or WAIVED with a reason.
 * Approving the task version requires its assessment to be GRADED and passed, or WAIVED.
 *
 * Access: assessment.read / manage / review follow the scope over the intern
 * (mentors and managers: their interns; HR: everyone); interns hold read + take
 * on their own. Nobody manages or reviews their own assessment. Correct options
 * and rubrics never reach the intern's browser.
 */

const MAX_EVENTS_PER_CALL = 200
/** Each recorder run (start, reload, re-shared screen) numbers its chunks from a new block of 10 000. */
export const SEGMENT_SIZE = 10_000
const MAX_SEQUENCE = 100 * SEGMENT_SIZE
const RESPONSE_GRACE_MS = 2_000

const aiQuestionsSchema = z.object({
  questions: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('MULTIPLE_CHOICE'),
          prompt: z.string().min(5).max(600),
          options: z.array(z.string().min(1).max(300)).length(4),
          correct: z.number().int().min(0).max(3),
          points: z.number().int().min(1).max(5).catch(1),
        }),
        z.object({
          kind: z.literal('SHORT_ANSWER'),
          prompt: z.string().min(5).max(600),
          rubric: z.string().max(800).optional(),
          points: z.number().int().min(1).max(10).catch(3),
        }),
      ]),
    )
    .min(2)
    .max(12),
})

const gradeSchema = z.object({ points: z.number().min(0), feedback: z.string().max(600) })

const questionInput = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('MULTIPLE_CHOICE'),
    prompt: z.string().trim().min(5, 'Write the question').max(600),
    options: z.array(z.string().trim().min(1, 'Fill in every option').max(300)).min(2).max(6),
    correct: z.number().int().min(0),
    points: z.number().int().min(1).max(10),
  }),
  z.strictObject({
    kind: z.literal('SHORT_ANSWER'),
    prompt: z.string().trim().min(5, 'Write the question').max(600),
    rubric: z.string().trim().max(800).optional(),
    points: z.number().int().min(1).max(20),
  }),
])

const saveQuestionsSchema = z.strictObject({
  assessmentId: z.uuid(),
  timeLimitMinutes: z.number().int().min(5).max(120),
  passPercent: z.number().int().min(0).max(100),
  maxViolations: z.number().int().min(0).max(20),
  questions: z.array(questionInput).min(1, 'Add at least one question').max(25),
})

const answersSchema = z.strictObject({
  attemptId: z.uuid(),
  answers: z
    .array(
      z.strictObject({
        questionId: z.uuid(),
        choice: z.number().int().min(0).max(10).nullable().optional(),
        text: z.string().max(5000).nullable().optional(),
      }),
    )
    .max(25),
})

const eventsSchema = z.strictObject({
  attemptId: z.uuid(),
  events: z
    .array(
      z.strictObject({
        type: z.enum(PROCTOR_EVENT_TYPES),
        at: z.iso.datetime(),
        detail: z.record(z.string(), z.union([z.string().max(300), z.number(), z.boolean()])).optional(),
      }),
    )
    .max(MAX_EVENTS_PER_CALL),
  heartbeat: z.boolean().optional(),
})

const startSchema = z.strictObject({
  assessmentId: z.uuid(),
  consent: z.literal(true, { error: 'Agree to the proctoring terms to start' }),
  screenSurface: z.string().max(40).optional(),
  multipleScreens: z.boolean().optional(),
})

const gradeInputSchema = z.strictObject({
  assessmentId: z.uuid(),
  points: z.record(z.uuid(), z.number().min(0).max(100)),
})

const waiveSchema = z.strictObject({ assessmentId: z.uuid(), reason: z.string().trim().min(5, 'Give a reason').max(500) })

const personSelect = { id: true, first_name: true, last_name: true, display_name: true } as const

/** Runs `task` after the response when inside a request; returns false outside one. */
async function afterResponse(task: () => Promise<unknown>) {
  try {
    const { after } = await import('next/server')
    after(async () => {
      try {
        await task()
      } catch (error) {
        logger.error('Background assessment work failed', { error })
      }
    })
    return true
  } catch {
    return false
  }
}

function scoped(ctx: RequestContext, permission: 'assessment.read' | 'assessment.manage' | 'assessment.review'): Prisma.TaskAssessmentWhereInput | null {
  const scope = authorizationService.scopeOf(ctx, permission)
  if (!scope) return null
  const base = { organization_id: ctx.organization.id }
  if (scope === 'OWN') return { ...base, intern_user_id: ctx.actor.userId }
  const where: Prisma.TaskAssessmentWhereInput = { ...base, intern: userScope(ctx.actor, scope) }
  // Managing or reviewing your own assessment is never allowed.
  return permission === 'assessment.read' ? where : { ...where, intern_user_id: { not: ctx.actor.userId } }
}

async function loadFor(ctx: RequestContext, assessmentId: string, permission: 'assessment.read' | 'assessment.manage' | 'assessment.review') {
  authorizationService.require(ctx, permission)
  const id = parseInput(z.uuid(), assessmentId)
  const assessment = await prisma.taskAssessment.findFirst({ where: { id, ...scoped(ctx, permission)! }, select: { id: true, status: true, intern_user_id: true, task_id: true } })
  if (!assessment) throw new NotFoundError('Assessment')
  return assessment
}

/** Who reviews an intern's task: its creator, project owner / manager, and the intern's manager and mentor. */
async function reviewersOf(taskId: string, internUserId: string) {
  const [task, intern] = await Promise.all([
    prisma.task.findUnique({ where: { id: taskId }, select: { created_by: true, project: { select: { owner_id: true, manager_id: true } } } }),
    prisma.intern.findUnique({ where: { user_id: internUserId }, select: { manager_id: true, mentor_id: true } }),
  ])
  return [task?.created_by, task?.project?.owner_id, task?.project?.manager_id, intern?.manager_id, intern?.mentor_id].filter(
    (id): id is string => Boolean(id) && id !== internUserId,
  )
}

async function attemptForTaker(ctx: RequestContext, attemptId: string) {
  authorizationService.require(ctx, 'assessment.take')
  const attempt = await prisma.assessmentAttempt.findFirst({
    where: { id: parseInput(z.uuid(), attemptId), user_id: ctx.actor.userId, assessment: { organization_id: ctx.organization.id } },
    select: {
      id: true,
      deadline_at: true,
      submitted_at: true,
      started_at: true,
      violations: true,
      assessment: { select: { id: true, status: true, max_violations: true, task_id: true, intern_user_id: true } },
    },
  })
  if (!attempt) throw new NotFoundError('Assessment attempt')
  return attempt
}

/** Marks multiple choice, computes integrity, moves to SUBMITTED. Idempotent. */
async function finishAttempt(attemptId: string, reason: string, auto: boolean) {
  const attempt = await prisma.assessmentAttempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      submitted_at: true,
      started_at: true,
      assessment: {
        select: {
          id: true,
          organization_id: true,
          task_id: true,
          intern_user_id: true,
          status: true,
          questions: { select: { id: true, kind: true, correct_option: true, points: true } },
        },
      },
      answers: { select: { id: true, question_id: true, choice: true } },
    },
  })
  if (!attempt || attempt.submitted_at) return false
  const now = new Date()
  const claimed = await prisma.assessmentAttempt.updateMany({
    where: { id: attemptId, submitted_at: null },
    data: { submitted_at: now, auto_submitted: auto, submit_reason: reason },
  })
  if (claimed.count === 0) return false
  const byQuestion = new Map(attempt.answers.map((a) => [a.question_id, a]))
  await prisma.$transaction([
    ...attempt.assessment.questions
      .filter((q) => q.kind === 'MULTIPLE_CHOICE')
      .map((q) => {
        const answer = byQuestion.get(q.id)
        const points = answer && answer.choice === q.correct_option ? q.points : 0
        return prisma.assessmentAnswer.upsert({
          where: { attempt_id_question_id: { attempt_id: attemptId, question_id: q.id } },
          update: { points },
          create: { attempt_id: attemptId, question_id: q.id, points },
        })
      }),
    prisma.proctorEvent.create({ data: { attempt_id: attemptId, type: 'SUBMITTED', occurred_at: now, detail: { reason, auto } } }),
    prisma.taskAssessment.update({ where: { id: attempt.assessment.id }, data: { status: 'SUBMITTED' } }),
  ])
  const reviewers = await reviewersOf(attempt.assessment.task_id, attempt.assessment.intern_user_id)
  const task = await prisma.task.findUnique({ where: { id: attempt.assessment.task_id }, select: { title: true } })
  await notificationService.notify(
    attempt.assessment.organization_id,
    reviewers,
    {
      type: NOTIFICATION_TYPES.ASSESSMENT_SUBMITTED,
      title: `Assessment for “${task?.title ?? 'a task'}” is ready to grade`,
      body: auto ? `Submitted automatically: ${reason}` : undefined,
      entityType: 'assessment',
      entityId: attempt.assessment.id,
    },
    attempt.assessment.intern_user_id,
  )
  // Suggest points for short answers in the background (a reviewer decides).
  const assessmentId = attempt.assessment.id
  if (!(await afterResponse(() => assessmentJobs.suggestGrades(assessmentId)))) {
    await assessmentJobs.suggestGrades(assessmentId).catch((error) => logger.warn('AI grading failed', { error }))
  }
  return true
}

/** Seconds of recording received per stream. */
async function recordingSeconds(attemptId: string) {
  const groups = await prisma.proctorRecording.groupBy({ by: ['stream'], where: { attempt_id: attemptId }, _count: { _all: true } })
  const n = (s: string) => groups.find((g) => g.stream === s)?._count._all ?? 0
  return { camera: n('CAMERA') * CHUNK_SECONDS, screen: n('SCREEN') * CHUNK_SECONDS }
}

export const assessmentService = {
  /** Assessments the viewer can see, grouped for the Assessments page. */
  async list(ctx: RequestContext) {
    authorizationService.require(ctx, 'assessment.read')
    const rows = await prisma.taskAssessment.findMany({
      where: { ...scoped(ctx, 'assessment.read')!, status: { not: 'CANCELLED' } },
      orderBy: { updated_at: 'desc' },
      take: 300,
      select: {
        id: true,
        status: true,
        score_percent: true,
        passed: true,
        integrity_score: true,
        updated_at: true,
        intern_user_id: true,
        task: { select: { id: true, title: true } },
        version: { select: { version_number: true } },
        intern: { select: personSelect },
        attempt: { select: { submitted_at: true, auto_submitted: true } },
      },
    })
    const mine = rows.filter((r) => r.intern_user_id === ctx.actor.userId)
    const others = rows.filter((r) => r.intern_user_id !== ctx.actor.userId)
    return {
      toTake: mine.filter((r) => r.status === 'READY' || r.status === 'IN_PROGRESS'),
      myResults: mine.filter((r) => !['READY', 'IN_PROGRESS'].includes(r.status)),
      toApprove: others.filter((r) => r.status === 'AWAITING_APPROVAL' || r.status === 'PREPARING'),
      toGrade: others.filter((r) => r.status === 'SUBMITTED'),
      recent: others.filter((r) => ['READY', 'IN_PROGRESS', 'GRADED', 'WAIVED'].includes(r.status)).slice(0, 50),
      canManage: Boolean(authorizationService.scopeOf(ctx, 'assessment.manage')),
    }
  },

  /** Full view for reviewers; a limited one for the intern (no answer key, no rubric). */
  async get(ctx: RequestContext, assessmentId: string) {
    const base = await loadFor(ctx, assessmentId, 'assessment.read')
    const isIntern = base.intern_user_id === ctx.actor.userId
    const canManage = !isIntern && Boolean(scoped(ctx, 'assessment.manage')) && Boolean(await prisma.taskAssessment.count({ where: { id: base.id, ...scoped(ctx, 'assessment.manage')! } }))
    const canReview = !isIntern && Boolean(scoped(ctx, 'assessment.review')) && Boolean(await prisma.taskAssessment.count({ where: { id: base.id, ...scoped(ctx, 'assessment.review')! } }))
    const a = await prisma.taskAssessment.findUniqueOrThrow({
      where: { id: base.id },
      select: {
        id: true,
        status: true,
        source: true,
        generation_error: true,
        time_limit_minutes: true,
        pass_percent: true,
        max_violations: true,
        score_percent: true,
        passed: true,
        integrity_score: true,
        waive_reason: true,
        waived_at: true,
        graded_at: true,
        approved_at: true,
        created_at: true,
        task: { select: { id: true, title: true } },
        version: { select: { version_number: true, description: true, submitted_at: true } },
        intern: { select: personSelect },
        questions: {
          orderBy: { position: 'asc' },
          select: { id: true, position: true, kind: true, prompt: true, options: true, correct_option: true, points: true, rubric: true },
        },
        attempt: {
          select: {
            id: true,
            started_at: true,
            deadline_at: true,
            submitted_at: true,
            auto_submitted: true,
            submit_reason: true,
            violations: true,
            screen_surface: true,
            ip_address: true,
            user_agent: true,
            consent_at: true,
            answers: { select: { id: true, question_id: true, choice: true, text: true, ai_points: true, ai_feedback: true, points: true } },
          },
        },
      },
    })
    const showKey = canManage || canReview
    let integrity: ReturnType<typeof integrityScore> | null = null
    let timeline: { type: string; occurred_at: Date; detail: Prisma.JsonValue }[] = []
    let recordings = { camera: 0, screen: 0 }
    let segments: { stream: 'CAMERA' | 'SCREEN'; segment: number; seconds: number; deleted: boolean }[] = []
    if (showKey && a.attempt) {
      const [events, seconds] = await Promise.all([
        prisma.proctorEvent.findMany({
          where: { attempt_id: a.attempt.id },
          orderBy: { occurred_at: 'asc' },
          take: 2000,
          select: { type: true, occurred_at: true, detail: true },
        }),
        recordingSeconds(a.attempt.id),
      ])
      timeline = events
      recordings = seconds
      const rows = await prisma.proctorRecording.findMany({
        where: { attempt_id: a.attempt.id },
        select: { stream: true, sequence: true, deleted_at: true },
      })
      const bySegment = new Map<string, { stream: 'CAMERA' | 'SCREEN'; segment: number; seconds: number; deleted: boolean }>()
      for (const r of rows) {
        const segment = Math.floor(r.sequence / SEGMENT_SIZE)
        const key = r.stream + ':' + segment
        const entry = bySegment.get(key) ?? { stream: r.stream, segment, seconds: 0, deleted: true }
        entry.seconds += CHUNK_SECONDS
        entry.deleted &&= Boolean(r.deleted_at)
        bySegment.set(key, entry)
      }
      segments = [...bySegment.values()].sort((x, y) => x.stream.localeCompare(y.stream) || x.segment - y.segment)
      const counts: Record<string, number> = {}
      for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1
      const end = a.attempt.submitted_at ?? new Date()
      integrity = integrityScore({
        counts,
        durationSeconds: Math.max(0, (end.getTime() - a.attempt.started_at.getTime()) / 1000),
        cameraSeconds: seconds.camera,
        screenSeconds: seconds.screen,
      })
    }
    return {
      ...a,
      // The answer key and rubrics only for reviewers.
      questions: a.questions.map((q) => (showKey ? q : { ...q, correct_option: null, rubric: null })),
      attempt: a.attempt && (showKey || a.status === 'GRADED' || a.status === 'WAIVED') ? a.attempt : a.attempt ? { ...a.attempt, answers: [] } : null,
      isIntern,
      canManage,
      canReview,
      canTake: isIntern && authorizationService.can(ctx, 'assessment.take') && (a.status === 'READY' || a.status === 'IN_PROGRESS'),
      integrity,
      timeline,
      recordings,
      segments,
    }
  },

  /** The assessment for a task's latest version (for the task page). */
  async forTask(ctx: RequestContext, taskId: string) {
    const where = scoped(ctx, 'assessment.read')
    if (!where) return null
    return prisma.taskAssessment.findFirst({
      where: { ...where, task_id: parseInput(z.uuid(), taskId), status: { not: 'CANCELLED' } },
      orderBy: { created_at: 'desc' },
      select: { id: true, status: true, intern_user_id: true, score_percent: true, passed: true, integrity_score: true, version: { select: { version_number: true } } },
    })
  },

  async regenerate(ctx: RequestContext, assessmentId: string) {
    const a = await loadFor(ctx, assessmentId, 'assessment.manage')
    if (a.status !== 'AWAITING_APPROVAL' && a.status !== 'PREPARING') throw new ValidationError('Questions can only be changed before approval')
    await prisma.taskAssessment.update({ where: { id: a.id }, data: { status: 'PREPARING', generation_error: null } })
    if (!(await afterResponse(() => assessmentJobs.generateQuestions(a.id)))) await assessmentJobs.generateQuestions(a.id)
  },

  /** Replaces the questions and settings (before approval). */
  async saveQuestions(ctx: RequestContext, input: unknown) {
    const data = parseInput(saveQuestionsSchema, input)
    const a = await loadFor(ctx, data.assessmentId, 'assessment.manage')
    if (a.status !== 'AWAITING_APPROVAL') throw new ValidationError('Questions can only be changed before approval')
    for (const [i, q] of data.questions.entries()) {
      if (q.kind === 'MULTIPLE_CHOICE' && q.correct >= q.options.length) {
        throw new ValidationError(`Question ${i + 1}: choose the correct option`)
      }
    }
    await prisma.$transaction([
      prisma.assessmentQuestion.deleteMany({ where: { assessment_id: a.id } }),
      prisma.assessmentQuestion.createMany({
        data: data.questions.map((q, position) => ({
          assessment_id: a.id,
          position,
          kind: q.kind,
          prompt: q.prompt,
          options: q.kind === 'MULTIPLE_CHOICE' ? q.options : [],
          correct_option: q.kind === 'MULTIPLE_CHOICE' ? q.correct : null,
          points: q.points,
          rubric: q.kind === 'SHORT_ANSWER' ? (q.rubric ?? null) : null,
        })),
      }),
      prisma.taskAssessment.update({
        where: { id: a.id },
        data: { time_limit_minutes: data.timeLimitMinutes, pass_percent: data.passPercent, max_violations: data.maxViolations },
      }),
    ])
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.ASSESSMENT_QUESTIONS_SAVED,
      resourceType: 'assessment',
      resourceId: a.id,
      metadata: { questions: data.questions.length, timeLimit: data.timeLimitMinutes, pass: data.passPercent },
    })
  },

  async approve(ctx: RequestContext, assessmentId: string) {
    const a = await loadFor(ctx, assessmentId, 'assessment.manage')
    if (a.status !== 'AWAITING_APPROVAL') throw new ValidationError('This assessment isn’t waiting for approval')
    const count = await prisma.assessmentQuestion.count({ where: { assessment_id: a.id } })
    if (count === 0) throw new ValidationError('Add at least one question before approving')
    await prisma.taskAssessment.update({ where: { id: a.id }, data: { status: 'READY', approved_by: ctx.actor.userId, approved_at: new Date() } })
    await auditService.logForContext(ctx, { action: AUDIT_ACTIONS.ASSESSMENT_APPROVED, resourceType: 'assessment', resourceId: a.id, metadata: { questions: count } })
    const task = await prisma.task.findUnique({ where: { id: a.task_id }, select: { title: true } })
    await notificationService.notify(
      ctx.organization.id,
      [a.intern_user_id],
      {
        type: NOTIFICATION_TYPES.ASSESSMENT_READY,
        title: `Take the assessment for “${task?.title ?? 'your task'}”`,
        body: 'It needs your camera, microphone and screen, and full screen. Set aside some quiet time.',
        entityType: 'assessment',
        entityId: a.id,
      },
      ctx.actor.userId,
    )
  },

  async waive(ctx: RequestContext, input: unknown) {
    const data = parseInput(waiveSchema, input)
    const a = await loadFor(ctx, data.assessmentId, 'assessment.review')
    if (a.status === 'WAIVED' || a.status === 'CANCELLED') throw new ValidationError('This assessment is closed')
    const attempt = await prisma.assessmentAttempt.findUnique({ where: { assessment_id: a.id }, select: { id: true, submitted_at: true } })
    if (attempt && !attempt.submitted_at) await finishAttempt(attempt.id, 'Waived by reviewer', true)
    await prisma.taskAssessment.update({
      where: { id: a.id },
      data: { status: 'WAIVED', waived_by: ctx.actor.userId, waived_at: new Date(), waive_reason: data.reason },
    })
    await auditService.logForContext(ctx, { action: AUDIT_ACTIONS.ASSESSMENT_WAIVED, resourceType: 'assessment', resourceId: a.id, metadata: { reason: data.reason } })
  },

  /** Final points for short answers (multiple choice is marked automatically); pass / fail. */
  async grade(ctx: RequestContext, input: unknown) {
    const data = parseInput(gradeInputSchema, input)
    const a = await loadFor(ctx, data.assessmentId, 'assessment.review')
    if (a.status !== 'SUBMITTED' && a.status !== 'GRADED') throw new ValidationError('There’s no submitted attempt to grade')
    const full = await prisma.taskAssessment.findUniqueOrThrow({
      where: { id: a.id },
      select: {
        pass_percent: true,
        task: { select: { title: true } },
        questions: { select: { id: true, kind: true, points: true } },
        attempt: { select: { id: true, started_at: true, submitted_at: true, answers: { select: { id: true, question_id: true, points: true } } } },
      },
    })
    const attempt = full.attempt!
    const answerByQuestion = new Map(attempt.answers.map((x) => [x.question_id, x]))
    const updates: Prisma.PrismaPromise<unknown>[] = []
    let earned = 0
    let available = 0
    for (const q of full.questions) {
      available += q.points
      const answer = answerByQuestion.get(q.id)
      if (q.kind === 'MULTIPLE_CHOICE') {
        earned += answer?.points ?? 0
        continue
      }
      const given = answer ? data.points[answer.id] : undefined
      if (answer && given === undefined) throw new ValidationError('Give points for every short answer')
      const points = Math.min(Math.max(given ?? 0, 0), q.points)
      earned += points
      if (answer) updates.push(prisma.assessmentAnswer.update({ where: { id: answer.id }, data: { points } }))
    }
    const percent = scorePercent(earned, available) ?? 0
    const passed = percent >= full.pass_percent
    const [events, seconds] = await Promise.all([
      prisma.proctorEvent.groupBy({ by: ['type'], where: { attempt_id: attempt.id }, _count: { _all: true } }),
      recordingSeconds(attempt.id),
    ])
    const integrity = integrityScore({
      counts: Object.fromEntries(events.map((e) => [e.type, e._count._all])),
      durationSeconds: ((attempt.submitted_at ?? new Date()).getTime() - attempt.started_at.getTime()) / 1000,
      cameraSeconds: seconds.camera,
      screenSeconds: seconds.screen,
    })
    await prisma.$transaction([
      ...updates,
      prisma.taskAssessment.update({
        where: { id: a.id },
        data: { status: 'GRADED', score_percent: percent, passed, integrity_score: integrity.score, graded_by: ctx.actor.userId, graded_at: new Date() },
      }),
    ])
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.ASSESSMENT_GRADED,
      resourceType: 'assessment',
      resourceId: a.id,
      metadata: { score: percent, passed, integrity: integrity.score },
    })
    await notificationService.notify(
      ctx.organization.id,
      [a.intern_user_id],
      {
        type: NOTIFICATION_TYPES.ASSESSMENT_GRADED,
        title: `Assessment for “${full.task.title}”: ${percent}% — ${passed ? 'passed' : 'not passed'}`,
        entityType: 'assessment',
        entityId: a.id,
      },
      ctx.actor.userId,
    )
    return { percent, passed }
  },

  // ── Taking an assessment ───────────────────────────────────────────────────

  /** Starts (or resumes) the attempt after consent; returns the questions without the answer key. */
  async start(ctx: RequestContext, input: unknown, meta: { ipAddress: string | null; userAgent: string | null }) {
    authorizationService.require(ctx, 'assessment.take')
    const data = parseInput(startSchema, input)
    const assessment = await prisma.taskAssessment.findFirst({
      where: { id: data.assessmentId, organization_id: ctx.organization.id, intern_user_id: ctx.actor.userId },
      select: { id: true, status: true, time_limit_minutes: true, max_violations: true, attempt: { select: { id: true, submitted_at: true, deadline_at: true } } },
    })
    if (!assessment) throw new NotFoundError('Assessment')
    if (data.screenSurface && data.screenSurface !== 'monitor') {
      throw new ValidationError('Share your entire screen, not a window or a tab')
    }
    const now = new Date()
    let attemptId: string
    if (assessment.attempt) {
      if (assessment.attempt.submitted_at) throw new ConflictError('This assessment was already submitted')
      if (assessment.attempt.deadline_at.getTime() + DEADLINE_GRACE_MS < now.getTime()) {
        await finishAttempt(assessment.attempt.id, 'Time ran out', true)
        throw new ConflictError('Time ran out for this assessment')
      }
      attemptId = assessment.attempt.id
      await prisma.proctorEvent.create({ data: { attempt_id: attemptId, type: 'RESUMED', occurred_at: now, detail: { surface: data.screenSurface ?? 'unknown' } } })
    } else {
      if (assessment.status !== 'READY') throw new ValidationError('This assessment isn’t open yet')
      const attempt = await prisma.$transaction(async (tx) => {
        const created = await tx.assessmentAttempt.create({
          data: {
            assessment_id: assessment.id,
            user_id: ctx.actor.userId,
            consent_at: now,
            consent_version: CONSENT_VERSION,
            started_at: now,
            deadline_at: new Date(now.getTime() + assessment.time_limit_minutes * 60_000),
            last_seen_at: now,
            ip_address: meta.ipAddress,
            user_agent: meta.userAgent?.slice(0, 300) ?? null,
            screen_surface: data.screenSurface ?? null,
          },
          select: { id: true },
        })
        await tx.taskAssessment.update({ where: { id: assessment.id }, data: { status: 'IN_PROGRESS' } })
        await tx.proctorEvent.createMany({
          data: [
            { attempt_id: created.id, type: 'STARTED', occurred_at: now, detail: { surface: data.screenSurface ?? 'unknown' } },
            ...(data.multipleScreens ? [{ attempt_id: created.id, type: 'MULTIPLE_SCREENS', occurred_at: now }] : []),
          ],
        })
        return created
      })
      attemptId = attempt.id
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.ASSESSMENT_STARTED,
        resourceType: 'assessment',
        resourceId: assessment.id,
        metadata: { consentVersion: CONSENT_VERSION },
      })
    }
    return this.attemptState(ctx, attemptId)
  },

  /** What the taking page needs: questions (no key), saved answers, deadline and server time. */
  async attemptState(ctx: RequestContext, attemptId: string) {
    const attempt = await attemptForTaker(ctx, attemptId)
    const [questions, answers, maxima] = await Promise.all([
      prisma.assessmentQuestion.findMany({
        where: { assessment_id: attempt.assessment.id },
        orderBy: { position: 'asc' },
        select: { id: true, kind: true, prompt: true, options: true, points: true },
      }),
      prisma.assessmentAnswer.findMany({ where: { attempt_id: attempt.id }, select: { question_id: true, choice: true, text: true } }),
      prisma.proctorRecording.groupBy({ by: ['stream'], where: { attempt_id: attempt.id }, _max: { sequence: true } }),
    ])
    // A reopened page records into a new segment after the existing ones.
    const next = (stream: 'CAMERA' | 'SCREEN') => {
      const max = maxima.find((m) => m.stream === stream)?._max.sequence
      return max === undefined || max === null ? 0 : (Math.floor(max / SEGMENT_SIZE) + 1) * SEGMENT_SIZE
    }
    return {
      attemptId: attempt.id,
      assessmentId: attempt.assessment.id,
      deadlineAt: attempt.deadline_at.toISOString(),
      serverNow: new Date().toISOString(),
      submitted: Boolean(attempt.submitted_at),
      violations: attempt.violations,
      maxViolations: attempt.assessment.max_violations,
      nextSequence: { camera: next('CAMERA'), screen: next('SCREEN') },
      questions,
      answers,
    }
  },

  async saveAnswers(ctx: RequestContext, input: unknown) {
    const data = parseInput(answersSchema, input)
    const attempt = await attemptForTaker(ctx, data.attemptId)
    if (attempt.submitted_at) throw new ConflictError('This assessment was already submitted')
    if (attempt.deadline_at.getTime() + DEADLINE_GRACE_MS < Date.now()) {
      await finishAttempt(attempt.id, 'Time ran out', true)
      throw new ConflictError('Time ran out — your saved answers were submitted')
    }
    const valid = new Set(
      (await prisma.assessmentQuestion.findMany({ where: { assessment_id: attempt.assessment.id }, select: { id: true } })).map((q) => q.id),
    )
    await prisma.$transaction(
      data.answers
        .filter((a) => valid.has(a.questionId))
        .map((a) =>
          prisma.assessmentAnswer.upsert({
            where: { attempt_id_question_id: { attempt_id: attempt.id, question_id: a.questionId } },
            update: { choice: a.choice ?? null, text: a.text ?? null },
            create: { attempt_id: attempt.id, question_id: a.questionId, choice: a.choice ?? null, text: a.text ?? null },
          }),
        ),
    )
    await prisma.assessmentAttempt.update({ where: { id: attempt.id }, data: { last_seen_at: new Date() } })
    return { saved: data.answers.length }
  },

  /** Timeline events from the browser; violations past the limit submit the attempt. */
  async recordEvents(ctx: RequestContext, input: unknown) {
    const data = parseInput(eventsSchema, input)
    const attempt = await attemptForTaker(ctx, data.attemptId)
    if (attempt.submitted_at) return { violations: attempt.violations, submitted: true }
    const now = Date.now()
    const events = data.events.map((e) => {
      const at = new Date(e.at).getTime()
      // Browser clocks are untrusted: keep times within the attempt.
      const clamped = Math.min(Math.max(at, attempt.started_at.getTime()), now + RESPONSE_GRACE_MS)
      return { attempt_id: attempt.id, type: e.type, occurred_at: new Date(clamped), detail: e.detail ?? undefined }
    })
    const newViolations = events.filter((e) => VIOLATION_TYPES.includes(e.type as ProctorEventType)).length
    if (events.length) await prisma.proctorEvent.createMany({ data: events })
    const updated = await prisma.assessmentAttempt.update({
      where: { id: attempt.id },
      data: { last_seen_at: new Date(), ...(newViolations ? { violations: { increment: newViolations } } : {}) },
      select: { violations: true },
    })
    let submitted = false
    if (updated.violations > attempt.assessment.max_violations) {
      submitted = await finishAttempt(attempt.id, `Too many violations (${updated.violations})`, true)
    } else if (attempt.deadline_at.getTime() + DEADLINE_GRACE_MS < now) {
      submitted = await finishAttempt(attempt.id, 'Time ran out', true)
    }
    return { violations: updated.violations, submitted }
  },

  /** One recording chunk (camera with microphone, or screen). */
  async uploadChunk(ctx: RequestContext, input: { attemptId: string; stream: string; sequence: number; bytes: Uint8Array }) {
    const attempt = await attemptForTaker(ctx, input.attemptId)
    const stream = parseInput(z.enum(['CAMERA', 'SCREEN']), input.stream.toUpperCase())
    const sequence = parseInput(z.number().int().min(0).max(MAX_SEQUENCE), input.sequence)
    const now = Date.now()
    const closedAt = attempt.submitted_at?.getTime() ?? attempt.deadline_at.getTime() + DEADLINE_GRACE_MS
    if (now > closedAt + UPLOAD_GRACE_MS) throw new ConflictError('Recording is closed for this attempt')
    const storagePath = await getStorageService().uploadRecording(ctx.organization.id, input.bytes)
    try {
      await prisma.proctorRecording.create({
        data: { attempt_id: attempt.id, stream, sequence, storage_path: storagePath, bytes: input.bytes.byteLength },
      })
    } catch (error) {
      await getStorageService().delete(storagePath).catch(() => undefined)
      if ((error as { code?: string })?.code === 'P2002') throw new ConflictError('That chunk was already received')
      throw error
    }
    return { ok: true }
  },

  async submit(ctx: RequestContext, attemptId: string) {
    const attempt = await attemptForTaker(ctx, attemptId)
    if (attempt.submitted_at) return { submitted: true }
    const late = attempt.deadline_at.getTime() + DEADLINE_GRACE_MS < Date.now()
    await finishAttempt(attempt.id, late ? 'Time ran out' : 'Submitted by the intern', late)
    return { submitted: true }
  },

  /** Recording chunks of one stream, in order, for playback (reviewers only). */
  async recordingChunks(ctx: RequestContext, attemptId: string, streamInput: string, segment = 0) {
    authorizationService.require(ctx, 'assessment.review')
    const stream = parseInput(z.enum(['CAMERA', 'SCREEN']), streamInput.toUpperCase())
    const attempt = await prisma.assessmentAttempt.findFirst({
      where: { id: parseInput(z.uuid(), attemptId), assessment: scoped(ctx, 'assessment.review')! },
      select: { id: true, assessment_id: true },
    })
    if (!attempt) throw new NotFoundError('Recording')
    const chunks = await prisma.proctorRecording.findMany({
      where: {
        attempt_id: attempt.id,
        stream,
        deleted_at: null,
        sequence: { gte: segment * SEGMENT_SIZE, lt: (segment + 1) * SEGMENT_SIZE },
      },
      orderBy: { sequence: 'asc' },
      select: { storage_path: true, bytes: true },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.ASSESSMENT_RECORDING_VIEWED,
      resourceType: 'assessment',
      resourceId: attempt.assessment_id,
      metadata: { stream, segment },
    })
    return chunks
  },

  /** Approval gate used by task review: the version's assessment must be passed or waived. */
  async assertApprovable(versionId: string) {
    const assessment = await prisma.taskAssessment.findUnique({
      where: { submission_version_id: versionId },
      select: { status: true, passed: true },
    })
    if (!assessment || assessment.status === 'CANCELLED' || assessment.status === 'WAIVED') return
    if (assessment.status === 'GRADED' && assessment.passed) return
    if (assessment.status === 'GRADED') {
      throw new ValidationError('The intern didn’t pass this submission’s assessment. Request changes, or waive the assessment with a reason.')
    }
    throw new ValidationError('This submission’s assessment isn’t passed yet. Approve its questions, let the intern take it and grade it — or waive it with a reason.')
  },
}

/** System work: no request context. */
export const assessmentJobs = {
  /** On a task submission by an intern: create the version's assessment and draft questions. */
  async onSubmitted(organizationId: string, input: { taskId: string; submissionId: string; version: number }) {
    const version = await prisma.submissionVersion.findFirst({
      where: { submission_id: input.submissionId, version_number: input.version },
      select: { id: true, created_by: true, submission: { select: { submitted_by: true } } },
    })
    if (!version) return null
    const userId = version.created_by ?? version.submission.submitted_by
    const intern = await prisma.intern.findFirst({ where: { user_id: userId, organization_id: organizationId, deleted_at: null }, select: { id: true } })
    if (!intern) return null // Assessments are for interns' work.
    // Older versions' open assessments are superseded.
    await prisma.taskAssessment.updateMany({
      where: { task_id: input.taskId, status: { in: ['PREPARING', 'AWAITING_APPROVAL', 'READY'] } },
      data: { status: 'CANCELLED' },
    })
    const existing = await prisma.taskAssessment.findUnique({ where: { submission_version_id: version.id }, select: { id: true } })
    if (existing) return existing.id
    const created = await prisma.taskAssessment.create({
      data: { organization_id: organizationId, task_id: input.taskId, submission_version_id: version.id, intern_user_id: userId },
      select: { id: true },
    })
    if (!(await afterResponse(() => this.generateQuestions(created.id)))) {
      await this.generateQuestions(created.id).catch((error) => logger.warn('Assessment generation failed', { error }))
    }
    return created.id
  },

  /** AI drafts the questions; without AI (or on failure) the reviewer writes them. Then reviewers are asked to approve. */
  async generateQuestions(assessmentId: string) {
    const a = await prisma.taskAssessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        organization_id: true,
        status: true,
        intern_user_id: true,
        task_id: true,
        task: { select: { title: true, description: true, checklist: { select: { title: true }, take: 30 } } },
        version: { select: { description: true, attachments: { select: { file_name: true }, take: 20 } } },
      },
    })
    if (!a || a.status !== 'PREPARING') return
    const provider = getAIProvider()
    const settings = await aiSettingsService.get(a.organization_id)
    let error: string | null = null
    if (!provider || !settings.enabled) {
      error = 'AI isn’t available, so write the questions yourself.'
    } else {
      const started = Date.now()
      try {
        const { data, result } = await generateStructured(provider, aiQuestionsSchema, {
          messages: buildAssessmentQuestionsMessages({
            taskTitle: a.task.title,
            taskDescription: a.task.description,
            checklist: a.task.checklist.map((c) => c.title),
            submissionMessage: a.version.description,
            fileNames: a.version.attachments.map((f) => f.file_name),
            multipleChoice: 4,
            shortAnswer: 3,
          }),
          maxTokens: 2500,
        })
        await prisma.$transaction([
          prisma.assessmentQuestion.deleteMany({ where: { assessment_id: a.id } }),
          prisma.assessmentQuestion.createMany({
            data: data.questions.map((q, position) => ({
              assessment_id: a.id,
              position,
              kind: q.kind,
              prompt: q.prompt,
              options: q.kind === 'MULTIPLE_CHOICE' ? q.options : [],
              correct_option: q.kind === 'MULTIPLE_CHOICE' ? q.correct : null,
              points: q.points,
              rubric: q.kind === 'SHORT_ANSWER' ? (q.rubric ?? null) : null,
            })),
          }),
        ])
        await prisma.aiUsageEvent.create({
          data: {
            organization_id: a.organization_id,
            user_id: a.intern_user_id,
            feature: 'ASSESSMENT',
            intent: 'draft_questions',
            provider: result.provider,
            model: result.model,
            tokens_input: result.usage.input,
            tokens_output: result.usage.output,
            latency_ms: Date.now() - started,
            success: true,
          },
        })
      } catch (e) {
        logger.warn('AI could not draft assessment questions', { error: e })
        error = 'AI couldn’t draft questions this time. Try again, or write them yourself.'
      }
    }
    await prisma.taskAssessment.update({ where: { id: a.id }, data: { status: 'AWAITING_APPROVAL', source: error ? 'MANUAL' : 'AI', generation_error: error } })
    const reviewers = await reviewersOf(a.task_id, a.intern_user_id)
    const intern = await prisma.user.findUnique({ where: { id: a.intern_user_id }, select: personSelect })
    await notificationService.notify(
      a.organization_id,
      reviewers,
      {
        type: NOTIFICATION_TYPES.ASSESSMENT_APPROVAL_NEEDED,
        title: `Approve the assessment for “${a.task.title}”`,
        body: `${intern ? fullName(intern) : 'The intern'} submitted it. ${error ? 'Questions need writing.' : 'AI drafted the questions — check them.'}`,
        entityType: 'assessment',
        entityId: a.id,
      },
      null,
    )
  },

  /** AI-suggested points for short answers (never final). */
  async suggestGrades(assessmentId: string) {
    const a = await prisma.taskAssessment.findUnique({
      where: { id: assessmentId },
      select: {
        organization_id: true,
        intern_user_id: true,
        task: { select: { title: true } },
        questions: { where: { kind: 'SHORT_ANSWER' }, select: { id: true, prompt: true, rubric: true, points: true } },
        attempt: { select: { answers: { select: { id: true, question_id: true, text: true, ai_points: true } } } },
      },
    })
    const provider = getAIProvider()
    if (!a?.attempt || !provider) return
    const settings = await aiSettingsService.get(a.organization_id)
    if (!settings.enabled) return
    for (const q of a.questions) {
      const answer = a.attempt.answers.find((x) => x.question_id === q.id)
      if (!answer || answer.ai_points !== null) continue
      if (!answer.text?.trim()) {
        await prisma.assessmentAnswer.update({ where: { id: answer.id }, data: { ai_points: 0, ai_feedback: 'No answer given.' } })
        continue
      }
      try {
        const { data } = await generateStructured(provider, gradeSchema, {
          messages: buildAnswerGradingMessages({ taskTitle: a.task.title, question: q.prompt, rubric: q.rubric, maxPoints: q.points, answer: answer.text }),
          maxTokens: 300,
        })
        await prisma.assessmentAnswer.update({
          where: { id: answer.id },
          data: { ai_points: Math.min(Math.max(Math.round(data.points * 2) / 2, 0), q.points), ai_feedback: data.feedback },
        })
      } catch (error) {
        logger.warn('AI could not suggest a grade', { error })
      }
    }
  },

  /** Daily: submit attempts whose time ran out, and delete recordings past the retention period. */
  async maintenance(now = new Date()) {
    const overdue = await prisma.assessmentAttempt.findMany({
      where: { submitted_at: null, deadline_at: { lt: new Date(now.getTime() - DEADLINE_GRACE_MS) } },
      select: { id: true },
      take: 500,
    })
    for (const o of overdue) await finishAttempt(o.id, 'Time ran out', true)
    const expired = await prisma.proctorRecording.findMany({
      where: { deleted_at: null, created_at: { lt: new Date(now.getTime() - RECORDING_RETENTION_DAYS * 86_400_000) } },
      select: { id: true, storage_path: true },
      take: 2000,
    })
    const storage = getStorageService()
    let deleted = 0
    for (const r of expired) {
      try {
        await storage.delete(r.storage_path)
        await prisma.proctorRecording.update({ where: { id: r.id }, data: { deleted_at: now } })
        deleted++
      } catch (error) {
        logger.warn('Could not delete an expired proctoring recording', { error })
      }
    }
    return { autoSubmitted: overdue.length, recordingsDeleted: deleted }
  },
}
