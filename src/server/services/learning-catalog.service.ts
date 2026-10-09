import type { CourseDifficulty, Prisma, QuizQuestionType } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { isSafeResourceUrl } from '@/lib/learning/content'
import { validateQuestionShape } from '@/lib/learning/quiz'
import { slugify } from '@/lib/learning/rules'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { optionalText, optionalUuid, personSelect } from './hr-shared'
import { skipTake, toPage } from './pagination'

/**
 * Course authoring (HR/Admin with course.* permissions) and the learner
 * catalog. Authoring views include correct quiz answers; learner views never
 * do (see learning.service.ts / quiz.service.ts).
 */

const DIFFICULTIES = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const
const checkbox = z.preprocess((v) => v === true || v === 'on' || v === 'true', z.boolean())
const optionalInt = (min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : null))
    .pipe(z.number().int().min(min).max(max).nullable())
const httpsUrl = z
  .string()
  .trim()
  .optional()
  .transform((v) => v || undefined)
  .refine((v) => v === undefined || isSafeResourceUrl(v), { message: 'Use a full https:// link' })

const courseSchema = z.strictObject({
  courseId: optionalUuid,
  title: z.string().trim().min(3, 'Add a title').max(160),
  description: optionalText(2000),
  categoryId: optionalUuid,
  difficulty: z.enum(DIFFICULTIES).default('BEGINNER'),
  estimatedMinutes: optionalInt(1, 100000),
  isRequired: checkbox,
  isSequential: checkbox,
  requireQuizzes: checkbox,
  requireAssignments: checkbox,
})

const categorySchema = z.strictObject({
  categoryId: optionalUuid,
  name: z.string().trim().min(2, 'Add a name').max(80),
  description: optionalText(300),
  isActive: checkbox,
})

const moduleSchema = z.strictObject({
  courseId: z.uuid(),
  moduleId: optionalUuid,
  title: z.string().trim().min(2, 'Add a title').max(160),
  description: optionalText(1000),
})

const lessonSchema = z
  .strictObject({
    moduleId: z.uuid(),
    lessonId: optionalUuid,
    title: z.string().trim().min(2, 'Add a title').max(160),
    description: optionalText(500),
    contentType: z.enum(['TEXT', 'VIDEO', 'DOCUMENT', 'LINK']),
    content: optionalText(50000),
    videoUrl: httpsUrl,
    documentUrl: httpsUrl,
    linkUrl: httpsUrl,
    estimatedMinutes: optionalInt(1, 1000),
    isRequired: checkbox,
  })
  .superRefine((v, ctx) => {
    const need: Record<string, [string, string | undefined]> = {
      TEXT: ['content', v.content],
      VIDEO: ['videoUrl', v.videoUrl],
      DOCUMENT: ['documentUrl', v.documentUrl],
      LINK: ['linkUrl', v.linkUrl],
    }
    const [field, value] = need[v.contentType]
    if (!value) ctx.addIssue({ code: 'custom', path: [field], message: 'Required for this lesson type' })
  })

const quizSchema = z.strictObject({
  courseId: z.uuid(),
  quizId: optionalUuid,
  moduleId: optionalUuid,
  title: z.string().trim().min(2, 'Add a title').max(160),
  description: optionalText(1000),
  passingScore: z.coerce.number().int().min(0).max(100),
  attemptLimit: optionalInt(1, 20),
  timeLimitMinutes: optionalInt(1, 600),
  answerPolicy: z.enum(['NEVER', 'AFTER_SUBMISSION', 'AFTER_PASS']),
  isRequired: checkbox,
})

const questionSchema = z.strictObject({
  quizId: z.uuid(),
  questionId: optionalUuid,
  question: z.string().trim().min(3, 'Write the question').max(1000),
  type: z.enum(['MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER']),
  points: z.coerce.number().int().min(1).max(100),
  explanation: optionalText(1000),
  /** "text" per option; correct ones listed in correctOptions (indexes). */
  options: z.array(z.string().trim().max(300)).max(8).default([]),
  correctOptions: z.array(z.coerce.number().int().min(0).max(7)).default([]),
  acceptedAnswers: z.array(z.string().trim().max(200)).max(10).default([]),
})

const assignmentSchema = z.strictObject({
  courseId: z.uuid(),
  assignmentId: optionalUuid,
  moduleId: optionalUuid,
  title: z.string().trim().min(3, 'Add a title').max(160),
  description: optionalText(1000),
  instructions: optionalText(10000),
  dueDays: optionalInt(1, 365),
  maxPoints: optionalInt(1, 1000),
  rubric: optionalText(5000),
  isRequired: checkbox,
})

export const courseQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  category: z.uuid().optional().catch(undefined),
  difficulty: z.enum(DIFFICULTIES).optional().catch(undefined),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
})

function requireAuthor(ctx: RequestContext) {
  if (!authorizationService.canAny(ctx, ['course.create', 'course.update'])) throw new ForbiddenError()
}

async function authoredCourse(ctx: RequestContext, courseId: string) {
  authorizationService.require(ctx, 'course.update')
  const course = await prisma.course.findFirst({
    where: { id: parseInput(z.uuid(), courseId), organization_id: ctx.organization.id, deleted_at: null },
    select: { id: true, title: true, status: true },
  })
  if (!course) throw new NotFoundError('Course')
  return course
}

async function uniqueSlug(table: 'course' | 'path' | 'category', organizationId: string, base: string) {
  const root = slugify(base) || 'item'
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? root : `${root}-${i + 1}`
    const where = { organization_id: organizationId, slug }
    const taken =
      table === 'course'
        ? await prisma.course.count({ where })
        : table === 'path'
          ? await prisma.learningPath.count({ where })
          : await prisma.courseCategory.count({ where })
    if (!taken) return slug
  }
  throw new ConflictError('Choose a more distinctive name')
}

const courseCardSelect = {
  id: true,
  title: true,
  slug: true,
  description: true,
  status: true,
  difficulty: true,
  estimated_minutes: true,
  is_required: true,
  published_at: true,
  category: { select: { id: true, name: true } },
  _count: { select: { lessons: true, modules: true } },
} as const satisfies Prisma.CourseSelect

export const learningCatalogService = {
  // ── Categories ────────────────────────────────────────────────────────────
  categories(ctx: RequestContext) {
    return prisma.courseCategory.findMany({
      where: { organization_id: ctx.organization.id, is_active: true },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, slug: true },
    })
  },

  async allCategories(ctx: RequestContext) {
    requireAuthor(ctx)
    return prisma.courseCategory.findMany({
      where: { organization_id: ctx.organization.id },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, description: true, is_active: true, _count: { select: { courses: true } } },
    })
  },

  async saveCategory(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'course.update')
    const data = parseInput(categorySchema, input)
    const values = { name: data.name, description: data.description ?? null, is_active: data.isActive }
    let id: string
    if (data.categoryId) {
      const { count } = await prisma.courseCategory.updateMany({
        where: { id: data.categoryId, organization_id: ctx.organization.id },
        data: values,
      })
      if (!count) throw new NotFoundError('Category')
      id = data.categoryId
    } else {
      const last = await prisma.courseCategory.aggregate({
        where: { organization_id: ctx.organization.id },
        _max: { sort_order: true },
      })
      id = (
        await prisma.courseCategory.create({
          data: {
            ...values,
            organization_id: ctx.organization.id,
            slug: await uniqueSlug('category', ctx.organization.id, data.name),
            sort_order: (last._max.sort_order ?? 0) + 1,
          },
          select: { id: true },
        })
      ).id
    }
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.COURSE_CATEGORY_SAVED,
      resourceType: 'course_category',
      resourceId: id,
      metadata: { name: data.name, active: data.isActive },
    })
    return { id }
  },

  // ── Catalog (learners) ────────────────────────────────────────────────────
  /** Published courses with the viewer's own enrollment state (one extra query, no N+1). */
  async catalog(ctx: RequestContext, rawQuery: unknown) {
    authorizationService.require(ctx, 'course.read')
    const query = courseQuerySchema.parse(rawQuery ?? {})
    const where: Prisma.CourseWhereInput = {
      organization_id: ctx.organization.id,
      deleted_at: null,
      status: 'PUBLISHED',
      ...(query.category ? { category_id: query.category } : {}),
      ...(query.difficulty ? { difficulty: query.difficulty } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    }
    const pagination = { page: query.page, pageSize: 24 }
    const [rows, total] = await Promise.all([
      prisma.course.findMany({
        where,
        orderBy: [{ is_required: 'desc' }, { title: 'asc' }],
        ...skipTake(pagination),
        select: courseCardSelect,
      }),
      prisma.course.count({ where }),
    ])
    const enrollments = await prisma.courseEnrollment.findMany({
      where: { user_id: ctx.actor.userId, course_id: { in: rows.map((r) => r.id) } },
      select: { course_id: true, status: true, progress_percentage: true, due_date: true, enrollment_type: true },
    })
    const byCourse = new Map(enrollments.map((e) => [e.course_id, e]))
    return {
      query,
      page: toPage(
        rows.map((row) => ({ ...row, enrollment: byCourse.get(row.id) ?? null })),
        total,
        pagination,
      ),
    }
  },

  // ── Authoring ─────────────────────────────────────────────────────────────
  async manageList(ctx: RequestContext, rawQuery: unknown) {
    requireAuthor(ctx)
    const query = courseQuerySchema.parse(rawQuery ?? {})
    const where: Prisma.CourseWhereInput = {
      organization_id: ctx.organization.id,
      deleted_at: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category_id: query.category } : {}),
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
    }
    const pagination = { page: query.page, pageSize: 25 }
    const [rows, total] = await Promise.all([
      prisma.course.findMany({
        where,
        orderBy: [{ updated_at: 'desc' }],
        ...skipTake(pagination),
        select: {
          ...courseCardSelect,
          updated_at: true,
          _count: {
            select: {
              lessons: true,
              modules: true,
              quizzes: true,
              assignments: true,
              enrollments: { where: { status: { not: 'CANCELLED' } } },
            },
          },
        },
      }),
      prisma.course.count({ where }),
    ])
    return { query, page: toPage(rows, total, pagination) }
  },

  async createCourse(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'course.create')
    const data = parseInput(courseSchema, input)
    await assertCategory(ctx, data.categoryId)
    const course = await prisma.course.create({
      data: {
        organization_id: ctx.organization.id,
        slug: await uniqueSlug('course', ctx.organization.id, data.title),
        ...courseValues(data),
        created_by: ctx.actor.userId,
        updated_by: ctx.actor.userId,
        modules: { create: { title: 'Module 1', position: 0 } },
      },
      select: { id: true },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.COURSE_CREATED,
      resourceType: 'course',
      resourceId: course.id,
      metadata: { title: data.title },
    })
    return course
  },

  async updateCourse(ctx: RequestContext, input: unknown) {
    const data = parseInput(courseSchema, input)
    if (!data.courseId) throw new ValidationError('Missing course')
    const course = await authoredCourse(ctx, data.courseId)
    await assertCategory(ctx, data.categoryId)
    const before = await prisma.course.findUniqueOrThrow({
      where: { id: course.id },
      select: { title: true, difficulty: true, is_required: true, is_sequential: true, require_quizzes: true, require_assignments: true },
    })
    await prisma.course.update({
      where: { id: course.id },
      data: { ...courseValues(data), updated_by: ctx.actor.userId },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.COURSE_UPDATED,
      resourceType: 'course',
      resourceId: course.id,
      metadata: {
        before,
        after: {
          title: data.title,
          difficulty: data.difficulty,
          is_required: data.isRequired,
          is_sequential: data.isSequential,
          require_quizzes: data.requireQuizzes,
          require_assignments: data.requireAssignments,
        },
      },
    })
  },

  /** Publish (validated), archive, or return to draft. */
  async setCourseStatus(ctx: RequestContext, input: unknown) {
    const data = parseInput(z.strictObject({ courseId: z.uuid(), action: z.enum(['PUBLISH', 'ARCHIVE', 'DRAFT']) }), input)
    const course = await authoredCourse(ctx, data.courseId)
    if (data.action === 'PUBLISH') {
      authorizationService.require(ctx, 'course.publish')
      const [requiredLessons, emptyQuizzes] = await Promise.all([
        prisma.lesson.count({ where: { course_id: course.id, is_required: true } }),
        prisma.quiz.count({ where: { course_id: course.id, status: 'PUBLISHED', questions: { none: {} } } }),
      ])
      if (!requiredLessons) throw new ValidationError('Add at least one required lesson before publishing')
      if (emptyQuizzes) throw new ValidationError('A published quiz has no questions')
    }
    if (data.action === 'DRAFT' && course.status === 'PUBLISHED') {
      const learners = await prisma.courseEnrollment.count({ where: { course_id: course.id, status: { not: 'CANCELLED' } } })
      if (learners) throw new ConflictError('People are enrolled — archive the course instead of unpublishing it')
    }
    const status = data.action === 'PUBLISH' ? 'PUBLISHED' : data.action === 'ARCHIVE' ? 'ARCHIVED' : 'DRAFT'
    await prisma.course.update({
      where: { id: course.id },
      data: {
        status,
        updated_by: ctx.actor.userId,
        ...(status === 'PUBLISHED' ? { published_at: new Date() } : {}),
      },
    })
    await auditService.logForContext(ctx, {
      action:
        status === 'PUBLISHED'
          ? AUDIT_ACTIONS.COURSE_PUBLISHED
          : status === 'ARCHIVED'
            ? AUDIT_ACTIONS.COURSE_ARCHIVED
            : AUDIT_ACTIONS.COURSE_UPDATED,
      resourceType: 'course',
      resourceId: course.id,
      metadata: { before: course.status, after: status },
    })
    return { status }
  },

  /** Soft delete — only courses nobody is enrolled in (otherwise archive). */
  async deleteCourse(ctx: RequestContext, courseId: string) {
    authorizationService.require(ctx, 'course.delete')
    const course = await authoredCourse(ctx, courseId)
    const learners = await prisma.courseEnrollment.count({ where: { course_id: course.id } })
    if (learners) throw new ConflictError('This course has learners — archive it instead')
    await prisma.course.update({ where: { id: course.id }, data: { deleted_at: new Date(), status: 'ARCHIVED' } })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.COURSE_ARCHIVED,
      resourceType: 'course',
      resourceId: course.id,
      metadata: { deleted: true, title: course.title },
    })
  },

  /** Full authoring view, including quiz answers (authors only). */
  async builder(ctx: RequestContext, courseId: string) {
    const { id } = await authoredCourse(ctx, courseId)
    const course = await prisma.course.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        difficulty: true,
        category_id: true,
        estimated_minutes: true,
        is_required: true,
        is_sequential: true,
        require_quizzes: true,
        require_assignments: true,
        published_at: true,
        creator: { select: personSelect },
        modules: {
          orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
          select: {
            id: true,
            title: true,
            description: true,
            position: true,
            lessons: {
              orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
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
                _count: { select: { learning_progress: true } },
              },
            },
          },
        },
        quizzes: {
          orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
          select: {
            id: true,
            module_id: true,
            title: true,
            description: true,
            passing_score: true,
            attempt_limit: true,
            time_limit_minutes: true,
            answer_policy: true,
            status: true,
            is_required: true,
            _count: { select: { attempts: true } },
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
        assignments: {
          orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
          select: {
            id: true,
            module_id: true,
            title: true,
            description: true,
            instructions: true,
            due_days: true,
            max_points: true,
            rubric: true,
            is_required: true,
            _count: { select: { submissions: true } },
          },
        },
        _count: { select: { enrollments: { where: { status: { not: 'CANCELLED' } } } } },
      },
    })
    return course
  },

  // ── Modules ───────────────────────────────────────────────────────────────
  async saveModule(ctx: RequestContext, input: unknown) {
    const data = parseInput(moduleSchema, input)
    const course = await authoredCourse(ctx, data.courseId)
    if (data.moduleId) {
      const { count } = await prisma.courseModule.updateMany({
        where: { id: data.moduleId, course_id: course.id },
        data: { title: data.title, description: data.description ?? null },
      })
      if (!count) throw new NotFoundError('Module')
    } else {
      const last = await prisma.courseModule.aggregate({ where: { course_id: course.id }, _max: { position: true } })
      await prisma.courseModule.create({
        data: { course_id: course.id, title: data.title, description: data.description ?? null, position: (last._max.position ?? -1) + 1 },
      })
    }
    await touchCourse(ctx, course.id, { module: data.title })
  },

  async moveModule(ctx: RequestContext, input: unknown) {
    const data = parseInput(z.strictObject({ moduleId: z.uuid(), direction: z.enum(['up', 'down']) }), input)
    const mod = await prisma.courseModule.findFirst({
      where: { id: data.moduleId, course: { organization_id: ctx.organization.id } },
      select: { id: true, course_id: true },
    })
    if (!mod) throw new NotFoundError('Module')
    await authoredCourse(ctx, mod.course_id)
    const siblings = await prisma.courseModule.findMany({
      where: { course_id: mod.course_id },
      orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
      select: { id: true },
    })
    await reorder(siblings, mod.id, data.direction, (id, position) =>
      prisma.courseModule.update({ where: { id }, data: { position } }),
    )
  },

  async deleteModule(ctx: RequestContext, moduleId: string) {
    const mod = await prisma.courseModule.findFirst({
      where: { id: parseInput(z.uuid(), moduleId), course: { organization_id: ctx.organization.id } },
      select: { id: true, course_id: true, _count: { select: { lessons: true, quizzes: true, assignments: true } } },
    })
    if (!mod) throw new NotFoundError('Module')
    await authoredCourse(ctx, mod.course_id)
    if (mod._count.lessons || mod._count.quizzes || mod._count.assignments) {
      throw new ConflictError('Move or delete the module’s lessons, quizzes and assignments first')
    }
    const remaining = await prisma.courseModule.count({ where: { course_id: mod.course_id } })
    if (remaining <= 1) throw new ConflictError('A course needs at least one module')
    await prisma.courseModule.delete({ where: { id: mod.id } })
  },

  // ── Lessons ───────────────────────────────────────────────────────────────
  async saveLesson(ctx: RequestContext, input: unknown) {
    const data = parseInput(lessonSchema, input)
    const mod = await prisma.courseModule.findFirst({
      where: { id: data.moduleId, course: { organization_id: ctx.organization.id } },
      select: { id: true, course_id: true },
    })
    if (!mod) throw new NotFoundError('Module')
    await authoredCourse(ctx, mod.course_id)
    // Keep only the field that matches the content type.
    const values = {
      title: data.title,
      description: data.description ?? null,
      content_type: data.contentType,
      content: data.content ?? null,
      video_url: data.contentType === 'VIDEO' ? (data.videoUrl ?? null) : null,
      document_url: data.contentType === 'DOCUMENT' ? (data.documentUrl ?? null) : null,
      link_url: data.contentType === 'LINK' ? (data.linkUrl ?? null) : null,
      estimated_minutes: data.estimatedMinutes,
      is_required: data.isRequired,
    }
    if (data.lessonId) {
      const { count } = await prisma.lesson.updateMany({
        where: { id: data.lessonId, course_id: mod.course_id },
        data: { ...values, module_id: mod.id },
      })
      if (!count) throw new NotFoundError('Lesson')
    } else {
      const last = await prisma.lesson.aggregate({ where: { module_id: mod.id }, _max: { sort_order: true } })
      await prisma.lesson.create({
        data: { ...values, course_id: mod.course_id, module_id: mod.id, sort_order: (last._max.sort_order ?? -1) + 1 },
      })
    }
    await touchCourse(ctx, mod.course_id, { lesson: data.title })
  },

  async moveLesson(ctx: RequestContext, input: unknown) {
    const data = parseInput(z.strictObject({ lessonId: z.uuid(), direction: z.enum(['up', 'down']) }), input)
    const lesson = await prisma.lesson.findFirst({
      where: { id: data.lessonId, course: { organization_id: ctx.organization.id } },
      select: { id: true, course_id: true, module_id: true },
    })
    if (!lesson) throw new NotFoundError('Lesson')
    await authoredCourse(ctx, lesson.course_id)
    const siblings = await prisma.lesson.findMany({
      where: { module_id: lesson.module_id },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
      select: { id: true },
    })
    await reorder(siblings, lesson.id, data.direction, (id, position) =>
      prisma.lesson.update({ where: { id }, data: { sort_order: position } }),
    )
  },

  /** Lessons with learner progress can't be deleted (make them optional instead) — progress history is kept. */
  async deleteLesson(ctx: RequestContext, lessonId: string) {
    const lesson = await prisma.lesson.findFirst({
      where: { id: parseInput(z.uuid(), lessonId), course: { organization_id: ctx.organization.id } },
      select: { id: true, course_id: true, title: true, _count: { select: { learning_progress: true, quizzes: true } } },
    })
    if (!lesson) throw new NotFoundError('Lesson')
    await authoredCourse(ctx, lesson.course_id)
    if (lesson._count.learning_progress) {
      throw new ConflictError('Learners have progress on this lesson — mark it optional instead of deleting it')
    }
    await prisma.lesson.delete({ where: { id: lesson.id } })
    await touchCourse(ctx, lesson.course_id, { deletedLesson: lesson.title })
  },

  // ── Quizzes ───────────────────────────────────────────────────────────────
  async saveQuiz(ctx: RequestContext, input: unknown) {
    const data = parseInput(quizSchema, input)
    const course = await authoredCourse(ctx, data.courseId)
    if (data.moduleId) {
      const ok = await prisma.courseModule.count({ where: { id: data.moduleId, course_id: course.id } })
      if (!ok) throw new ValidationError('Choose a module of this course', { moduleId: 'Unknown module' })
    }
    const values = {
      module_id: data.moduleId ?? null,
      title: data.title,
      description: data.description ?? null,
      passing_score: data.passingScore,
      attempt_limit: data.attemptLimit,
      time_limit_minutes: data.timeLimitMinutes,
      answer_policy: data.answerPolicy,
      is_required: data.isRequired,
    }
    let id: string
    if (data.quizId) {
      const { count } = await prisma.quiz.updateMany({ where: { id: data.quizId, course_id: course.id }, data: values })
      if (!count) throw new NotFoundError('Quiz')
      id = data.quizId
    } else {
      const last = await prisma.quiz.aggregate({ where: { course_id: course.id }, _max: { position: true } })
      id = (
        await prisma.quiz.create({
          data: { ...values, course_id: course.id, position: (last._max.position ?? -1) + 1 },
          select: { id: true },
        })
      ).id
    }
    await auditService.logForContext(ctx, {
      action: data.quizId ? AUDIT_ACTIONS.QUIZ_UPDATED : AUDIT_ACTIONS.QUIZ_CREATED,
      resourceType: 'quiz',
      resourceId: id,
      metadata: { courseId: course.id, title: data.title, passingScore: data.passingScore, attemptLimit: data.attemptLimit },
    })
    return { id }
  },

  async setQuizStatus(ctx: RequestContext, input: unknown) {
    const data = parseInput(z.strictObject({ quizId: z.uuid(), action: z.enum(['PUBLISH', 'DRAFT']) }), input)
    const quiz = await authoredQuiz(ctx, data.quizId)
    if (data.action === 'PUBLISH' && !quiz._count.questions) throw new ValidationError('Add at least one question first')
    await prisma.quiz.update({ where: { id: quiz.id }, data: { status: data.action === 'PUBLISH' ? 'PUBLISHED' : 'DRAFT' } })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.QUIZ_UPDATED,
      resourceType: 'quiz',
      resourceId: quiz.id,
      metadata: { before: quiz.status, after: data.action === 'PUBLISH' ? 'PUBLISHED' : 'DRAFT' },
    })
  },

  async deleteQuiz(ctx: RequestContext, quizId: string) {
    const quiz = await authoredQuiz(ctx, quizId)
    if (quiz._count.attempts) throw new ConflictError('This quiz has attempts — set it to draft instead of deleting it')
    await prisma.quiz.delete({ where: { id: quiz.id } })
  },

  /**
   * Questions can be edited until someone attempts the quiz; after that the
   * stored attempts would no longer match, so the quiz is locked (make a new one).
   */
  async saveQuestion(ctx: RequestContext, input: unknown) {
    const data = parseInput(questionSchema, input)
    const quiz = await authoredQuiz(ctx, data.quizId)
    if (quiz._count.attempts) throw new ConflictError('People have attempted this quiz — its questions are locked')
    const options =
      data.type === 'TRUE_FALSE'
        ? ['True', 'False'].map((text, i) => ({ text, correct: data.correctOptions.includes(i) }))
        : data.type === 'SHORT_ANSWER'
          ? []
          : data.options.map((text, i) => ({ text, correct: data.correctOptions.includes(i) })).filter((o) => o.text)
    const problem = validateQuestionShape({ type: data.type, options, acceptedAnswers: data.acceptedAnswers })
    if (problem) throw new ValidationError(problem, { options: problem })
    const values = {
      question: data.question,
      question_type: data.type as QuizQuestionType,
      points: data.points,
      explanation: data.explanation ?? null,
      accepted_answers: data.type === 'SHORT_ANSWER' ? data.acceptedAnswers.filter(Boolean) : [],
    }
    await prisma.$transaction(async (tx) => {
      let questionId = data.questionId
      if (questionId) {
        const { count } = await tx.quizQuestion.updateMany({ where: { id: questionId, quiz_id: quiz.id }, data: values })
        if (!count) throw new NotFoundError('Question')
        await tx.quizOption.deleteMany({ where: { question_id: questionId } })
      } else {
        const last = await tx.quizQuestion.aggregate({ where: { quiz_id: quiz.id }, _max: { position: true } })
        questionId = (
          await tx.quizQuestion.create({
            data: { ...values, quiz_id: quiz.id, position: (last._max.position ?? -1) + 1 },
            select: { id: true },
          })
        ).id
      }
      if (options.length) {
        await tx.quizOption.createMany({
          data: options.map((o, i) => ({ question_id: questionId!, option_text: o.text, is_correct: o.correct, position: i })),
        })
      }
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.QUIZ_UPDATED,
      resourceType: 'quiz',
      resourceId: quiz.id,
      metadata: { question: data.questionId ? 'updated' : 'added', type: data.type, points: data.points },
    })
  },

  async deleteQuestion(ctx: RequestContext, questionId: string) {
    const question = await prisma.quizQuestion.findFirst({
      where: { id: parseInput(z.uuid(), questionId), quiz: { course: { organization_id: ctx.organization.id } } },
      select: { id: true, quiz_id: true },
    })
    if (!question) throw new NotFoundError('Question')
    const quiz = await authoredQuiz(ctx, question.quiz_id)
    if (quiz._count.attempts) throw new ConflictError('People have attempted this quiz — its questions are locked')
    await prisma.quizQuestion.delete({ where: { id: question.id } })
  },

  // ── Assignments ───────────────────────────────────────────────────────────
  async saveAssignment(ctx: RequestContext, input: unknown) {
    const data = parseInput(assignmentSchema, input)
    const course = await authoredCourse(ctx, data.courseId)
    if (data.maxPoints && !data.rubric) {
      throw new ValidationError('Points need a rubric explaining how they are awarded', { rubric: 'Required with points' })
    }
    if (data.moduleId) {
      const ok = await prisma.courseModule.count({ where: { id: data.moduleId, course_id: course.id } })
      if (!ok) throw new ValidationError('Choose a module of this course', { moduleId: 'Unknown module' })
    }
    const values = {
      module_id: data.moduleId ?? null,
      title: data.title,
      description: data.description ?? null,
      instructions: data.instructions ?? null,
      due_days: data.dueDays,
      max_points: data.maxPoints,
      rubric: data.rubric ?? null,
      is_required: data.isRequired,
    }
    if (data.assignmentId) {
      const { count } = await prisma.learningAssignment.updateMany({
        where: { id: data.assignmentId, course_id: course.id },
        data: values,
      })
      if (!count) throw new NotFoundError('Assignment')
    } else {
      const last = await prisma.learningAssignment.aggregate({ where: { course_id: course.id }, _max: { position: true } })
      await prisma.learningAssignment.create({
        data: { ...values, course_id: course.id, position: (last._max.position ?? -1) + 1 },
      })
    }
    await touchCourse(ctx, course.id, { assignment: data.title })
  },

  async deleteAssignment(ctx: RequestContext, assignmentId: string) {
    const assignment = await prisma.learningAssignment.findFirst({
      where: { id: parseInput(z.uuid(), assignmentId), course: { organization_id: ctx.organization.id } },
      select: { id: true, course_id: true, _count: { select: { submissions: true } } },
    })
    if (!assignment) throw new NotFoundError('Assignment')
    await authoredCourse(ctx, assignment.course_id)
    if (assignment._count.submissions) {
      throw new ConflictError('People have submitted work — make the assignment optional instead of deleting it')
    }
    await prisma.learningAssignment.delete({ where: { id: assignment.id } })
  },
}

function courseValues(data: z.infer<typeof courseSchema>) {
  return {
    title: data.title,
    description: data.description ?? null,
    category_id: data.categoryId ?? null,
    difficulty: data.difficulty as CourseDifficulty,
    estimated_minutes: data.estimatedMinutes,
    is_required: data.isRequired,
    is_sequential: data.isSequential,
    require_quizzes: data.requireQuizzes,
    require_assignments: data.requireAssignments,
  }
}

async function assertCategory(ctx: RequestContext, categoryId: string | undefined) {
  if (!categoryId) return
  const ok = await prisma.courseCategory.count({ where: { id: categoryId, organization_id: ctx.organization.id } })
  if (!ok) throw new ValidationError('Choose a category', { categoryId: 'Unknown category' })
}

async function authoredQuiz(ctx: RequestContext, quizId: string) {
  const quiz = await prisma.quiz.findFirst({
    where: { id: parseInput(z.uuid(), quizId), course: { organization_id: ctx.organization.id, deleted_at: null } },
    select: {
      id: true,
      course_id: true,
      status: true,
      _count: { select: { questions: true, attempts: true } },
    },
  })
  if (!quiz) throw new NotFoundError('Quiz')
  await authoredCourse(ctx, quiz.course_id)
  return quiz
}

/** Records that a course's content changed (audited with what changed). */
async function touchCourse(ctx: RequestContext, courseId: string, change: Record<string, unknown>) {
  await prisma.course.update({ where: { id: courseId }, data: { updated_by: ctx.actor.userId } })
  await auditService.logForContext(ctx, {
    action: AUDIT_ACTIONS.COURSE_UPDATED,
    resourceType: 'course',
    resourceId: courseId,
    metadata: { change },
  })
}

/** Swaps an item with its neighbour and rewrites positions 0..n-1. */
async function reorder(
  siblings: { id: string }[],
  id: string,
  direction: 'up' | 'down',
  write: (id: string, position: number) => Promise<unknown>,
) {
  const ids = siblings.map((s) => s.id)
  const index = ids.indexOf(id)
  const target = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || target < 0 || target >= ids.length) return
  ;[ids[index], ids[target]] = [ids[target], ids[index]]
  // Positions are rewritten in order; a concurrent reorder at worst leaves a stale order, never lost rows.
  for (const [position, itemId] of ids.entries()) await write(itemId, position)
}

export type CourseBuilder = Awaited<ReturnType<typeof learningCatalogService.builder>>
export type CatalogPage = Awaited<ReturnType<typeof learningCatalogService.catalog>>
