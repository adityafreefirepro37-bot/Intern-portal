import type { TaskStatus } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, ForbiddenError, ValidationError } from '@/lib/errors'
import { getStorageService, type StoredFile } from '@/lib/storage'
import { OPEN_PROJECT_STATUSES } from '@/lib/work/projects'
import { canReview, nextSubmission } from '@/lib/work/submissions'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { afterTransition, writeTransition } from './task-lifecycle.service'
import { resolveTaskAccess } from './work-access'

export interface UploadFile {
  name: string
  type: string
  bytes: Uint8Array
}

export const MAX_SUBMISSION_FILES = 5

const submitSchema = z.strictObject({
  taskId: z.uuid(),
  message: z.string().trim().min(1, 'Describe what you’re submitting').max(5000),
})

const reviewSchema = z
  .strictObject({
    taskId: z.uuid(),
    decision: z.enum(['APPROVE', 'REQUEST_CHANGES']),
    comment: z
      .string()
      .trim()
      .max(5000)
      .optional()
      .transform((value) => value || undefined),
  })
  .refine((value) => value.decision === 'APPROVE' || value.comment, {
    message: 'Explain what needs to change',
    path: ['comment'],
  })

const SUBMITTABLE: TaskStatus[] = ['IN_PROGRESS', 'CHANGES_REQUESTED']

async function latestSubmission(taskId: string) {
  return prisma.taskSubmission.findFirst({
    where: { task_id: taskId },
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      status: true,
      submitted_by: true,
      versions: {
        orderBy: { version_number: 'desc' },
        take: 1,
        select: { id: true, version_number: true, created_by: true },
      },
    },
  })
}

/**
 * Submission and review workflow. Interns never mark their own work
 * complete: they submit it (task → IN_REVIEW), and a reviewer approves it
 * (→ COMPLETED) or requests changes (→ CHANGES_REQUESTED). Each submit or
 * resubmit is a new immutable version with its own files; reviews are
 * recorded on the version they judged.
 */
export const taskSubmissionService = {
  async submit(ctx: RequestContext, input: unknown, files: UploadFile[] = []) {
    const data = parseInput(submitSchema, input)
    const access = await resolveTaskAccess(ctx, data.taskId)
    const { task } = access
    if (!access.can.submit) throw new ForbiddenError('Only people assigned to this task can submit work')
    if (!SUBMITTABLE.includes(task.status)) {
      throw new ValidationError('Start the task before submitting it for review')
    }
    if (task.project && !OPEN_PROJECT_STATUSES.includes(task.project.status)) {
      throw new ValidationError('This project is closed')
    }
    const real = files.filter((file) => file.bytes.byteLength > 0)
    if (real.length > MAX_SUBMISSION_FILES) {
      throw new ValidationError(`Attach at most ${MAX_SUBMISSION_FILES} files`, { files: 'Too many files' })
    }

    const latest = await latestSubmission(task.id)
    const outcome = nextSubmission(latest?.status ?? null)
    if (!outcome.ok) throw new ConflictError(outcome.reason)

    // Store files first (validated by the storage service); remove them again if the transaction fails.
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
    let result: { submissionId: string; version: number }
    try {
      result = await prisma.$transaction(async (tx) => {
        let submissionId = latest?.id
        const version = (latest?.versions[0]?.version_number ?? 0) + 1
        if (!submissionId) {
          const created = await tx.taskSubmission.create({
            data: {
              task_id: task.id,
              submitted_by: ctx.actor.userId,
              status: outcome.status,
              description: data.message,
              submitted_at: now,
            },
            select: { id: true },
          })
          submissionId = created.id
        } else {
          await tx.taskSubmission.update({
            where: { id: submissionId },
            data: {
              status: outcome.status,
              description: data.message,
              submitted_at: now,
              reviewed_at: null,
              reviewed_by: null,
              review_comment: null,
            },
          })
        }
        const versionRow = await tx.submissionVersion.create({
          data: {
            submission_id: submissionId,
            version_number: version,
            description: data.message,
            status: outcome.status,
            submitted_at: now,
            created_by: ctx.actor.userId,
          },
          select: { id: true },
        })
        if (stored.length > 0) {
          await tx.taskAttachment.createMany({
            data: stored.map((file) => ({
              task_id: task.id,
              uploaded_by: ctx.actor.userId,
              file_name: file.fileName,
              storage_path: file.storagePath,
              mime_type: file.mimeType,
              file_size: file.fileSize,
              submission_version_id: versionRow.id,
            })),
          })
        }
        await writeTransition(tx, task, 'IN_REVIEW', ctx.actor.userId)
        return { submissionId, version }
      })
    } catch (error) {
      await Promise.all(stored.map((s) => storage.delete(s.storagePath).catch(() => undefined)))
      throw error
    }

    await afterTransition(ctx, task, task.status, 'IN_REVIEW', { via: 'submission' })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.TASK_SUBMITTED,
      resourceType: 'task',
      resourceId: task.id,
      metadata: { projectId: task.project_id, version: result.version, files: stored.length, title: task.title },
    })
    await domainEvents.emit('task.submitted', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: {
        taskId: task.id,
        projectId: task.project_id,
        submissionId: result.submissionId,
        version: result.version,
        resubmission: outcome.status === 'RESUBMITTED',
      },
    })
    return result
  },

  async review(ctx: RequestContext, input: unknown) {
    const data = parseInput(reviewSchema, input)
    const access = await resolveTaskAccess(ctx, data.taskId)
    const { task } = access
    if (!access.can.review) throw new ForbiddenError('You can’t review this task')
    const latest = await latestSubmission(task.id)
    const version = latest?.versions[0]
    if (!latest || !version || !canReview(latest.status) || task.status !== 'IN_REVIEW') {
      throw new ConflictError('There’s no submission waiting for review')
    }
    // Nobody reviews their own work, whatever their permissions.
    if (version.created_by === ctx.actor.userId || latest.submitted_by === ctx.actor.userId) {
      throw new ForbiddenError('You can’t review your own submission')
    }
    const approve = data.decision === 'APPROVE'
    if (approve) {
      const openSubtasks = await prisma.task.count({
        where: { parent_task_id: task.id, deleted_at: null, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      })
      if (openSubtasks > 0) throw new ValidationError('Finish or cancel the subtasks before approving')
    }
    const status = approve ? 'APPROVED' : 'CHANGES_REQUESTED'
    const to: TaskStatus = approve ? 'COMPLETED' : 'CHANGES_REQUESTED'
    const now = new Date()

    await prisma.$transaction(async (tx) => {
      const updated = await tx.submissionVersion.updateMany({
        where: { id: version.id, reviewed_at: null },
        data: { status, reviewed_by: ctx.actor.userId, reviewed_at: now, review_comment: data.comment ?? null },
      })
      if (updated.count === 0) throw new ConflictError('This version was already reviewed')
      await tx.taskSubmission.update({
        where: { id: latest.id },
        data: { status, reviewed_by: ctx.actor.userId, reviewed_at: now, review_comment: data.comment ?? null },
      })
      await writeTransition(tx, task, to, ctx.actor.userId)
    })

    await afterTransition(ctx, task, 'IN_REVIEW', to, { via: 'review' })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.TASK_REVIEWED,
      resourceType: 'task',
      resourceId: task.id,
      metadata: { projectId: task.project_id, version: version.version_number, decision: status, title: task.title },
    })
    await domainEvents.emit('task.reviewed', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: {
        taskId: task.id,
        projectId: task.project_id,
        submissionId: latest.id,
        version: version.version_number,
        decision: status,
        submitterId: version.created_by ?? latest.submitted_by,
      },
    })
    return { decision: status, version: version.version_number }
  },
}

/** Alias matching the architecture's naming (review lives with submissions). */
export const taskReviewService = { review: taskSubmissionService.review }
