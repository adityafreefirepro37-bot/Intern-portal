import type { EnrollmentType, Prisma, RequiredTrainingTarget } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import {
  buildPlanItems,
  effectiveEnrollmentStatus,
  isBlockedByPrerequisite,
  isLessonLocked,
  learningDeadline,
  slugify,
} from '@/lib/learning/rules'
import { addDays, parseDateOnly, todayIn } from '@/lib/interns/dates'
import { fullName } from '@/lib/utils/format'
import { isoDateSchema, parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { optionalText, optionalUuid, personSelect, requireUserInScope, scopedUsers, TRACKED_STATUSES } from './hr-shared'
import { completionFacts, orderedLessons, recomputeEnrollment } from './learning-progress'

/**
 * Learning for people: the hub, enrollment (self / assigned / required),
 * course and lesson views with progress, learning paths assigned as personal
 * plan snapshots, and required-training rules. Progress is only ever changed
 * by real activity (lesson completion, quiz attempts, assignment reviews).
 */

const optionalDate = z
  .string()
  .optional()
  .transform((v) => v || undefined)
  .pipe(isoDateSchema.optional())

const assignSchema = z.strictObject({
  courseId: z.uuid(),
  userIds: z.array(z.uuid()).min(1, 'Choose at least one person').max(200),
  dueDate: optionalDate,
})

const pathSchema = z.strictObject({
  pathId: optionalUuid,
  name: z.string().trim().min(3, 'Add a name').max(160),
  description: optionalText(2000),
  departmentId: optionalUuid,
  positionId: optionalUuid,
})

const pathCoursesSchema = z.strictObject({
  pathId: z.uuid(),
  items: z
    .array(
      z.strictObject({
        courseId: z.uuid(),
        required: z.boolean(),
        requiresPrevious: z.boolean(),
        dueDays: z.number().int().min(1).max(365).nullable(),
      }),
    )
    .max(30),
})

const assignPathSchema = z.strictObject({
  pathId: z.uuid(),
  userIds: z.array(z.uuid()).min(1, 'Choose at least one person').max(200),
  dueDate: optionalDate,
})

const ruleSchema = z
  .strictObject({
    courseId: z.uuid(),
    targetType: z.enum(['EVERYONE', 'DEPARTMENT', 'POSITION', 'INTERN', 'ONBOARDING_TEMPLATE']),
    targetId: optionalUuid,
    dueDays: z.coerce.number().int().min(1).max(365).default(14),
  })
  .refine((v) => (v.targetType === 'EVERYONE') === !v.targetId, {
    message: 'Choose who this applies to',
    path: ['targetId'],
  })

const enrollmentSelect = {
  id: true,
  course_id: true,
  enrollment_type: true,
  status: true,
  progress_percentage: true,
  due_date: true,
  assigned_at: true,
  started_at: true,
  completed_at: true,
  learning_plan_id: true,
  assigner: { select: personSelect },
  course: {
    select: {
      id: true,
      title: true,
      description: true,
      difficulty: true,
      estimated_minutes: true,
      is_required: true,
      status: true,
      category: { select: { name: true } },
    },
  },
} as const satisfies Prisma.CourseEnrollmentSelect

type EnrollmentRow = Prisma.CourseEnrollmentGetPayload<{ select: typeof enrollmentSelect }>

function enrollmentView(row: EnrollmentRow, today: Date) {
  return {
    ...row,
    effectiveStatus: effectiveEnrollmentStatus(row.status, row.due_date, today),
    deadline: learningDeadline(row.due_date, row.status === 'COMPLETED', today),
  }
}
export type EnrollmentView = ReturnType<typeof enrollmentView>

/** Creates or re-activates an enrollment; returns null when already active. */
async function upsertEnrollment(input: {
  organizationId: string
  courseId: string
  userId: string
  type: EnrollmentType
  assignedBy: string | null
  dueDate: Date | null
  planId?: string | null
  ruleId?: string | null
}) {
  const existing = await prisma.courseEnrollment.findUnique({
    where: { course_id_user_id: { course_id: input.courseId, user_id: input.userId } },
    select: { id: true, status: true, enrollment_type: true, due_date: true },
  })
  if (existing && existing.status !== 'CANCELLED') {
    // Stronger obligations upgrade the existing enrollment; a later due date never overrides an earlier one.
    const rank: Record<EnrollmentType, number> = { SELF_ENROLLED: 0, ASSIGNED: 1, REQUIRED: 2 }
    const upgrade = rank[input.type] > rank[existing.enrollment_type]
    const earlier = input.dueDate && (!existing.due_date || input.dueDate < existing.due_date)
    if (existing.status !== 'COMPLETED' && (upgrade || earlier || input.planId)) {
      await prisma.courseEnrollment.update({
        where: { id: existing.id },
        data: {
          ...(upgrade ? { enrollment_type: input.type, assigned_by: input.assignedBy } : {}),
          ...(earlier ? { due_date: input.dueDate } : {}),
          ...(input.planId ? { learning_plan_id: input.planId } : {}),
        },
      })
    }
    return null
  }
  const data = {
    organization_id: input.organizationId,
    enrollment_type: input.type,
    status: 'NOT_STARTED' as const,
    progress_percentage: 0,
    assigned_by: input.assignedBy,
    assigned_at: new Date(),
    due_date: input.dueDate,
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    learning_plan_id: input.planId ?? null,
    required_rule_id: input.ruleId ?? null,
  }
  const row = existing
    ? await prisma.courseEnrollment.update({ where: { id: existing.id }, data, select: { id: true } })
    : await prisma.courseEnrollment.create({
        data: { ...data, course_id: input.courseId, user_id: input.userId },
        select: { id: true },
      })
  // Progress already made (e.g. lessons completed before a cancellation) counts again.
  await recomputeEnrollment(input.organizationId, input.userId, input.courseId, input.assignedBy)
  return row
}

async function publishedCourse(ctx: RequestContext, courseId: string) {
  const course = await prisma.course.findFirst({
    where: { id: parseInput(z.uuid(), courseId), organization_id: ctx.organization.id, deleted_at: null },
    select: { id: true, title: true, status: true, is_sequential: true },
  })
  if (!course) throw new NotFoundError('Course')
  return course
}

/** Who may view this course's content: anyone with course.read when published; authors any time. */
function canView(ctx: RequestContext, status: string) {
  return status === 'PUBLISHED' || authorizationService.can(ctx, 'course.update')
}

export const learningService = {
  /** The signed-in person's learning hub (bounded queries; no full history load). */
  async hub(ctx: RequestContext) {
    authorizationService.require(ctx, 'course.read')
    const today = todayIn(ctx.organization.timezone)
    const userId = ctx.actor.userId
    const [enrollments, plans, lessonsDone, quizStats, assignmentStats, intern] = await Promise.all([
      prisma.courseEnrollment.findMany({
        where: { user_id: userId, status: { not: 'CANCELLED' }, course: { deleted_at: null } },
        orderBy: [{ updated_at: 'desc' }],
        take: 100,
        select: { ...enrollmentSelect, updated_at: true },
      }),
      prisma.learningPlan.findMany({
        where: { user_id: userId, status: { not: 'CANCELLED' } },
        orderBy: { assigned_at: 'desc' },
        take: 10,
        select: {
          id: true,
          path_name: true,
          status: true,
          due_date: true,
          assigned_at: true,
          items: {
            orderBy: { position: 'asc' },
            select: {
              course_id: true,
              is_required: true,
              due_date: true,
              prerequisite_course_id: true,
              course: { select: { id: true, title: true } },
            },
          },
        },
      }),
      prisma.learningProgress.count({ where: { user_id: userId, status: 'COMPLETED', lesson_id: { not: null } } }),
      prisma.quizAttempt.groupBy({ by: ['passed'], where: { user_id: userId, status: 'SUBMITTED' }, _count: { _all: true } }),
      prisma.learningAssignmentSubmission.groupBy({
        by: ['status'],
        where: { user_id: userId, status: { not: 'DRAFT' } },
        _count: { _all: true },
      }),
      prisma.intern.findFirst({
        where: { user_id: userId, deleted_at: null },
        select: { department_id: true, position_id: true },
      }),
    ])
    const views = enrollments.map((e) => enrollmentView(e, today))
    const completedCourseIds = new Set(views.filter((v) => v.status === 'COMPLETED').map((v) => v.course_id))
    const minutes = await prisma.lesson.aggregate({
      where: { learning_progress: { some: { user_id: userId, status: 'COMPLETED' } } },
      _sum: { estimated_minutes: true },
    })
    const enrolledIds = new Set(views.map((v) => v.course_id))
    const recommended = await prisma.course.findMany({
      where: {
        organization_id: ctx.organization.id,
        status: 'PUBLISHED',
        deleted_at: null,
        id: { notIn: [...enrolledIds] },
        OR: [
          { is_required: true },
          ...(intern?.department_id || intern?.position_id
            ? [
                {
                  path_courses: {
                    some: {
                      learning_path: {
                        status: 'PUBLISHED' as const,
                        deleted_at: null,
                        OR: [
                          ...(intern.department_id ? [{ department_id: intern.department_id }] : []),
                          ...(intern.position_id ? [{ position_id: intern.position_id }] : []),
                        ],
                      },
                    },
                  },
                },
              ]
            : []),
        ],
      },
      take: 4,
      orderBy: [{ is_required: 'desc' }, { title: 'asc' }],
      select: { id: true, title: true, description: true, difficulty: true, estimated_minutes: true, is_required: true },
    })
    const passed = quizStats.find((q) => q.passed === true)?._count._all ?? 0
    const attempted = quizStats.reduce((s, q) => s + q._count._all, 0)
    const count = (status: string) => assignmentStats.find((a) => a.status === status)?._count._all ?? 0
    const active = views.filter((v) => v.status !== 'COMPLETED')
    return {
      today,
      required: active.filter((v) => v.enrollment_type === 'REQUIRED'),
      continueLearning: active.filter((v) => v.status === 'IN_PROGRESS').slice(0, 4),
      assigned: active.filter((v) => v.enrollment_type !== 'SELF_ENROLLED'),
      selfEnrolled: active.filter((v) => v.enrollment_type === 'SELF_ENROLLED'),
      completed: views.filter((v) => v.status === 'COMPLETED'),
      upcoming: active
        .filter((v) => v.due_date)
        .sort((a, b) => a.due_date!.getTime() - b.due_date!.getTime())
        .slice(0, 6),
      plans: plans.map((plan) => ({
        ...plan,
        items: plan.items.map((item) => ({
          ...item,
          completed: completedCourseIds.has(item.course_id),
          blocked: isBlockedByPrerequisite(item.prerequisite_course_id, completedCourseIds),
        })),
      })),
      stats: {
        coursesCompleted: completedCourseIds.size,
        coursesActive: active.length,
        lessonsCompleted: lessonsDone,
        quizzesPassed: passed,
        quizzesAttempted: attempted,
        assignmentsApproved: count('APPROVED'),
        assignmentsSubmitted: count('SUBMITTED') + count('RESUBMITTED') + count('APPROVED') + count('CHANGES_REQUESTED'),
        /** Sum of estimated minutes of completed lessons (time isn't tracked live). */
        learningMinutes: minutes._sum.estimated_minutes ?? 0,
      },
      recommended,
    }
  },

  async enrollSelf(ctx: RequestContext, courseId: string) {
    authorizationService.require(ctx, 'learning.track')
    const course = await publishedCourse(ctx, courseId)
    if (course.status !== 'PUBLISHED') throw new ValidationError('This course isn’t open for enrollment')
    await upsertEnrollment({
      organizationId: ctx.organization.id,
      courseId: course.id,
      userId: ctx.actor.userId,
      type: 'SELF_ENROLLED',
      assignedBy: null,
      dueDate: null,
    })
  },

  /** Assign a published course to people in the assigner's learning.manage scope. */
  async assign(ctx: RequestContext, input: unknown) {
    const data = parseInput(assignSchema, input)
    const where = scopedUsers(ctx, 'learning.manage')
    if (!where) throw new ForbiddenError()
    const course = await publishedCourse(ctx, data.courseId)
    if (course.status !== 'PUBLISHED') throw new ValidationError('Publish the course before assigning it')
    const users = await prisma.user.findMany({
      where: { AND: [where, { id: { in: data.userIds }, deleted_at: null, status: 'ACTIVE' }] },
      select: { id: true },
    })
    if (users.length !== new Set(data.userIds).size) throw new NotFoundError('Person')
    const dueDate = data.dueDate ? parseDateOnly(data.dueDate) : null
    let created = 0
    for (const user of users) {
      const row = await upsertEnrollment({
        organizationId: ctx.organization.id,
        courseId: course.id,
        userId: user.id,
        type: 'ASSIGNED',
        assignedBy: ctx.actor.userId,
        dueDate,
      })
      if (row) {
        created++
        await domainEvents.emit('learning.course_assigned', {
          organizationId: ctx.organization.id,
          actorUserId: ctx.actor.userId,
          payload: { enrollmentId: row.id, courseId: course.id, userId: user.id, required: false },
        })
      }
    }
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.LEARNING_ASSIGNED,
      resourceType: 'course',
      resourceId: course.id,
      metadata: { userIds: data.userIds, dueDate: data.dueDate ?? null, newEnrollments: created },
    })
    return { created, already: users.length - created }
  },

  /** Cancel an enrollment (not completed ones — completions are history). */
  async cancelEnrollment(ctx: RequestContext, enrollmentId: string) {
    const id = parseInput(z.uuid(), enrollmentId)
    const enrollment = await prisma.courseEnrollment.findFirst({
      where: { id, organization_id: ctx.organization.id },
      select: { id: true, user_id: true, status: true, enrollment_type: true, course_id: true },
    })
    if (!enrollment) throw new NotFoundError('Enrollment')
    const isOwn = enrollment.user_id === ctx.actor.userId
    if (isOwn && enrollment.enrollment_type === 'SELF_ENROLLED') {
      authorizationService.require(ctx, 'learning.track')
    } else {
      await requireUserInScope(ctx, 'learning.manage', enrollment.user_id)
    }
    if (enrollment.status === 'COMPLETED') throw new ConflictError('Completed learning stays on the record')
    await prisma.courseEnrollment.update({
      where: { id: enrollment.id },
      data: { status: 'CANCELLED', cancelled_at: new Date() },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.LEARNING_UNASSIGNED,
      resourceType: 'course_enrollment',
      resourceId: enrollment.id,
      metadata: { userId: enrollment.user_id, courseId: enrollment.course_id, before: enrollment.status },
    })
  },

  /** Course page: outline with the viewer's progress, locks and next step. */
  async courseView(ctx: RequestContext, courseId: string) {
    authorizationService.require(ctx, 'course.read')
    const course = await prisma.course.findFirst({
      where: { id: parseInput(z.uuid(), courseId), organization_id: ctx.organization.id, deleted_at: null },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        difficulty: true,
        estimated_minutes: true,
        is_required: true,
        is_sequential: true,
        require_quizzes: true,
        require_assignments: true,
        category: { select: { name: true } },
        modules: {
          orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
          select: {
            id: true,
            title: true,
            description: true,
            lessons: {
              orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
              select: { id: true, title: true, content_type: true, estimated_minutes: true, is_required: true },
            },
          },
        },
        quizzes: {
          where: { status: 'PUBLISHED' },
          orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
          select: { id: true, module_id: true, title: true, is_required: true, passing_score: true, _count: { select: { questions: true } } },
        },
        assignments: {
          orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
          select: { id: true, module_id: true, title: true, is_required: true, due_days: true },
        },
      },
    })
    if (!course) throw new NotFoundError('Course')
    const enrollment = await prisma.courseEnrollment.findUnique({
      where: { course_id_user_id: { course_id: course.id, user_id: ctx.actor.userId } },
      select: enrollmentSelect,
    })
    const enrolled = Boolean(enrollment && enrollment.status !== 'CANCELLED')
    if (!canView(ctx, course.status) && !enrolled) throw new NotFoundError('Course')
    const today = todayIn(ctx.organization.timezone)
    const facts = enrolled ? await completionFacts(ctx.actor.userId, course.id) : null
    const [bestAttempts, submissions] = enrolled
      ? await Promise.all([
          prisma.quizAttempt.groupBy({
            by: ['quiz_id'],
            where: { user_id: ctx.actor.userId, status: 'SUBMITTED', quiz: { course_id: course.id } },
            _max: { percentage: true },
            _count: { _all: true },
          }),
          prisma.learningAssignmentSubmission.findMany({
            where: { user_id: ctx.actor.userId, assignment: { course_id: course.id } },
            select: { assignment_id: true, status: true },
          }),
        ])
      : [[], []]
    const ordered = course.modules.flatMap((m) => m.lessons.map((l) => ({ id: l.id, required: l.is_required })))
    const completed = facts?.completedLessonIds ?? new Set<string>()
    const nextLesson = ordered.find((l) => !completed.has(l.id) && !isLessonLocked(course.is_sequential, ordered, completed, l.id))
    const assignmentDue = (dueDays: number | null) =>
      dueDays && enrollment ? addDays(new Date(enrollment.assigned_at), dueDays) : null
    const modules = course.modules.map((m) => ({
      ...m,
      lessons: m.lessons.map((l) => ({
        ...l,
        completed: completed.has(l.id),
        locked: isLessonLocked(course.is_sequential, ordered, completed, l.id),
      })),
      quizzes: course.quizzes
        .filter((q) => q.module_id === m.id)
        .map((q) => quizState(q, bestAttempts, facts?.passedQuizIds)),
      assignments: course.assignments
        .filter((a) => a.module_id === m.id)
        .map((a) => ({
          ...a,
          status: submissions.find((s) => s.assignment_id === a.id)?.status ?? null,
          dueDate: assignmentDue(a.due_days),
        })),
    }))
    return {
      course,
      modules,
      /** Course-level items (final assessment etc.). */
      finalQuizzes: course.quizzes.filter((q) => !q.module_id).map((q) => quizState(q, bestAttempts, facts?.passedQuizIds)),
      finalAssignments: course.assignments
        .filter((a) => !a.module_id)
        .map((a) => ({
          ...a,
          status: submissions.find((s) => s.assignment_id === a.id)?.status ?? null,
          dueDate: assignmentDue(a.due_days),
        })),
      enrollment: enrollment && enrolled ? enrollmentView(enrollment, today) : null,
      completion: facts?.result ?? null,
      nextLessonId: nextLesson?.id ?? null,
      can: {
        enroll: !enrolled && course.status === 'PUBLISHED' && authorizationService.can(ctx, 'learning.track'),
        learn: enrolled && authorizationService.can(ctx, 'learning.track'),
        author: authorizationService.can(ctx, 'course.update'),
        assign: course.status === 'PUBLISHED' && authorizationService.can(ctx, 'learning.manage'),
      },
    }
  },

  /** A lesson with course navigation. Learners' access is recorded (started / last accessed). */
  async lessonView(ctx: RequestContext, lessonId: string) {
    authorizationService.require(ctx, 'course.read')
    const lesson = await prisma.lesson.findFirst({
      where: { id: parseInput(z.uuid(), lessonId), course: { organization_id: ctx.organization.id, deleted_at: null } },
      select: {
        id: true,
        title: true,
        description: true,
        content_type: true,
        content: true,
        video_url: true,
        document_url: true,
        link_url: true,
        estimated_minutes: true,
        is_required: true,
        course_id: true,
        module: { select: { id: true, title: true } },
        course: { select: { id: true, title: true, status: true, is_sequential: true } },
      },
    })
    if (!lesson) throw new NotFoundError('Lesson')
    const enrollment = await prisma.courseEnrollment.findUnique({
      where: { course_id_user_id: { course_id: lesson.course_id, user_id: ctx.actor.userId } },
      select: { id: true, status: true, started_at: true },
    })
    const enrolled = Boolean(enrollment && enrollment.status !== 'CANCELLED')
    if (!canView(ctx, lesson.course.status) && !enrolled) throw new NotFoundError('Lesson')
    const ordered = await orderedLessons(lesson.course_id)
    const index = ordered.findIndex((l) => l.id === lesson.id)
    const progressRows = enrolled
      ? await prisma.learningProgress.findMany({
          where: { user_id: ctx.actor.userId, course_id: lesson.course_id, lesson_id: { not: null } },
          select: { lesson_id: true, status: true },
        })
      : []
    const completed = new Set(progressRows.filter((p) => p.status === 'COMPLETED').map((p) => p.lesson_id!))
    const locked = isLessonLocked(lesson.course.is_sequential, ordered, completed, lesson.id)
    if (enrolled && !locked && authorizationService.can(ctx, 'learning.track')) {
      const now = new Date()
      await prisma.learningProgress.upsert({
        where: { user_id_course_id_lesson_id: { user_id: ctx.actor.userId, course_id: lesson.course_id, lesson_id: lesson.id } },
        create: {
          user_id: ctx.actor.userId,
          course_id: lesson.course_id,
          lesson_id: lesson.id,
          status: 'IN_PROGRESS',
          progress_percent: 0,
          started_at: now,
          last_accessed_at: now,
        },
        update: { last_accessed_at: now },
      })
      if (enrollment && !enrollment.started_at && enrollment.status === 'NOT_STARTED') {
        await prisma.courseEnrollment.updateMany({
          where: { id: enrollment.id, status: 'NOT_STARTED' },
          data: { status: 'IN_PROGRESS', started_at: now },
        })
      }
    }
    const titles = await prisma.lesson.findMany({
      where: { id: { in: [ordered[index - 1]?.id, ordered[index + 1]?.id].filter((x): x is string => Boolean(x)) } },
      select: { id: true, title: true },
    })
    const title = (id?: string) => titles.find((t) => t.id === id) ?? null
    return {
      lesson,
      // Locked lessons show only their title (prerequisites first).
      content: locked ? null : lesson.content,
      locked,
      completed: completed.has(lesson.id),
      enrolled,
      position: { index: index + 1, total: ordered.length },
      previous: title(ordered[index - 1]?.id),
      next: title(ordered[index + 1]?.id),
      can: { complete: enrolled && !locked && !completed.has(lesson.id) && authorizationService.can(ctx, 'learning.track') },
    }
  },

  /** Marks a lesson complete for the signed-in learner (never someone else), then re-evaluates the course. */
  async completeLesson(ctx: RequestContext, lessonId: string) {
    authorizationService.require(ctx, 'learning.track')
    const lesson = await prisma.lesson.findFirst({
      where: { id: parseInput(z.uuid(), lessonId), course: { organization_id: ctx.organization.id, deleted_at: null } },
      select: { id: true, course_id: true, course: { select: { is_sequential: true, status: true } } },
    })
    if (!lesson) throw new NotFoundError('Lesson')
    const enrollment = await prisma.courseEnrollment.findUnique({
      where: { course_id_user_id: { course_id: lesson.course_id, user_id: ctx.actor.userId } },
      select: { status: true },
    })
    if (!enrollment || enrollment.status === 'CANCELLED') {
      throw new ValidationError('Enroll in the course first')
    }
    const ordered = await orderedLessons(lesson.course_id)
    const done = await prisma.learningProgress.findMany({
      where: { user_id: ctx.actor.userId, course_id: lesson.course_id, status: 'COMPLETED', lesson_id: { not: null } },
      select: { lesson_id: true },
    })
    const completed = new Set(done.map((d) => d.lesson_id!))
    if (isLessonLocked(lesson.course.is_sequential, ordered, completed, lesson.id)) {
      throw new ValidationError('Complete the earlier required lessons first')
    }
    const now = new Date()
    await prisma.learningProgress.upsert({
      where: { user_id_course_id_lesson_id: { user_id: ctx.actor.userId, course_id: lesson.course_id, lesson_id: lesson.id } },
      create: {
        user_id: ctx.actor.userId,
        course_id: lesson.course_id,
        lesson_id: lesson.id,
        status: 'COMPLETED',
        progress_percent: 100,
        started_at: now,
        completed_at: now,
        last_accessed_at: now,
      },
      update: { status: 'COMPLETED', progress_percent: 100, completed_at: now, last_accessed_at: now },
    })
    if (!completed.has(lesson.id)) {
      await domainEvents.emit('learning.lesson_completed', {
        organizationId: ctx.organization.id,
        actorUserId: ctx.actor.userId,
        payload: { courseId: lesson.course_id, lessonId: lesson.id, userId: ctx.actor.userId },
      })
    }
    return recomputeEnrollment(ctx.organization.id, ctx.actor.userId, lesson.course_id, ctx.actor.userId)
  },

  /** Learning progress of one person (self, or within learning.read scope). */
  async forUser(ctx: RequestContext, userId: string) {
    if (userId !== ctx.actor.userId) await requireUserInScope(ctx, 'learning.read', userId)
    else authorizationService.require(ctx, 'learning.read')
    const today = todayIn(ctx.organization.timezone)
    const [enrollments, attempts, submissions] = await Promise.all([
      prisma.courseEnrollment.findMany({
        where: { user_id: userId, organization_id: ctx.organization.id },
        orderBy: [{ status: 'asc' }, { due_date: 'asc' }],
        take: 100,
        select: enrollmentSelect,
      }),
      prisma.quizAttempt.findMany({
        where: { user_id: userId, status: 'SUBMITTED', quiz: { course: { organization_id: ctx.organization.id } } },
        orderBy: { submitted_at: 'desc' },
        take: 20,
        select: {
          id: true,
          attempt_number: true,
          percentage: true,
          passed: true,
          submitted_at: true,
          quiz: { select: { title: true, course: { select: { title: true } } } },
        },
      }),
      prisma.learningAssignmentSubmission.findMany({
        where: { user_id: userId, organization_id: ctx.organization.id, status: { not: 'DRAFT' } },
        orderBy: { updated_at: 'desc' },
        take: 20,
        select: {
          id: true,
          status: true,
          current_version: true,
          points_awarded: true,
          updated_at: true,
          assignment: { select: { id: true, title: true, max_points: true, course: { select: { title: true } } } },
        },
      }),
    ])
    return {
      enrollments: enrollments.map((e) => enrollmentView(e, today)),
      attempts,
      submissions,
      can: { assign: authorizationService.can(ctx, 'learning.manage') },
    }
  },

  /** People the viewer may assign learning to (learning.manage scope). */
  async assignablePeople(ctx: RequestContext) {
    const where = scopedUsers(ctx, 'learning.manage')
    if (!where) return []
    const rows = await prisma.user.findMany({
      where: {
        AND: [where, { deleted_at: null, status: 'ACTIVE', intern: { is: { deleted_at: null, status: { in: [...TRACKED_STATUSES, 'SELECTED'] } } } }],
      },
      orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
      select: { ...personSelect, intern: { select: { department: { select: { name: true } } } } },
    })
    return rows.map((r) => ({ id: r.id, name: fullName(r), department: r.intern?.department?.name ?? null }))
  },

  // ── Learning paths ────────────────────────────────────────────────────────
  async paths(ctx: RequestContext) {
    authorizationService.require(ctx, 'learning_path.read')
    const author = authorizationService.can(ctx, 'learning_path.update')
    return prisma.learningPath.findMany({
      where: {
        organization_id: ctx.organization.id,
        deleted_at: null,
        ...(author ? {} : { status: 'PUBLISHED' }),
      },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        department: { select: { name: true } },
        position: { select: { title: true } },
        _count: { select: { courses: true, plans: { where: { status: 'ACTIVE' } } } },
      },
    })
  },

  async path(ctx: RequestContext, pathId: string) {
    authorizationService.require(ctx, 'learning_path.read')
    const author = authorizationService.can(ctx, 'learning_path.update')
    const path = await prisma.learningPath.findFirst({
      where: {
        id: parseInput(z.uuid(), pathId),
        organization_id: ctx.organization.id,
        deleted_at: null,
        ...(author ? {} : { status: 'PUBLISHED' }),
      },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        department_id: true,
        position_id: true,
        department: { select: { name: true } },
        position: { select: { title: true } },
        courses: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            position: true,
            is_required: true,
            requires_previous: true,
            due_days: true,
            course: { select: { id: true, title: true, status: true, difficulty: true, estimated_minutes: true } },
          },
        },
      },
    })
    if (!path) throw new NotFoundError('Learning path')
    const plan = await prisma.learningPlan.findFirst({
      where: { user_id: ctx.actor.userId, learning_path_id: path.id, status: { not: 'CANCELLED' } },
      select: { id: true, status: true, due_date: true },
    })
    return {
      path,
      myPlan: plan,
      can: {
        edit: author,
        assign: path.status === 'PUBLISHED' && authorizationService.can(ctx, 'learning.manage'),
      },
    }
  },

  /** Global search: learning paths the viewer may see. */
  async searchPaths(ctx: RequestContext, term: string, take: number) {
    authorizationService.require(ctx, 'learning_path.read')
    const author = authorizationService.can(ctx, 'learning_path.update')
    return prisma.learningPath.findMany({
      where: {
        organization_id: ctx.organization.id,
        deleted_at: null,
        ...(author ? {} : { status: 'PUBLISHED' as const }),
        name: { contains: term, mode: 'insensitive' },
      },
      take,
      orderBy: { name: 'asc' },
      select: { id: true, name: true, status: true },
    })
  },

  async savePath(ctx: RequestContext, input: unknown) {
    const data = parseInput(pathSchema, input)
    authorizationService.require(ctx, data.pathId ? 'learning_path.update' : 'learning_path.create')
    const values = {
      name: data.name,
      description: data.description ?? null,
      department_id: data.departmentId ?? null,
      position_id: data.positionId ?? null,
    }
    let id: string
    if (data.pathId) {
      const { count } = await prisma.learningPath.updateMany({
        where: { id: data.pathId, organization_id: ctx.organization.id, deleted_at: null },
        data: values,
      })
      if (!count) throw new NotFoundError('Learning path')
      id = data.pathId
    } else {
      let slug = slugify(data.name) || 'path'
      for (let i = 2; await prisma.learningPath.count({ where: { organization_id: ctx.organization.id, slug } }); i++) {
        slug = `${slugify(data.name)}-${i}`
      }
      id = (
        await prisma.learningPath.create({
          data: { ...values, organization_id: ctx.organization.id, slug, created_by: ctx.actor.userId },
          select: { id: true },
        })
      ).id
    }
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.LEARNING_PATH_SAVED,
      resourceType: 'learning_path',
      resourceId: id,
      metadata: { name: data.name },
    })
    return { id }
  },

  /** Replace the path's ordered course list (existing plans keep their own snapshot). */
  async setPathCourses(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'learning_path.update')
    const data = parseInput(pathCoursesSchema, input)
    const path = await prisma.learningPath.findFirst({
      where: { id: data.pathId, organization_id: ctx.organization.id, deleted_at: null },
      select: { id: true },
    })
    if (!path) throw new NotFoundError('Learning path')
    const ids = data.items.map((i) => i.courseId)
    if (new Set(ids).size !== ids.length) throw new ValidationError('A course can appear only once in a path')
    const valid = await prisma.course.count({
      where: { id: { in: ids }, organization_id: ctx.organization.id, deleted_at: null },
    })
    if (valid !== ids.length) throw new ValidationError('Choose courses from this organization')
    await prisma.$transaction([
      prisma.learningPathCourse.deleteMany({ where: { learning_path_id: path.id } }),
      prisma.learningPathCourse.createMany({
        data: data.items.map((item, position) => ({
          learning_path_id: path.id,
          course_id: item.courseId,
          position,
          is_required: item.required,
          requires_previous: position > 0 && item.requiresPrevious,
          due_days: item.dueDays,
        })),
      }),
    ])
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.LEARNING_PATH_SAVED,
      resourceType: 'learning_path',
      resourceId: path.id,
      metadata: { courses: ids.length },
    })
  },

  async setPathStatus(ctx: RequestContext, input: unknown) {
    const data = parseInput(z.strictObject({ pathId: z.uuid(), action: z.enum(['PUBLISH', 'ARCHIVE', 'DRAFT']) }), input)
    authorizationService.require(ctx, data.action === 'ARCHIVE' ? 'learning_path.delete' : 'learning_path.update')
    const path = await prisma.learningPath.findFirst({
      where: { id: data.pathId, organization_id: ctx.organization.id, deleted_at: null },
      select: { id: true, status: true, courses: { select: { course: { select: { status: true } } } } },
    })
    if (!path) throw new NotFoundError('Learning path')
    if (data.action === 'PUBLISH') {
      if (!path.courses.length) throw new ValidationError('Add courses before publishing the path')
      if (path.courses.some((c) => c.course.status !== 'PUBLISHED')) {
        throw new ValidationError('Every course in the path must be published first')
      }
    }
    const status = data.action === 'PUBLISH' ? 'PUBLISHED' : data.action === 'ARCHIVE' ? 'ARCHIVED' : 'DRAFT'
    await prisma.learningPath.update({ where: { id: path.id }, data: { status } })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.LEARNING_PATH_SAVED,
      resourceType: 'learning_path',
      resourceId: path.id,
      metadata: { before: path.status, after: status },
    })
  },

  /**
   * Assign a path: for each person a plan snapshot is generated (ordered
   * items, prerequisites, due dates) and every course is enrolled. Later path
   * edits never change existing plans.
   */
  async assignPath(ctx: RequestContext, input: unknown) {
    const data = parseInput(assignPathSchema, input)
    const where = scopedUsers(ctx, 'learning.manage')
    if (!where) throw new ForbiddenError()
    const path = await prisma.learningPath.findFirst({
      where: { id: data.pathId, organization_id: ctx.organization.id, deleted_at: null, status: 'PUBLISHED' },
      select: {
        id: true,
        name: true,
        courses: { select: { course_id: true, position: true, is_required: true, requires_previous: true, due_days: true } },
      },
    })
    if (!path) throw new NotFoundError('Learning path')
    const users = await prisma.user.findMany({
      where: { AND: [where, { id: { in: data.userIds }, deleted_at: null, status: 'ACTIVE' }] },
      select: { id: true },
    })
    if (users.length !== new Set(data.userIds).size) throw new NotFoundError('Person')
    const today = todayIn(ctx.organization.timezone)
    const planDue = data.dueDate ? parseDateOnly(data.dueDate) : null
    const items = buildPlanItems(
      path.courses.map((c) => ({
        courseId: c.course_id,
        position: c.position,
        required: c.is_required,
        requiresPrevious: c.requires_previous,
        dueDays: c.due_days,
      })),
      today,
      planDue,
    )
    let assigned = 0
    for (const user of users) {
      const active = await prisma.learningPlan.count({
        where: { user_id: user.id, learning_path_id: path.id, status: 'ACTIVE' },
      })
      if (active) continue
      const plan = await prisma.learningPlan.create({
        data: {
          organization_id: ctx.organization.id,
          user_id: user.id,
          learning_path_id: path.id,
          path_name: path.name,
          assigned_by: ctx.actor.userId,
          due_date: planDue,
          items: {
            create: items.map((item) => ({
              course_id: item.courseId,
              position: item.position,
              is_required: item.required,
              prerequisite_course_id: item.prerequisiteCourseId,
              due_date: item.dueDate,
            })),
          },
        },
        select: { id: true },
      })
      for (const item of items) {
        await upsertEnrollment({
          organizationId: ctx.organization.id,
          courseId: item.courseId,
          userId: user.id,
          type: 'ASSIGNED',
          assignedBy: ctx.actor.userId,
          dueDate: item.dueDate,
          planId: plan.id,
        })
      }
      assigned++
      await domainEvents.emit('learning.path_assigned', {
        organizationId: ctx.organization.id,
        actorUserId: ctx.actor.userId,
        payload: { planId: plan.id, userId: user.id, pathName: path.name },
      })
    }
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.LEARNING_ASSIGNED,
      resourceType: 'learning_path',
      resourceId: path.id,
      metadata: { userIds: data.userIds, plans: assigned, dueDate: data.dueDate ?? null },
    })
    return { assigned, skipped: users.length - assigned }
  },

  /** Choices for the path editor and required-training form (authors / HR only). */
  async authoringOptions(ctx: RequestContext) {
    if (!authorizationService.canAny(ctx, ['learning_path.update', 'learning.manage', 'course.update'])) throw new ForbiddenError()
    const org = ctx.organization.id
    const orgWideManage = authorizationService.scopeOf(ctx, 'learning.manage') === 'ORGANIZATION'
    const [courses, publishedCourses, departments, positions, templates, interns] = await Promise.all([
      prisma.course.findMany({
        where: { organization_id: org, deleted_at: null, status: { not: 'ARCHIVED' } },
        orderBy: { title: 'asc' },
        select: { id: true, title: true },
      }),
      prisma.course.findMany({
        where: { organization_id: org, deleted_at: null, status: 'PUBLISHED' },
        orderBy: { title: 'asc' },
        select: { id: true, title: true },
      }),
      prisma.department.findMany({ where: { organization_id: org }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      prisma.position.findMany({ where: { organization_id: org }, orderBy: { title: 'asc' }, select: { id: true, title: true } }),
      orgWideManage
        ? prisma.onboardingTemplate.findMany({ where: { organization_id: org }, orderBy: { name: 'asc' }, select: { id: true, name: true } })
        : Promise.resolve([]),
      orgWideManage
        ? prisma.intern.findMany({
            where: { organization_id: org, deleted_at: null, status: { in: [...TRACKED_STATUSES, 'SELECTED'] } },
            orderBy: { user: { first_name: 'asc' } },
            select: { id: true, user: { select: personSelect } },
          })
        : Promise.resolve([]),
    ])
    return {
      courses,
      publishedCourses,
      departments,
      positions: positions.map((p) => ({ id: p.id, name: p.title })),
      templates,
      interns: interns.map((i) => ({ id: i.id, name: fullName(i.user) })),
    }
  },

  // ── Required training ─────────────────────────────────────────────────────
  async requiredRules(ctx: RequestContext) {
    if (authorizationService.scopeOf(ctx, 'learning.manage') !== 'ORGANIZATION') throw new ForbiddenError()
    return prisma.requiredTrainingRule.findMany({
      where: { organization_id: ctx.organization.id },
      orderBy: [{ is_active: 'desc' }, { created_at: 'desc' }],
      select: {
        id: true,
        target_type: true,
        target_id: true,
        due_days: true,
        is_active: true,
        created_at: true,
        course: { select: { id: true, title: true } },
        _count: { select: { enrollments: true } },
      },
    })
  },

  /** Organization-wide required training (HR): saving a rule enrolls everyone it matches now and later. */
  async saveRequiredRule(ctx: RequestContext, input: unknown) {
    if (authorizationService.scopeOf(ctx, 'learning.manage') !== 'ORGANIZATION') throw new ForbiddenError()
    const data = parseInput(ruleSchema, input)
    const course = await publishedCourse(ctx, data.courseId)
    if (course.status !== 'PUBLISHED') throw new ValidationError('Publish the course first')
    await assertTarget(ctx, data.targetType, data.targetId)
    const rule = await prisma.requiredTrainingRule.create({
      data: {
        organization_id: ctx.organization.id,
        course_id: course.id,
        target_type: data.targetType,
        target_id: data.targetId ?? null,
        due_days: data.dueDays,
        created_by: ctx.actor.userId,
      },
      select: { id: true },
    })
    const enrolled = await applyRequiredTraining(ctx.organization.id, ctx.organization.timezone, ctx.actor.userId, { ruleId: rule.id })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.REQUIRED_TRAINING_SAVED,
      resourceType: 'required_training_rule',
      resourceId: rule.id,
      metadata: { courseId: course.id, target: data.targetType, targetId: data.targetId ?? null, dueDays: data.dueDays, enrolled },
    })
    return { enrolled }
  },

  /** Deactivating a rule stops future enrollments; existing ones stay (they're part of the record). */
  async deactivateRequiredRule(ctx: RequestContext, ruleId: string) {
    if (authorizationService.scopeOf(ctx, 'learning.manage') !== 'ORGANIZATION') throw new ForbiddenError()
    const { count } = await prisma.requiredTrainingRule.updateMany({
      where: { id: parseInput(z.uuid(), ruleId), organization_id: ctx.organization.id },
      data: { is_active: false },
    })
    if (!count) throw new NotFoundError('Rule')
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.REQUIRED_TRAINING_SAVED,
      resourceType: 'required_training_rule',
      resourceId: ruleId,
      metadata: { active: false },
    })
  },
}

function quizState(
  q: { id: string; title: string; is_required: boolean; passing_score: number; module_id: string | null; _count: { questions: number } },
  best: { quiz_id: string; _max: { percentage: number | null }; _count: { _all: number } }[],
  passedIds: ReadonlySet<string> | undefined,
) {
  const row = best.find((b) => b.quiz_id === q.id)
  return {
    ...q,
    attempts: row?._count._all ?? 0,
    bestPercentage: row?._max.percentage ?? null,
    passed: passedIds?.has(q.id) ?? false,
  }
}

async function assertTarget(ctx: RequestContext, type: RequiredTrainingTarget, id: string | undefined) {
  if (type === 'EVERYONE' || !id) return
  const where = { id, organization_id: ctx.organization.id }
  const exists =
    type === 'DEPARTMENT'
      ? await prisma.department.count({ where })
      : type === 'POSITION'
        ? await prisma.position.count({ where })
        : type === 'INTERN'
          ? await prisma.intern.count({ where: { ...where, deleted_at: null } })
          : await prisma.onboardingTemplate.count({ where })
  if (!exists) throw new ValidationError('Choose who this applies to', { targetId: 'Not found' })
}

/**
 * Enrolls matching interns in required training. Runs when a rule is saved
 * (all current interns) and when an intern is created or starts onboarding
 * (that intern only). Idempotent: existing enrollments are kept.
 */
export async function applyRequiredTraining(
  organizationId: string,
  timeZone: string,
  actorUserId: string | null,
  filter: { ruleId?: string; internId?: string },
) {
  const rules = await prisma.requiredTrainingRule.findMany({
    where: {
      organization_id: organizationId,
      is_active: true,
      ...(filter.ruleId ? { id: filter.ruleId } : {}),
      course: { status: 'PUBLISHED', deleted_at: null },
    },
    select: { id: true, course_id: true, target_type: true, target_id: true, due_days: true },
  })
  if (!rules.length) return 0
  const today = todayIn(timeZone)
  let enrolled = 0
  for (const rule of rules) {
    const internWhere: Prisma.InternWhereInput = {
      organization_id: organizationId,
      deleted_at: null,
      status: { in: [...TRACKED_STATUSES, 'SELECTED'] },
      ...(filter.internId ? { id: filter.internId } : {}),
      ...(rule.target_type === 'DEPARTMENT' ? { department_id: rule.target_id } : {}),
      ...(rule.target_type === 'POSITION' ? { position_id: rule.target_id } : {}),
      ...(rule.target_type === 'INTERN' ? { id: rule.target_id! } : {}),
      ...(rule.target_type === 'ONBOARDING_TEMPLATE'
        ? { internships: { some: { onboarding: { is: { template_id: rule.target_id } } } } }
        : {}),
    }
    const interns = await prisma.intern.findMany({ where: internWhere, select: { user_id: true } })
    for (const intern of interns) {
      const row = await upsertEnrollment({
        organizationId,
        courseId: rule.course_id,
        userId: intern.user_id,
        type: 'REQUIRED',
        assignedBy: actorUserId,
        dueDate: addDays(today, rule.due_days),
        ruleId: rule.id,
      })
      if (row) {
        enrolled++
        await domainEvents.emit('learning.course_assigned', {
          organizationId,
          actorUserId,
          payload: { enrollmentId: row.id, courseId: rule.course_id, userId: intern.user_id, required: true },
        })
      }
    }
  }
  return enrolled
}

export type LearningHub = Awaited<ReturnType<typeof learningService.hub>>
export type CourseView = Awaited<ReturnType<typeof learningService.courseView>>
export type LessonView = Awaited<ReturnType<typeof learningService.lessonView>>
