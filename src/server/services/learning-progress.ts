import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import { evaluateCompletion, statusForProgress, type CompletionResult } from '@/lib/learning/rules'
import { domainEvents } from '../events/domain-events'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'

/**
 * Course completion is always decided here, on the server, from stored facts:
 * completed lessons, passed quiz attempts and approved assignments. There is
 * no "mark course complete" operation. A completed enrollment is never
 * un-completed (history isn't rewritten when a course changes later).
 */

/** Lessons of a course in learner order (module position, then lesson position). */
export async function orderedLessons(courseId: string) {
  const modules = await prisma.courseModule.findMany({
    where: { course_id: courseId },
    orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
    select: {
      lessons: {
        orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
        select: { id: true, is_required: true },
      },
    },
  })
  return modules.flatMap((m) => m.lessons.map((l) => ({ id: l.id, required: l.is_required })))
}

export async function completionFacts(userId: string, courseId: string) {
  const [course, done, passed, approved] = await Promise.all([
    prisma.course.findUnique({
      where: { id: courseId },
      select: {
        require_quizzes: true,
        require_assignments: true,
        lessons: { select: { id: true, is_required: true } },
        quizzes: { where: { status: 'PUBLISHED' }, select: { id: true, is_required: true } },
        assignments: { select: { id: true, is_required: true } },
      },
    }),
    prisma.learningProgress.findMany({
      where: { user_id: userId, course_id: courseId, status: 'COMPLETED', lesson_id: { not: null } },
      select: { lesson_id: true },
    }),
    prisma.quizAttempt.findMany({
      where: { user_id: userId, status: 'SUBMITTED', passed: true, quiz: { course_id: courseId } },
      select: { quiz_id: true },
      distinct: ['quiz_id'],
    }),
    prisma.learningAssignmentSubmission.findMany({
      where: { user_id: userId, status: 'APPROVED', assignment: { course_id: courseId } },
      select: { assignment_id: true },
    }),
  ])
  if (!course) return null
  const completedLessonIds = new Set(done.map((d) => d.lesson_id!))
  const passedQuizIds = new Set(passed.map((p) => p.quiz_id))
  const approvedAssignmentIds = new Set(approved.map((a) => a.assignment_id))
  const result: CompletionResult = evaluateCompletion({
    lessons: course.lessons.map((l) => ({ id: l.id, required: l.is_required })),
    quizzes: course.quizzes.map((q) => ({ id: q.id, required: q.is_required })),
    assignments: course.assignments.map((a) => ({ id: a.id, required: a.is_required })),
    completedLessonIds,
    passedQuizIds,
    approvedAssignmentIds,
    requireQuizzes: course.require_quizzes,
    requireAssignments: course.require_assignments,
  })
  return { result, completedLessonIds, passedQuizIds, approvedAssignmentIds }
}

/**
 * Re-evaluates one enrollment after learning activity. Returns null when the
 * person isn't enrolled. Emits `learning.course_completed` once, when the
 * rule is first satisfied, and completes a learning plan whose required
 * courses are all done.
 */
export async function recomputeEnrollment(
  organizationId: string,
  userId: string,
  courseId: string,
  actorUserId: string | null,
) {
  const enrollment = await prisma.courseEnrollment.findUnique({
    where: { course_id_user_id: { course_id: courseId, user_id: userId } },
    select: { id: true, status: true, progress_percentage: true, started_at: true, learning_plan_id: true },
  })
  if (!enrollment || enrollment.status === 'CANCELLED') return null
  if (enrollment.status === 'COMPLETED') {
    return { status: enrollment.status, progress: enrollment.progress_percentage, completedNow: false }
  }
  const facts = await completionFacts(userId, courseId)
  if (!facts) return null
  const { progress, complete } = facts.result
  const now = new Date()
  const started = Boolean(enrollment.started_at) || progress > 0
  const status = complete ? 'COMPLETED' : started ? 'IN_PROGRESS' : statusForProgress(progress, false)
  const data: Prisma.CourseEnrollmentUpdateManyMutationInput = {
    status,
    progress_percentage: complete ? 100 : progress,
    ...(started && !enrollment.started_at ? { started_at: now } : {}),
    ...(complete ? { completed_at: now } : {}),
  }
  // Guarded so two concurrent completions can't both "complete" the enrollment.
  const { count } = await prisma.courseEnrollment.updateMany({
    where: { id: enrollment.id, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
    data,
  })
  const completedNow = complete && count === 1
  if (completedNow) {
    await auditService.log({
      organizationId,
      actorUserId,
      action: AUDIT_ACTIONS.LEARNING_COMPLETED,
      resourceType: 'course_enrollment',
      resourceId: enrollment.id,
      metadata: { courseId, userId },
    })
    await domainEvents.emit('learning.course_completed', {
      organizationId,
      actorUserId,
      payload: { enrollmentId: enrollment.id, courseId, userId },
    })
    if (enrollment.learning_plan_id) await completePlanIfDone(enrollment.learning_plan_id, userId)
  }
  return { status, progress: complete ? 100 : progress, completedNow }
}

async function completePlanIfDone(planId: string, userId: string) {
  const items = await prisma.learningPlanItem.findMany({
    where: { learning_plan_id: planId, is_required: true },
    select: { course_id: true },
  })
  const done = await prisma.courseEnrollment.count({
    where: { user_id: userId, status: 'COMPLETED', course_id: { in: items.map((i) => i.course_id) } },
  })
  if (items.length > 0 && done === items.length) {
    await prisma.learningPlan.updateMany({
      where: { id: planId, status: 'ACTIVE' },
      data: { status: 'COMPLETED', completed_at: new Date() },
    })
  }
}

/**
 * Certificate integration point (Phase 08). A completed course is *eligible*
 * for a certificate; issuing is the certificate engine's job, so for now the
 * eligibility is only exposed — nothing is generated.
 */
export const certificateEligibility = {
  async forUser(userId: string) {
    return prisma.courseEnrollment.findMany({
      where: { user_id: userId, status: 'COMPLETED' },
      select: { course_id: true, completed_at: true, course: { select: { title: true } } },
      orderBy: { completed_at: 'desc' },
    })
  },
}
