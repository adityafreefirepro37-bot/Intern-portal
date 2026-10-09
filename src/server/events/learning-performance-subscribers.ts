import { prisma } from '@/lib/db/client'
import { logger } from '@/lib/logging'
import { fullName } from '@/lib/utils/format'
import { NOTIFICATION_TYPES, notificationService, type NotificationInput } from '../services/notification.service'
import { domainEvents } from './domain-events'

/**
 * Learning and performance events → in-app notifications. Scheduled
 * reminders (deadlines, check-ins, overdue reviews) are de-duplicated so a
 * re-run of the daily job never notifies twice.
 */

async function alreadyNotified(userIds: string[], type: string, entityId: string | null, since: Date) {
  if (!userIds.length) return new Set<string>()
  const rows = await prisma.notification.findMany({
    where: { user_id: { in: userIds }, type, created_at: { gte: since }, ...(entityId ? { related_entity_id: entityId } : {}) },
    select: { user_id: true },
  })
  return new Set(rows.map((r) => r.user_id))
}

async function notifyOnce(
  organizationId: string,
  recipients: string[],
  input: NotificationInput,
  since: Date,
) {
  const done = await alreadyNotified(recipients, input.type, input.entityId, since)
  await notificationService.notify(
    organizationId,
    recipients.filter((id) => !done.has(id)),
    input,
    null,
  )
}

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000)

async function courseTitle(courseId: string) {
  return (await prisma.course.findUnique({ where: { id: courseId }, select: { title: true } }))?.title ?? 'a course'
}

async function managersOf(userId: string) {
  const intern = await prisma.intern.findFirst({
    where: { user_id: userId, deleted_at: null },
    select: { manager_id: true, mentor_id: true, user: { select: { first_name: true, last_name: true, display_name: true } } },
  })
  return { ids: [intern?.manager_id, intern?.mentor_id], name: intern ? fullName(intern.user) : 'An intern' }
}

export function registerLearningPerformanceSubscribers() {
  // ── Learning ──────────────────────────────────────────────────────────────
  domainEvents.on('learning.course_assigned', async ({ organizationId, actorUserId, payload }) => {
    await notificationService.notify(
      organizationId,
      [payload.userId],
      {
        type: NOTIFICATION_TYPES.COURSE_ASSIGNED,
        title: `${payload.required ? 'Required training' : 'New course'}: “${await courseTitle(payload.courseId)}”`,
        entityType: 'course',
        entityId: payload.courseId,
      },
      actorUserId,
    )
  })

  domainEvents.on('learning.path_assigned', async ({ organizationId, actorUserId, payload }) => {
    await notificationService.notify(
      organizationId,
      [payload.userId],
      {
        type: NOTIFICATION_TYPES.LEARNING_PATH_ASSIGNED,
        title: `Learning path assigned: “${payload.pathName}”`,
        entityType: 'learning_plan',
        entityId: payload.planId,
      },
      actorUserId,
    )
  })

  domainEvents.on('learning.course_completed', async ({ organizationId, payload }) => {
    const title = await courseTitle(payload.courseId)
    const { ids, name } = await managersOf(payload.userId)
    await notificationService.notify(
      organizationId,
      [payload.userId],
      { type: NOTIFICATION_TYPES.COURSE_COMPLETED, title: `You completed “${title}”`, entityType: 'course', entityId: payload.courseId },
      null,
    )
    await notificationService.notify(
      organizationId,
      ids,
      { type: NOTIFICATION_TYPES.COURSE_COMPLETED, title: `${name} completed “${title}”`, entityType: 'course', entityId: payload.courseId },
      payload.userId,
    )
  })

  domainEvents.on('learning.quiz_submitted', async ({ organizationId, payload }) => {
    const quiz = await prisma.quiz.findUnique({ where: { id: payload.quizId }, select: { title: true } })
    await notificationService.notify(
      organizationId,
      [payload.userId],
      {
        type: payload.passed ? NOTIFICATION_TYPES.QUIZ_PASSED : NOTIFICATION_TYPES.QUIZ_FAILED,
        title: payload.passed ? `You passed “${quiz?.title ?? 'the quiz'}”` : `“${quiz?.title ?? 'The quiz'}” wasn’t passed this time`,
        entityType: 'quiz_attempt',
        entityId: payload.attemptId,
      },
      null,
    )
  })

  domainEvents.on('learning.assignment_submitted', async ({ organizationId, actorUserId, payload }) => {
    const assignment = await prisma.learningAssignment.findUnique({ where: { id: payload.assignmentId }, select: { title: true } })
    const { ids, name } = await managersOf(payload.userId)
    await notificationService.notify(
      organizationId,
      ids,
      {
        type: NOTIFICATION_TYPES.ASSIGNMENT_SUBMITTED,
        title: `${name} ${payload.version > 1 ? 'resubmitted' : 'submitted'} “${assignment?.title ?? 'an assignment'}”`,
        entityType: 'learning_submission',
        entityId: payload.submissionId,
      },
      actorUserId,
    )
  })

  domainEvents.on('learning.assignment_reviewed', async ({ organizationId, actorUserId, payload }) => {
    const assignment = await prisma.learningAssignment.findUnique({ where: { id: payload.assignmentId }, select: { title: true } })
    const approved = payload.decision === 'APPROVED'
    await notificationService.notify(
      organizationId,
      [payload.userId],
      {
        type: approved ? NOTIFICATION_TYPES.ASSIGNMENT_REVIEWED : NOTIFICATION_TYPES.ASSIGNMENT_CHANGES_REQUESTED,
        title: approved
          ? `“${assignment?.title ?? 'Your assignment'}” was approved`
          : `Changes requested on “${assignment?.title ?? 'your assignment'}”`,
        entityType: 'learning_submission',
        entityId: payload.submissionId,
      },
      actorUserId,
    )
  })

  domainEvents.on('learning.deadline', async ({ organizationId, payload }) => {
    const title = await courseTitle(payload.courseId)
    const overdue = payload.kind === 'OVERDUE'
    await notifyOnce(
      organizationId,
      [payload.userId],
      {
        type: overdue ? NOTIFICATION_TYPES.LEARNING_OVERDUE : NOTIFICATION_TYPES.LEARNING_DEADLINE_APPROACHING,
        title: overdue ? `“${title}” is overdue` : `“${title}” is due in 3 days`,
        entityType: 'course',
        entityId: payload.courseId,
      },
      hoursAgo(20),
    )
    if (overdue) {
      const { ids, name } = await managersOf(payload.userId)
      await notifyOnce(
        organizationId,
        ids.filter((x): x is string => Boolean(x)),
        { type: NOTIFICATION_TYPES.LEARNING_OVERDUE, title: `${name}: “${title}” is overdue`, entityType: 'course', entityId: payload.courseId },
        hoursAgo(20),
      )
    }
  })

  // ── Performance ───────────────────────────────────────────────────────────
  domainEvents.on('performance.goal_created', async ({ organizationId, actorUserId, payload }) => {
    const goal = await prisma.performanceGoal.findUnique({ where: { id: payload.goalId }, select: { title: true } })
    await notificationService.notify(
      organizationId,
      [payload.ownerId],
      { type: NOTIFICATION_TYPES.GOAL_ASSIGNED, title: `New goal: “${goal?.title ?? 'Goal'}”`, entityType: 'goal', entityId: payload.goalId },
      actorUserId,
    )
  })

  domainEvents.on('performance.goal_deadline', async ({ organizationId, payload }) => {
    const goal = await prisma.performanceGoal.findUnique({ where: { id: payload.goalId }, select: { title: true } })
    await notifyOnce(
      organizationId,
      [payload.ownerId],
      {
        type: NOTIFICATION_TYPES.GOAL_DEADLINE_APPROACHING,
        title: `Goal “${goal?.title ?? 'Goal'}” reaches its target date in 3 days`,
        entityType: 'goal',
        entityId: payload.goalId,
      },
      hoursAgo(20),
    )
  })

  domainEvents.on('performance.checkin_reminder', async ({ organizationId, payload }) => {
    const open = payload.kind === 'OPEN'
    await notifyOnce(
      organizationId,
      [payload.internUserId],
      {
        type: open ? NOTIFICATION_TYPES.CHECKIN_OPEN : NOTIFICATION_TYPES.CHECKIN_DUE,
        title: open ? 'This week’s check-in is open' : 'Your weekly check-in is due today',
        entityType: 'checkin',
        entityId: null,
      },
      new Date(`${payload.weekStart}T00:00:00Z`),
    )
  })

  domainEvents.on('performance.checkin_reviewed', async ({ organizationId, actorUserId, payload }) => {
    await notificationService.notify(
      organizationId,
      [payload.internUserId],
      { type: NOTIFICATION_TYPES.CHECKIN_REVIEWED, title: 'Your weekly check-in was reviewed', entityType: 'checkin', entityId: payload.checkinId },
      actorUserId,
    )
  })

  domainEvents.on('performance.feedback_given', async ({ organizationId, actorUserId, payload }) => {
    // Only feedback the intern is allowed to see is announced to them.
    if (!payload.visibleToRecipient) return
    await notificationService.notify(
      organizationId,
      [payload.recipientId],
      { type: NOTIFICATION_TYPES.FEEDBACK_RECEIVED, title: 'You received new feedback', entityType: 'feedback', entityId: payload.feedbackId },
      actorUserId,
    )
  })

  domainEvents.on('performance.feedback_requested', async ({ organizationId, actorUserId, payload }) => {
    const request = await prisma.feedbackRequest.findUnique({
      where: { id: payload.requestId },
      select: { requester: { select: { first_name: true, last_name: true, display_name: true } } },
    })
    await notificationService.notify(
      organizationId,
      [payload.recipientId],
      {
        type: NOTIFICATION_TYPES.FEEDBACK_REQUESTED,
        title: `${request ? fullName(request.requester) : 'An intern'} asked for your feedback`,
        entityType: 'feedback_request',
        entityId: payload.requestId,
      },
      actorUserId,
    )
  })

  domainEvents.on('performance.review_notice', async ({ organizationId, actorUserId, payload }) => {
    const review = await prisma.performanceReview.findUnique({
      where: { id: payload.reviewId },
      select: { cycle: { select: { name: true } }, intern: { select: { user: { select: { first_name: true, last_name: true, display_name: true } } } } },
    })
    if (!review) return
    const name = fullName(review.intern.user)
    const label = review.cycle?.name ?? 'Performance review'
    const map = {
      OPENED: { type: NOTIFICATION_TYPES.REVIEW_OPENED, title: `${label} has started` },
      SELF_DUE: { type: NOTIFICATION_TYPES.SELF_REVIEW_DUE, title: `Your self-review is ready (${label})` },
      MANAGER_DUE: { type: NOTIFICATION_TYPES.MANAGER_REVIEW_DUE, title: `Manager review due for ${name}` },
      MENTOR_DUE: { type: NOTIFICATION_TYPES.MENTOR_REVIEW_DUE, title: `Mentor review due for ${name}` },
      HR_DUE: { type: NOTIFICATION_TYPES.HR_REVIEW_DUE, title: `HR review due for ${name}` },
      COMPLETED: { type: NOTIFICATION_TYPES.REVIEW_COMPLETED, title: `${label} for ${name} is complete` },
      OVERDUE: { type: NOTIFICATION_TYPES.REVIEW_OVERDUE, title: `${label} for ${name} is overdue` },
    } as const
    const { type, title } = map[payload.kind]
    const input = { type, title, entityType: 'review' as const, entityId: payload.reviewId }
    if (payload.kind === 'OVERDUE') await notifyOnce(organizationId, payload.recipientIds, input, hoursAgo(20))
    else await notificationService.notify(organizationId, payload.recipientIds, input, actorUserId)
  })

  domainEvents.on('performance.development_plan_created', async ({ organizationId, actorUserId, payload }) => {
    const plan = await prisma.developmentPlan.findUnique({
      where: { id: payload.planId },
      select: { title: true, review: { select: { status: true } } },
    })
    // Plans attached to an unfinished review are announced when the intern can open them.
    if (!plan || (plan.review && plan.review.status !== 'COMPLETED')) return
    await notificationService.notify(
      organizationId,
      [payload.internUserId],
      { type: NOTIFICATION_TYPES.DEVELOPMENT_PLAN_CREATED, title: `New development plan: “${plan.title}”`, entityType: 'development_plan', entityId: payload.planId },
      actorUserId,
    )
  })

  // ── HR integration: new interns get their required training ─────────────
  const applyFor = async (organizationId: string, actorUserId: string | null, internId: string) => {
    const [{ applyRequiredTraining }, org] = await Promise.all([
      import('../services/learning.service'),
      prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
    ])
    if (!org) return
    const enrolled = await applyRequiredTraining(organizationId, org.timezone, actorUserId, { internId })
    if (enrolled) logger.info('Required training applied', { internId, enrolled })
  }
  domainEvents.on('intern.created', ({ organizationId, actorUserId, payload }) => applyFor(organizationId, actorUserId, payload.internId))
  domainEvents.on('onboarding.created', ({ organizationId, actorUserId, payload }) => applyFor(organizationId, actorUserId, payload.internId))
  domainEvents.on('intern.updated', async ({ organizationId, actorUserId, payload }) => {
    // A new department or position can bring new required training.
    if (payload.fields.some((f) => ['department_id', 'position_id', 'departmentId', 'positionId'].includes(f))) {
      await applyFor(organizationId, actorUserId, payload.internId)
    }
  })
}
