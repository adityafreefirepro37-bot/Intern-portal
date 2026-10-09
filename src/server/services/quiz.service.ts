import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import { canStartAttempt, gradeAttempt, isAttemptExpired, mayRevealAnswers } from '@/lib/learning/quiz'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { requireUserInScope } from './hr-shared'
import { recomputeEnrollment } from './learning-progress'

/**
 * Quiz attempts. The browser receives questions and option texts only —
 * never `is_correct`, accepted answers or explanations — until the attempt is
 * submitted and the quiz's answer policy allows it. The browser never sends a
 * score: it sends choices, the server grades them. One open attempt per
 * person and quiz (database-enforced); submitting is guarded so an attempt
 * can only be graded once.
 */

const submitSchema = z.strictObject({
  attemptId: z.uuid(),
  answers: z
    .array(
      z.strictObject({
        questionId: z.uuid(),
        selectedOptionIds: z.array(z.uuid()).max(20).default([]),
        text: z.string().trim().max(500).nullable().default(null),
      }),
    )
    .max(200),
})

/** A published quiz in a course the learner is enrolled in (or may author). */
async function learnerQuiz(ctx: RequestContext, quizId: string) {
  const quiz = await prisma.quiz.findFirst({
    where: { id: parseInput(z.uuid(), quizId), course: { organization_id: ctx.organization.id, deleted_at: null } },
    select: {
      id: true,
      title: true,
      description: true,
      passing_score: true,
      attempt_limit: true,
      time_limit_minutes: true,
      answer_policy: true,
      status: true,
      is_required: true,
      course_id: true,
      course: { select: { id: true, title: true, status: true } },
      module: { select: { id: true, title: true } },
      _count: { select: { questions: true } },
    },
  })
  if (!quiz) throw new NotFoundError('Quiz')
  const enrollment = await prisma.courseEnrollment.findUnique({
    where: { course_id_user_id: { course_id: quiz.course_id, user_id: ctx.actor.userId } },
    select: { status: true },
  })
  const enrolled = Boolean(enrollment && enrollment.status !== 'CANCELLED')
  const author = authorizationService.can(ctx, 'course.update')
  if (quiz.status !== 'PUBLISHED' && !author) throw new NotFoundError('Quiz')
  if (!enrolled && !author && quiz.course.status !== 'PUBLISHED') throw new NotFoundError('Quiz')
  return { quiz, enrolled }
}

/** The signed-in person's own attempt (others' attempts are 404 here). */
async function ownAttempt(ctx: RequestContext, attemptId: string) {
  const attempt = await prisma.quizAttempt.findFirst({
    where: {
      id: parseInput(z.uuid(), attemptId),
      user_id: ctx.actor.userId,
      quiz: { course: { organization_id: ctx.organization.id } },
    },
    select: { id: true, quiz_id: true, status: true, started_at: true, attempt_number: true },
  })
  if (!attempt) throw new NotFoundError('Attempt')
  return attempt
}

async function gradableQuestions(quizId: string) {
  return prisma.quizQuestion.findMany({
    where: { quiz_id: quizId },
    orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
    select: {
      id: true,
      question_type: true,
      points: true,
      accepted_answers: true,
      options: { select: { id: true, is_correct: true } },
    },
  })
}

/**
 * Grades and closes an open attempt. Returns null when another request closed
 * it first. Expired attempts are closed with no answers counted.
 */
async function finalize(
  ctx: RequestContext,
  attemptId: string,
  quiz: { id: string; course_id: string; passing_score: number; title: string },
  answers: z.infer<typeof submitSchema>['answers'],
  expired: boolean,
) {
  const questions = await gradableQuestions(quiz.id)
  const known = new Set(questions.map((q) => q.id))
  const counted = expired ? [] : answers.filter((a) => known.has(a.questionId))
  const graded = gradeAttempt(
    questions,
    counted.map((a) => ({ questionId: a.questionId, selectedOptionIds: a.selectedOptionIds, text: a.text })),
    quiz.passing_score,
  )
  const now = new Date()
  // The status guard makes grading single-shot even under double submits.
  const { count } = await prisma.quizAttempt.updateMany({
    where: { id: attemptId, status: 'IN_PROGRESS' },
    data: {
      status: 'SUBMITTED',
      submitted_at: now,
      score: graded.score,
      max_score: graded.maxScore,
      percentage: graded.percentage,
      passed: graded.passed,
    },
  })
  if (count === 0) return null
  const byQuestion = new Map(counted.map((a) => [a.questionId, a]))
  await prisma.quizAnswer.createMany({
    data: graded.results.map((r) => ({
      attempt_id: attemptId,
      question_id: r.questionId,
      selected_option_ids: byQuestion.get(r.questionId)?.selectedOptionIds ?? [],
      text_answer: byQuestion.get(r.questionId)?.text ?? null,
      is_correct: r.correct,
      points_awarded: r.points,
    })),
    skipDuplicates: true,
  })
  await auditService.logForContext(ctx, {
    action: AUDIT_ACTIONS.QUIZ_ATTEMPTED,
    resourceType: 'quiz_attempt',
    resourceId: attemptId,
    metadata: { quizId: quiz.id, score: graded.score, maxScore: graded.maxScore, percentage: graded.percentage, passed: graded.passed, expired },
  })
  await domainEvents.emit('learning.quiz_submitted', {
    organizationId: ctx.organization.id,
    actorUserId: ctx.actor.userId,
    payload: { attemptId, quizId: quiz.id, userId: ctx.actor.userId, passed: graded.passed },
  })
  await recomputeEnrollment(ctx.organization.id, ctx.actor.userId, quiz.course_id, ctx.actor.userId)
  return graded
}

export const quizService = {
  /** Quiz landing page: rules, the learner's attempt history and whether they can start. */
  async overview(ctx: RequestContext, quizId: string) {
    authorizationService.require(ctx, 'course.read')
    const { quiz, enrolled } = await learnerQuiz(ctx, quizId)
    const attempts = await prisma.quizAttempt.findMany({
      where: { quiz_id: quiz.id, user_id: ctx.actor.userId },
      orderBy: { attempt_number: 'desc' },
      select: { id: true, attempt_number: true, status: true, score: true, max_score: true, percentage: true, passed: true, started_at: true, submitted_at: true },
    })
    const submitted = attempts.filter((a) => a.status === 'SUBMITTED')
    const open = attempts.find((a) => a.status === 'IN_PROGRESS') ?? null
    const gate = canStartAttempt({
      attemptLimit: quiz.attempt_limit,
      submitted: submitted.length,
      alreadyPassed: submitted.some((a) => a.passed),
    })
    const learner = enrolled && authorizationService.can(ctx, 'learning.track') && quiz.status === 'PUBLISHED'
    return {
      quiz,
      attempts,
      openAttemptId: open?.id ?? null,
      attemptsLeft: quiz.attempt_limit === null ? null : Math.max(0, quiz.attempt_limit - submitted.length),
      passed: submitted.some((a) => a.passed),
      bestPercentage: submitted.reduce<number | null>((best, a) => Math.max(best ?? 0, a.percentage ?? 0), null),
      enrolled,
      can: {
        start: learner && quiz._count.questions > 0 && (Boolean(open) || gate.ok),
        reason: !enrolled ? 'Enroll in the course to take this quiz' : gate.ok ? null : gate.reason,
      },
    }
  },

  /** Starts a new attempt or resumes the open one. Returns the attempt id. */
  async start(ctx: RequestContext, quizId: string) {
    authorizationService.require(ctx, 'learning.track')
    const { quiz, enrolled } = await learnerQuiz(ctx, quizId)
    if (!enrolled) throw new ValidationError('Enroll in the course to take this quiz')
    if (quiz.status !== 'PUBLISHED' || quiz._count.questions === 0) throw new ValidationError('This quiz isn’t available yet')
    const open = await prisma.quizAttempt.findFirst({
      where: { quiz_id: quiz.id, user_id: ctx.actor.userId, status: 'IN_PROGRESS' },
      select: { id: true, started_at: true },
    })
    if (open) {
      if (!isAttemptExpired(open.started_at, quiz.time_limit_minutes, new Date())) return { attemptId: open.id }
      await finalize(ctx, open.id, quiz, [], true)
    }
    const history = await prisma.quizAttempt.findMany({
      where: { quiz_id: quiz.id, user_id: ctx.actor.userId },
      select: { attempt_number: true, status: true, passed: true },
    })
    const submitted = history.filter((a) => a.status === 'SUBMITTED')
    const gate = canStartAttempt({
      attemptLimit: quiz.attempt_limit,
      submitted: submitted.length,
      alreadyPassed: submitted.some((a) => a.passed),
    })
    if (!gate.ok) throw new ValidationError(gate.reason)
    try {
      const attempt = await prisma.quizAttempt.create({
        data: {
          quiz_id: quiz.id,
          user_id: ctx.actor.userId,
          attempt_number: history.reduce((max, a) => Math.max(max, a.attempt_number), 0) + 1,
          status: 'IN_PROGRESS',
        },
        select: { id: true },
      })
      return { attemptId: attempt.id }
    } catch (error) {
      // A concurrent start already opened an attempt — resume that one.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await prisma.quizAttempt.findFirst({
          where: { quiz_id: quiz.id, user_id: ctx.actor.userId, status: 'IN_PROGRESS' },
          select: { id: true },
        })
        if (existing) return { attemptId: existing.id }
      }
      throw error
    }
  },

  /** An open attempt: questions and option texts only (no answers, no explanations). */
  async take(ctx: RequestContext, attemptId: string) {
    authorizationService.require(ctx, 'learning.track')
    const attempt = await ownAttempt(ctx, attemptId)
    if (attempt.status !== 'IN_PROGRESS') return { submitted: true as const, attemptId: attempt.id }
    const quiz = await prisma.quiz.findUniqueOrThrow({
      where: { id: attempt.quiz_id },
      select: {
        id: true,
        title: true,
        description: true,
        passing_score: true,
        time_limit_minutes: true,
        course_id: true,
        course: { select: { id: true, title: true } },
        questions: {
          orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
          select: {
            id: true,
            question: true,
            question_type: true,
            points: true,
            options: { orderBy: { position: 'asc' }, select: { id: true, option_text: true } },
          },
        },
      },
    })
    const expiresAt = quiz.time_limit_minutes
      ? new Date(attempt.started_at.getTime() + quiz.time_limit_minutes * 60_000)
      : null
    if (isAttemptExpired(attempt.started_at, quiz.time_limit_minutes, new Date())) {
      await finalize(ctx, attempt.id, quiz, [], true)
      return { submitted: true as const, attemptId: attempt.id }
    }
    return {
      submitted: false as const,
      attemptId: attempt.id,
      attemptNumber: attempt.attempt_number,
      expiresAt,
      quiz: {
        id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        passing_score: quiz.passing_score,
        course: quiz.course,
        questions: quiz.questions,
      },
    }
  },

  /** Grades the attempt on the server. Late submissions (past the time limit) count no answers. */
  async submit(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'learning.track')
    const data = parseInput(submitSchema, input)
    const attempt = await ownAttempt(ctx, data.attemptId)
    if (attempt.status !== 'IN_PROGRESS') throw new ConflictError('This attempt was already submitted')
    const quiz = await prisma.quiz.findUniqueOrThrow({
      where: { id: attempt.quiz_id },
      select: { id: true, title: true, course_id: true, passing_score: true, time_limit_minutes: true },
    })
    const expired = isAttemptExpired(attempt.started_at, quiz.time_limit_minutes, new Date())
    const graded = await finalize(ctx, attempt.id, quiz, data.answers, expired)
    if (!graded) throw new ConflictError('This attempt was already submitted')
    return { attemptId: attempt.id, expired, passed: graded.passed, percentage: graded.percentage }
  },

  /**
   * A submitted attempt's result. The learner sees correct answers and
   * explanations only when the answer policy allows; reviewers with
   * learning.read over the learner see the result (and answers, if they can
   * author courses).
   */
  async result(ctx: RequestContext, attemptId: string) {
    authorizationService.require(ctx, 'course.read')
    const id = parseInput(z.uuid(), attemptId)
    const attempt = await prisma.quizAttempt.findFirst({
      where: { id, quiz: { course: { organization_id: ctx.organization.id } } },
      select: {
        id: true,
        user_id: true,
        attempt_number: true,
        status: true,
        score: true,
        max_score: true,
        percentage: true,
        passed: true,
        started_at: true,
        submitted_at: true,
        user: { select: { first_name: true, last_name: true, display_name: true } },
        quiz: {
          select: {
            id: true,
            title: true,
            passing_score: true,
            answer_policy: true,
            attempt_limit: true,
            course: { select: { id: true, title: true } },
            questions: {
              orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
              select: {
                id: true,
                question: true,
                question_type: true,
                points: true,
                explanation: true,
                accepted_answers: true,
                options: { orderBy: { position: 'asc' }, select: { id: true, option_text: true, is_correct: true } },
              },
            },
          },
        },
        answers: { select: { question_id: true, selected_option_ids: true, text_answer: true, is_correct: true, points_awarded: true } },
      },
    })
    if (!attempt) throw new NotFoundError('Attempt')
    const own = attempt.user_id === ctx.actor.userId
    if (!own) await requireUserInScope(ctx, 'learning.read', attempt.user_id)
    if (attempt.status !== 'SUBMITTED') {
      if (own) return { open: true as const, attemptId: attempt.id }
      throw new NotFoundError('Attempt')
    }
    const passedEver = own
      ? (await prisma.quizAttempt.count({ where: { quiz_id: attempt.quiz.id, user_id: attempt.user_id, passed: true } })) > 0
      : Boolean(attempt.passed)
    const reveal = own
      ? mayRevealAnswers(attempt.quiz.answer_policy, passedEver)
      : authorizationService.can(ctx, 'course.update')
    const answers = new Map(attempt.answers.map((a) => [a.question_id, a]))
    return {
      open: false as const,
      attempt: {
        id: attempt.id,
        attempt_number: attempt.attempt_number,
        score: attempt.score,
        max_score: attempt.max_score,
        percentage: attempt.percentage,
        passed: attempt.passed,
        started_at: attempt.started_at,
        submitted_at: attempt.submitted_at,
      },
      learner: own ? null : attempt.user,
      quiz: { id: attempt.quiz.id, title: attempt.quiz.title, passing_score: attempt.quiz.passing_score, course: attempt.quiz.course, answer_policy: attempt.quiz.answer_policy },
      revealed: reveal,
      correctCount: attempt.answers.filter((a) => a.is_correct).length,
      incorrectCount: attempt.quiz.questions.length - attempt.answers.filter((a) => a.is_correct).length,
      questions: attempt.quiz.questions.map((q) => {
        const answer = answers.get(q.id)
        return {
          id: q.id,
          question: q.question,
          question_type: q.question_type,
          points: q.points,
          pointsAwarded: answer?.points_awarded ?? 0,
          correct: answer?.is_correct ?? false,
          selectedOptionIds: answer?.selected_option_ids ?? [],
          textAnswer: answer?.text_answer ?? null,
          options: q.options.map((o) => ({ id: o.id, option_text: o.option_text, ...(reveal ? { is_correct: o.is_correct } : {}) })),
          ...(reveal ? { explanation: q.explanation, acceptedAnswers: q.accepted_answers } : {}),
        }
      }),
    }
  },
}

export type QuizOverview = Awaited<ReturnType<typeof quizService.overview>>
export type QuizTake = Awaited<ReturnType<typeof quizService.take>>
export type QuizResult = Awaited<ReturnType<typeof quizService.result>>
