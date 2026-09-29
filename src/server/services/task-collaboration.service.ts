import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { getStorageService } from '@/lib/storage'
import { createsCycle } from '@/lib/work/tasks'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import type { UploadFile } from './task-submission.service'
import { resolveTaskAccess, type TaskAccess } from './work-access'

/**
 * Collaboration inside a task: checklist, dependencies, comments (threads and
 * mentions), attachments and time entries. Every operation resolves the task
 * through resolveTaskAccess first.
 */

async function audit(ctx: RequestContext, action: string, access: TaskAccess, metadata: Record<string, unknown> = {}) {
  await auditService.logForContext(ctx, {
    action,
    resourceType: 'task',
    resourceId: access.task.id,
    metadata: { projectId: access.task.project_id, title: access.task.title, ...metadata },
  })
}

function requireWork(access: TaskAccess) {
  if (!access.can.work) throw new ForbiddenError('Only the people working on this task can change it')
  if (access.task.status === 'COMPLETED' || access.task.status === 'CANCELLED') {
    throw new ValidationError('This task is closed. Reopen it to make changes.')
  }
}

/** Mention markup produced by the comment box: @[Display Name](user-uuid). */
const MENTION = /@\[([^\]]{1,80})\]\(([0-9a-f-]{36})\)/g

export function extractMentionIds(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION)].map((match) => match[2]))]
}

/** People who take part in a task and can therefore be mentioned. */
async function participantIds(access: TaskAccess) {
  const ids = new Set<string>([access.task.created_by, ...access.task.assignees.map((a) => a.user_id)])
  if (access.task.project_id) {
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: access.task.project_id },
      select: { owner_id: true, manager_id: true, members: { select: { user_id: true } } },
    })
    for (const id of [project.owner_id, project.manager_id, ...project.members.map((m) => m.user_id)]) {
      if (id) ids.add(id)
    }
  }
  return ids
}

export const taskCollaborationService = {
  // ── Checklist ────────────────────────────────────────────────────────────

  async addChecklistItem(ctx: RequestContext, input: unknown) {
    const data = parseInput(z.strictObject({ taskId: z.uuid(), title: z.string().trim().min(1).max(200) }), input)
    const access = await resolveTaskAccess(ctx, data.taskId)
    requireWork(access)
    const count = await prisma.taskChecklistItem.count({ where: { task_id: data.taskId } })
    if (count >= 50) throw new ValidationError('A checklist can have at most 50 items')
    const item = await prisma.taskChecklistItem.create({
      data: { task_id: data.taskId, title: data.title, position: count },
      select: { id: true },
    })
    await audit(ctx, AUDIT_ACTIONS.TASK_CHECKLIST_UPDATED, access, { added: data.title })
    return item
  },

  async updateChecklistItem(ctx: RequestContext, input: unknown) {
    const data = parseInput(
      z.strictObject({
        itemId: z.uuid(),
        title: z.string().trim().min(1).max(200).optional(),
        completed: z.preprocess(
          (v) => (v === undefined ? undefined : v === true || v === 'true'),
          z.boolean().optional(),
        ),
        move: z.enum(['up', 'down']).optional(),
        remove: z.preprocess((v) => v === true || v === 'true', z.boolean()).default(false),
      }),
      input,
    )
    const item = await prisma.taskChecklistItem.findUnique({
      where: { id: data.itemId },
      select: { id: true, task_id: true, title: true, is_completed: true },
    })
    if (!item) throw new NotFoundError('Checklist item')
    const access = await resolveTaskAccess(ctx, item.task_id)
    requireWork(access)

    if (data.remove) {
      await prisma.taskChecklistItem.delete({ where: { id: item.id } })
      await audit(ctx, AUDIT_ACTIONS.TASK_CHECKLIST_UPDATED, access, { removed: item.title })
      return
    }
    if (data.move) {
      const items = await prisma.taskChecklistItem.findMany({
        where: { task_id: item.task_id },
        orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
        select: { id: true },
      })
      const index = items.findIndex((i) => i.id === item.id)
      const swap = data.move === 'up' ? index - 1 : index + 1
      if (swap < 0 || swap >= items.length) return
      ;[items[index], items[swap]] = [items[swap], items[index]]
      await prisma.$transaction(
        items.map((i, position) => prisma.taskChecklistItem.update({ where: { id: i.id }, data: { position } })),
      )
      return
    }
    const completed = data.completed ?? item.is_completed
    await prisma.taskChecklistItem.update({
      where: { id: item.id },
      data: {
        title: data.title ?? item.title,
        is_completed: completed,
        completed_at: completed ? (item.is_completed ? undefined : new Date()) : null,
        completed_by: completed ? (item.is_completed ? undefined : ctx.actor.userId) : null,
      },
    })
    if (data.completed !== undefined && data.completed !== item.is_completed) {
      await audit(ctx, AUDIT_ACTIONS.TASK_CHECKLIST_UPDATED, access, {
        item: item.title,
        completed: data.completed,
      })
    }
  },

  // ── Dependencies ─────────────────────────────────────────────────────────

  async addDependency(ctx: RequestContext, input: unknown) {
    const data = parseInput(z.strictObject({ taskId: z.uuid(), dependsOnTaskId: z.uuid() }), input)
    if (data.taskId === data.dependsOnTaskId) throw new ValidationError('A task can’t depend on itself')
    const access = await resolveTaskAccess(ctx, data.taskId)
    if (!access.can.manageDependencies) throw new ForbiddenError('You can’t change this task’s dependencies')
    // The other task must be visible to the actor and in the same project.
    const other = await resolveTaskAccess(ctx, data.dependsOnTaskId).catch(() => null)
    if (!other) throw new NotFoundError('Task')
    if (!access.task.project_id || other.task.project_id !== access.task.project_id) {
      throw new ValidationError('Dependencies must be between tasks in the same project')
    }
    const edges = await prisma.taskDependency.findMany({
      where: { task: { project_id: access.task.project_id } },
      select: { task_id: true, depends_on_task_id: true },
    })
    const graph = new Map<string, string[]>()
    for (const edge of edges) graph.set(edge.task_id, [...(graph.get(edge.task_id) ?? []), edge.depends_on_task_id])
    if (createsCycle(graph, data.taskId, data.dependsOnTaskId)) {
      throw new ValidationError('That would create a circular dependency')
    }
    try {
      await prisma.taskDependency.create({
        data: { task_id: data.taskId, depends_on_task_id: data.dependsOnTaskId, created_by: ctx.actor.userId },
      })
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictError('That dependency already exists')
      throw error
    }
    await audit(ctx, AUDIT_ACTIONS.TASK_DEPENDENCY_CHANGED, access, { added: data.dependsOnTaskId })
  },

  async removeDependency(ctx: RequestContext, input: unknown) {
    const data = parseInput(z.strictObject({ dependencyId: z.uuid() }), input)
    const dependency = await prisma.taskDependency.findUnique({ where: { id: data.dependencyId } })
    if (!dependency) throw new NotFoundError('Dependency')
    const access = await resolveTaskAccess(ctx, dependency.task_id)
    if (!access.can.manageDependencies) throw new ForbiddenError('You can’t change this task’s dependencies')
    await prisma.taskDependency.delete({ where: { id: dependency.id } })
    await audit(ctx, AUDIT_ACTIONS.TASK_DEPENDENCY_CHANGED, access, { removed: dependency.depends_on_task_id })
  },

  // ── Comments ─────────────────────────────────────────────────────────────

  async addComment(ctx: RequestContext, input: unknown) {
    const data = parseInput(
      z.strictObject({
        taskId: z.uuid(),
        body: z.string().trim().min(1, 'Write a comment').max(5000),
        parentId: z
          .string()
          .optional()
          .transform((v) => v || undefined)
          .pipe(z.uuid().optional()),
      }),
      input,
    )
    const access = await resolveTaskAccess(ctx, data.taskId)
    if (!access.can.comment) throw new ForbiddenError('You can’t comment on this task')
    if (data.parentId) {
      const parent = await prisma.taskComment.findFirst({
        where: { id: data.parentId, task_id: data.taskId, deleted_at: null },
        select: { parent_id: true },
      })
      if (!parent) throw new NotFoundError('Comment')
      if (parent.parent_id) throw new ValidationError('Reply to the original comment')
    }
    // Only people who take part in the task can be mentioned; other ids are ignored.
    const participants = await participantIds(access)
    const mentioned = extractMentionIds(data.body).filter((id) => participants.has(id) && id !== ctx.actor.userId)
    const comment = await prisma.taskComment.create({
      data: {
        task_id: data.taskId,
        user_id: ctx.actor.userId,
        parent_id: data.parentId ?? null,
        body: data.body,
        mentions: { create: mentioned.map((user_id) => ({ user_id })) },
      },
      select: { id: true },
    })
    await audit(ctx, AUDIT_ACTIONS.TASK_COMMENTED, access, { commentId: comment.id, mentions: mentioned.length })
    await domainEvents.emit('task.commented', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { taskId: data.taskId, projectId: access.task.project_id, commentId: comment.id },
    })
    if (mentioned.length) {
      await domainEvents.emit('task.comment_mention', {
        organizationId: ctx.organization.id,
        actorUserId: ctx.actor.userId,
        payload: { taskId: data.taskId, commentId: comment.id, mentionedUserIds: mentioned },
      })
    }
    return comment
  },

  /** Authors edit their own comments; authors (or org-wide task editors) delete them (soft). */
  async updateComment(ctx: RequestContext, input: unknown) {
    const data = parseInput(
      z.strictObject({
        commentId: z.uuid(),
        body: z.string().trim().min(1).max(5000).optional(),
        remove: z.preprocess((v) => v === true || v === 'true', z.boolean()).default(false),
      }),
      input,
    )
    const comment = await prisma.taskComment.findFirst({
      where: { id: data.commentId, deleted_at: null },
      select: { id: true, task_id: true, user_id: true },
    })
    if (!comment) throw new NotFoundError('Comment')
    const access = await resolveTaskAccess(ctx, comment.task_id)
    const own = comment.user_id === ctx.actor.userId
    if (data.remove) {
      const moderator = ctx.actor.permissions.get('task.update') === 'ORGANIZATION'
      if (!own && !moderator) throw new ForbiddenError('You can only delete your own comments')
      await prisma.taskComment.update({ where: { id: comment.id }, data: { deleted_at: new Date() } })
      await audit(ctx, AUDIT_ACTIONS.TASK_COMMENTED, access, { commentId: comment.id, deleted: true })
      return
    }
    if (!own) throw new ForbiddenError('You can only edit your own comments')
    if (!data.body) throw new ValidationError('Write a comment', { body: 'Required' })
    await prisma.taskComment.update({ where: { id: comment.id }, data: { body: data.body, edited_at: new Date() } })
  },

  // ── Attachments ──────────────────────────────────────────────────────────

  async uploadAttachment(ctx: RequestContext, taskId: string, file: UploadFile) {
    const access = await resolveTaskAccess(ctx, parseInput(z.uuid(), taskId))
    requireWork(access)
    if (!file.bytes.byteLength) throw new ValidationError('Choose a file to upload', { file: 'Required' })
    const storage = getStorageService()
    const stored = await storage.upload({
      organizationId: ctx.organization.id,
      category: 'attachment',
      fileName: file.name,
      mimeType: file.type,
      data: file.bytes,
    })
    try {
      const attachment = await prisma.taskAttachment.create({
        data: {
          task_id: access.task.id,
          uploaded_by: ctx.actor.userId,
          file_name: stored.fileName,
          storage_path: stored.storagePath,
          mime_type: stored.mimeType,
          file_size: stored.fileSize,
        },
        select: { id: true },
      })
      await audit(ctx, AUDIT_ACTIONS.TASK_ATTACHMENT_ADDED, access, {
        attachmentId: attachment.id,
        size: stored.fileSize,
      })
      return attachment
    } catch (error) {
      await storage.delete(stored.storagePath).catch(() => undefined)
      throw error
    }
  },

  /** Authorized download: the viewer must be able to see the task. Hidden = 404. */
  async downloadAttachment(ctx: RequestContext, attachmentId: string) {
    const id = parseInput(z.uuid(), attachmentId)
    const attachment = await prisma.taskAttachment.findFirst({
      where: { id, deleted_at: null, task: { organization_id: ctx.organization.id } },
      select: { task_id: true, file_name: true, mime_type: true, storage_path: true },
    })
    if (!attachment) throw new NotFoundError('Attachment')
    await resolveTaskAccess(ctx, attachment.task_id).catch(() => {
      throw new NotFoundError('Attachment')
    })
    const bytes = await getStorageService().download(attachment.storage_path)
    return { bytes, fileName: attachment.file_name, mimeType: attachment.mime_type }
  },

  /** Uploaders or task leads remove files; submission files are part of history and stay. */
  async removeAttachment(ctx: RequestContext, attachmentId: string) {
    const id = parseInput(z.uuid(), attachmentId)
    const attachment = await prisma.taskAttachment.findFirst({
      where: { id, deleted_at: null },
      select: { id: true, task_id: true, uploaded_by: true, submission_version_id: true },
    })
    if (!attachment) throw new NotFoundError('Attachment')
    const access = await resolveTaskAccess(ctx, attachment.task_id)
    if (attachment.submission_version_id) throw new ValidationError('Files that were submitted for review are kept')
    if (attachment.uploaded_by !== ctx.actor.userId && !access.can.edit) {
      throw new ForbiddenError('You can only remove files you uploaded')
    }
    await prisma.taskAttachment.update({ where: { id: attachment.id }, data: { deleted_at: new Date() } })
    await audit(ctx, AUDIT_ACTIONS.TASK_ATTACHMENT_REMOVED, access, { attachmentId: attachment.id })
  },

  // ── Time entries (foundation) ────────────────────────────────────────────

  async logTime(ctx: RequestContext, input: unknown) {
    const data = parseInput(
      z.strictObject({
        taskId: z.uuid(),
        minutes: z.coerce.number().int().min(1, 'At least a minute').max(1440, 'At most 24 hours per entry'),
        description: z
          .string()
          .trim()
          .max(500)
          .optional()
          .transform((v) => v || undefined),
      }),
      input,
    )
    const access = await resolveTaskAccess(ctx, data.taskId)
    if (!access.can.logTime) throw new ForbiddenError('Only people assigned to this task can log time on it')
    await prisma.$transaction(async (tx) => {
      await tx.taskTimeEntry.create({
        data: {
          task_id: data.taskId,
          user_id: ctx.actor.userId,
          duration_minutes: data.minutes,
          description: data.description ?? null,
        },
      })
      const total = await tx.taskTimeEntry.aggregate({
        where: { task_id: data.taskId },
        _sum: { duration_minutes: true },
      })
      await tx.task.update({ where: { id: data.taskId }, data: { actual_minutes: total._sum.duration_minutes ?? 0 } })
    })
    await audit(ctx, AUDIT_ACTIONS.TASK_TIME_LOGGED, access, { minutes: data.minutes })
  },

  async removeTimeEntry(ctx: RequestContext, entryId: string) {
    const id = parseInput(z.uuid(), entryId)
    const entry = await prisma.taskTimeEntry.findUnique({
      where: { id },
      select: { id: true, task_id: true, user_id: true },
    })
    if (!entry) throw new NotFoundError('Time entry')
    await resolveTaskAccess(ctx, entry.task_id)
    if (entry.user_id !== ctx.actor.userId) throw new ForbiddenError('You can only remove your own time entries')
    await prisma.$transaction(async (tx) => {
      await tx.taskTimeEntry.delete({ where: { id: entry.id } })
      const total = await tx.taskTimeEntry.aggregate({
        where: { task_id: entry.task_id },
        _sum: { duration_minutes: true },
      })
      await tx.task.update({
        where: { id: entry.task_id },
        data: { actual_minutes: total._sum.duration_minutes ?? null },
      })
    })
  },
}
