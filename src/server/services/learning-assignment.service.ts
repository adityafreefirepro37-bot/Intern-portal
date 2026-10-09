import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { addDays, todayIn } from '@/lib/interns/dates'
import { learningDeadline } from '@/lib/learning/rules'
import { getStorageService, type StoredFile } from '@/lib/storage'
import { canReview, nextSubmission, PENDING_REVIEW } from '@/lib/work/submissions'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { personSelect, requireUserInScope, scopedUsers } from './hr-shared'
import { recomputeEnrollment } from './learning-progress'
import { MAX_SUBMISSION_FILES, type UploadFile } from './task-submission.service'

/**
 * Learning assignments reuse the Prompt 04 submission rules
 * (`nextSubmission` / `canReview`): a draft, then immutable versions on each
 * submit / resubmit with their own files; a reviewer approves, requests
 * changes, and (when the assignment has a rubric) awards points. Nobody
 * reviews their own work. Approval feeds course completion.
 */

const draftSchema = z.strictObject({
  assignmentId: z.uuid(),
  text: z.string().trim().max(10000),
})

const submitSchema = z.strictObject({
  assignmentId: z.uuid(),
  message: z.string().trim().min(1, 'Describe what you’re submitting').max(10000),
})

const reviewSchema = z
  .strictObject({
    submissionId: z.uuid(),
    decision: z.enum(['APPROVE', 'REQUEST_CHANGES']),
    comment: z
      .string()
      .trim()
      .max(5000)
      .optional()
      .transform((v) => v || undefined),
    points: z.coerce.number().int().min(0).max(1000).optional(),
  })
  .refine((v) => v.decision === 'APPROVE' || v.comment, {
    message: 'Explain what needs to change',
    path: ['comment'],
  })

const assignmentSelect = {
  id: true,
  title: true,
  description: true,
  instructions: true,
  due_days: true,
  max_points: true,
  rubric: true,
  is_required: true,
  course_id: true,
  course: { select: { id: true, title: true, status: true } },
  module: { select: { id: true, title: true } },
} as const satisfies Prisma.LearningAssignmentSelect

const submissionSelect = {
  id: true,
  user_id: true,
  status: true,
  draft_text: true,
  current_version: true,
  points_awarded: true,
  reviewed_at: true,
  review_comment: true,
  updated_at: true,
  user: { select: personSelect },
  reviewer: { select: personSelect },
  versions: {
    orderBy: { version_number: 'desc' },
    select: {
      id: true,
      version_number: true,
      message: true,
      status: true,
      submitted_at: true,
      reviewed_at: true,
      review_comment: true,
      points_awarded: true,
      submitter: { select: personSelect },
      reviewer: { select: personSelect },
      files: { select: { id: true, file_name: true, mime_type: true, file_size: true } },
    },
  },
} as const satisfies Prisma.LearningAssignmentSubmissionSelect

async function findAssignment(ctx: RequestContext, assignmentId: string) {
  const assignment = await prisma.learningAssignment.findFirst({
    where: { id: parseInput(z.uuid(), assignmentId), course: { organization_id: ctx.organization.id, deleted_at: null } },
    select: assignmentSelect,
  })
  if (!assignment) throw new NotFoundError('Assignment')
  return assignment
}

async function requireEnrolled(ctx: RequestContext, courseId: string) {
  const enrollment = await prisma.courseEnrollment.findUnique({
    where: { course_id_user_id: { course_id: courseId, user_id: ctx.actor.userId } },
    select: { status: true, assigned_at: true },
  })
  if (!enrollment || enrollment.status === 'CANCELLED') throw new ValidationError('Enroll in the course first')
  return enrollment
}

export const learningAssignmentService = {
  /** The learner's view of an assignment (with their own submission history). */
  async view(ctx: RequestContext, assignmentId: string) {
    authorizationService.require(ctx, 'course.read')
    const assignment = await findAssignment(ctx, assignmentId)
    const enrollment = await prisma.courseEnrollment.findUnique({
      where: { course_id_user_id: { course_id: assignment.course_id, user_id: ctx.actor.userId } },
      select: { status: true, assigned_at: true },
    })
    const enrolled = Boolean(enrollment && enrollment.status !== 'CANCELLED')
    if (!enrolled && assignment.course.status !== 'PUBLISHED' && !authorizationService.can(ctx, 'course.update')) {
      throw new NotFoundError('Assignment')
    }
    const submission = await prisma.learningAssignmentSubmission.findUnique({
      where: { assignment_id_user_id: { assignment_id: assignment.id, user_id: ctx.actor.userId } },
      select: submissionSelect,
    })
    const dueDate = enrolled && assignment.due_days ? addDays(new Date(enrollment!.assigned_at), assignment.due_days) : null
    const today = todayIn(ctx.organization.timezone)
    const status = submission?.status ?? null
    const learner = enrolled && authorizationService.can(ctx, 'learning.track')
    return {
      assignment,
      submission,
      enrolled,
      dueDate,
      deadline: learningDeadline(dueDate, status === 'APPROVED', today),
      can: {
        draft: learner && (status === null || status === 'DRAFT' || status === 'CHANGES_REQUESTED'),
        submit: learner && nextSubmission(status).ok && status !== 'APPROVED',
      },
    }
  },

  /** Saves draft text (not visible to reviewers until submitted). */
  async saveDraft(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'learning.track')
    const data = parseInput(draftSchema, input)
    const assignment = await findAssignment(ctx, data.assignmentId)
    await requireEnrolled(ctx, assignment.course_id)
    const existing = await prisma.learningAssignmentSubmission.findUnique({
      where: { assignment_id_user_id: { assignment_id: assignment.id, user_id: ctx.actor.userId } },
      select: { id: true, status: true },
    })
    if (existing && PENDING_REVIEW.includes(existing.status)) throw new ConflictError('Your work is waiting for review')
    if (existing?.status === 'APPROVED') throw new ConflictError('This assignment is already approved')
    if (existing) {
      await prisma.learningAssignmentSubmission.update({ where: { id: existing.id }, data: { draft_text: data.text || null } })
    } else {
      await prisma.learningAssignmentSubmission.create({
        data: {
          organization_id: ctx.organization.id,
          assignment_id: assignment.id,
          user_id: ctx.actor.userId,
          status: 'DRAFT',
          draft_text: data.text || null,
        },
      })
    }
  },

  /** Submit or resubmit: a new immutable version with its own files. */
  async submit(ctx: RequestContext, input: unknown, files: UploadFile[] = []) {
    authorizationService.require(ctx, 'learning.track')
    const data = parseInput(submitSchema, input)
    const assignment = await findAssignment(ctx, data.assignmentId)
    await requireEnrolled(ctx, assignment.course_id)
    const real = files.filter((f) => f.bytes.byteLength > 0)
    if (real.length > MAX_SUBMISSION_FILES) {
      throw new ValidationError(`Attach at most ${MAX_SUBMISSION_FILES} files`, { files: 'Too many files' })
    }
    const existing = await prisma.learningAssignmentSubmission.findUnique({
      where: { assignment_id_user_id: { assignment_id: assignment.id, user_id: ctx.actor.userId } },
      select: { id: true, status: true, current_version: true },
    })
    if (existing?.status === 'APPROVED') throw new ConflictError('This assignment is already approved')
    const outcome = nextSubmission(existing?.status ?? null)
    if (!outcome.ok) throw new ConflictError(outcome.reason)

    const storage = getStorageService()
    const stored: StoredFile[] = []
    try {
      for (const file of real) {
        stored.push(
          await storage.upload({
            organizationId: ctx.organization.id,
            category: 'attachment',
            fileName: file.name,
            mimeType: file.type,
            data: file.bytes,
          }),
        )
      }
    } catch (error) {
      await Promise.all(stored.map((s) => storage.delete(s.storagePath).catch(() => undefined)))
      throw error
    }

    const now = new Date()
    const version = (existing?.current_version ?? 0) + 1
    let submissionId: string
    try {
      submissionId = await prisma.$transaction(async (tx) => {
        let id = existing?.id
        if (id) {
          // Guarded on the version we read, so two concurrent submits can't both succeed.
          const { count } = await tx.learningAssignmentSubmission.updateMany({
            where: { id, current_version: existing!.current_version, status: existing!.status },
            data: {
              status: outcome.status,
              current_version: version,
              draft_text: null,
              reviewed_at: null,
              reviewed_by: null,
              review_comment: null,
            },
          })
          if (count === 0) throw new ConflictError('This work was just submitted')
        } else {
          id = (
            await tx.learningAssignmentSubmission.create({
              data: {
                organization_id: ctx.organization.id,
                assignment_id: assignment.id,
                user_id: ctx.actor.userId,
                status: outcome.status,
                current_version: version,
              },
              select: { id: true },
            })
          ).id
        }
        await tx.learningSubmissionVersion.create({
          data: {
            submission_id: id,
            version_number: version,
            message: data.message,
            status: outcome.status,
            submitted_by: ctx.actor.userId,
            submitted_at: now,
            files: {
              create: stored.map((f) => ({
                file_name: f.fileName,
                storage_path: f.storagePath,
                mime_type: f.mimeType,
                file_size: f.fileSize,
              })),
            },
          },
        })
        return id
      })
    } catch (error) {
      await Promise.all(stored.map((s) => storage.delete(s.storagePath).catch(() => undefined)))
      throw error
    }
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.ASSIGNMENT_SUBMITTED,
      resourceType: 'learning_submission',
      resourceId: submissionId,
      metadata: { assignmentId: assignment.id, version, files: stored.length },
    })
    await domainEvents.emit('learning.assignment_submitted', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { submissionId, assignmentId: assignment.id, userId: ctx.actor.userId, version },
    })
    return { submissionId, version }
  },

  /** A submission for review (or the learner's own). Drafts are never shown to reviewers. */
  async submission(ctx: RequestContext, submissionId: string) {
    const id = parseInput(z.uuid(), submissionId)
    const row = await prisma.learningAssignmentSubmission.findFirst({
      where: { id, organization_id: ctx.organization.id },
      select: { ...submissionSelect, assignment: { select: assignmentSelect } },
    })
    if (!row) throw new NotFoundError('Submission')
    const own = row.user_id === ctx.actor.userId
    let reviewer = false
    if (!own) {
      if (row.status === 'DRAFT') throw new NotFoundError('Submission')
      const reviewScope = authorizationService.scopeOf(ctx, 'learning_assignment.review')
      if (reviewScope) {
        reviewer = await requireUserInScope(ctx, 'learning_assignment.review', row.user_id).then(
          () => true,
          () => false,
        )
      }
      if (!reviewer) await requireUserInScope(ctx, 'learning.read', row.user_id)
    }
    const { draft_text, ...rest } = row
    return {
      submission: { ...rest, draft_text: own ? draft_text : null },
      own,
      can: { review: reviewer && !own && canReview(row.status) },
    }
  },

  async review(ctx: RequestContext, input: unknown) {
    const data = parseInput(reviewSchema, input)
    const row = await prisma.learningAssignmentSubmission.findFirst({
      where: { id: data.submissionId, organization_id: ctx.organization.id },
      select: {
        id: true,
        user_id: true,
        status: true,
        current_version: true,
        assignment: { select: { id: true, course_id: true, title: true, max_points: true } },
        versions: { orderBy: { version_number: 'desc' }, take: 1, select: { id: true, version_number: true, submitted_by: true } },
      },
    })
    if (!row) throw new NotFoundError('Submission')
    await requireUserInScope(ctx, 'learning_assignment.review', row.user_id)
    const version = row.versions[0]
    if (!version || !canReview(row.status)) throw new ConflictError('There’s no submission waiting for review')
    if (row.user_id === ctx.actor.userId || version.submitted_by === ctx.actor.userId) {
      throw new ForbiddenError('You can’t review your own submission')
    }
    const approve = data.decision === 'APPROVE'
    const max = row.assignment.max_points
    if (data.points !== undefined && max === null) throw new ValidationError('This assignment isn’t scored')
    if (data.points !== undefined && max !== null && data.points > max) {
      throw new ValidationError(`Award at most ${max} points`, { points: `Maximum is ${max}` })
    }
    if (approve && max !== null && data.points === undefined) {
      throw new ValidationError('Award points using the rubric', { points: 'Required' })
    }
    const status = approve ? 'APPROVED' : 'CHANGES_REQUESTED'
    const points = approve ? (data.points ?? null) : null
    const now = new Date()
    await prisma.$transaction(async (tx) => {
      const updated = await tx.learningSubmissionVersion.updateMany({
        where: { id: version.id, reviewed_at: null },
        data: { status, reviewed_by: ctx.actor.userId, reviewed_at: now, review_comment: data.comment ?? null, points_awarded: points },
      })
      if (updated.count === 0) throw new ConflictError('This version was already reviewed')
      await tx.learningAssignmentSubmission.update({
        where: { id: row.id },
        data: { status, reviewed_by: ctx.actor.userId, reviewed_at: now, review_comment: data.comment ?? null, points_awarded: points },
      })
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.ASSIGNMENT_REVIEWED,
      resourceType: 'learning_submission',
      resourceId: row.id,
      metadata: { assignmentId: row.assignment.id, version: version.version_number, decision: status, points, userId: row.user_id },
    })
    await domainEvents.emit('learning.assignment_reviewed', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { submissionId: row.id, assignmentId: row.assignment.id, userId: row.user_id, decision: status },
    })
    if (approve) await recomputeEnrollment(ctx.organization.id, row.user_id, row.assignment.course_id, ctx.actor.userId)
    return { decision: status }
  },

  /** Work waiting for the viewer's review (within learning_assignment.review scope, never their own). */
  async queue(ctx: RequestContext, options: { includeReviewed?: boolean } = {}) {
    const where = scopedUsers(ctx, 'learning_assignment.review')
    if (!where) throw new ForbiddenError()
    return prisma.learningAssignmentSubmission.findMany({
      where: {
        organization_id: ctx.organization.id,
        user_id: { not: ctx.actor.userId },
        user: where,
        status: options.includeReviewed ? { not: 'DRAFT' } : { in: [...PENDING_REVIEW] },
      },
      orderBy: { updated_at: options.includeReviewed ? 'desc' : 'asc' },
      take: 100,
      select: {
        id: true,
        status: true,
        current_version: true,
        points_awarded: true,
        updated_at: true,
        user: { select: personSelect },
        assignment: { select: { id: true, title: true, max_points: true, course: { select: { id: true, title: true } } } },
      },
    })
  },

  async pendingCount(ctx: RequestContext) {
    const where = scopedUsers(ctx, 'learning_assignment.review')
    if (!where) return 0
    return prisma.learningAssignmentSubmission.count({
      where: {
        organization_id: ctx.organization.id,
        user_id: { not: ctx.actor.userId },
        user: where,
        status: { in: [...PENDING_REVIEW] },
      },
    })
  },

  /** A submitted file: the submitter, or someone who may see the submission. */
  async downloadFile(ctx: RequestContext, fileId: string) {
    const id = parseInput(z.uuid(), fileId)
    const file = await prisma.learningSubmissionFile.findFirst({
      where: { id, version: { submission: { organization_id: ctx.organization.id } } },
      select: { file_name: true, mime_type: true, storage_path: true, version: { select: { submission_id: true } } },
    })
    if (!file) throw new NotFoundError('File')
    await this.submission(ctx, file.version.submission_id).catch(() => {
      throw new NotFoundError('File')
    })
    const bytes = await getStorageService().download(file.storage_path)
    return { bytes, fileName: file.file_name, mimeType: file.mime_type }
  },
}

export type AssignmentView = Awaited<ReturnType<typeof learningAssignmentService.view>>
export type SubmissionDetail = Awaited<ReturnType<typeof learningAssignmentService.submission>>
export type ReviewQueueRow = Awaited<ReturnType<typeof learningAssignmentService.queue>>[number]
