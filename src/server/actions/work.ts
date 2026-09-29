'use server'

import { revalidatePath } from 'next/cache'
import { requireApiContext } from '../context'
import { milestoneService } from '../services/milestone.service'
import { notificationService } from '../services/notification.service'
import { projectLifecycleService } from '../services/project-lifecycle.service'
import { projectService } from '../services/project.service'
import { taskCollaborationService } from '../services/task-collaboration.service'
import { taskLifecycleService } from '../services/task-lifecycle.service'
import { taskSubmissionService } from '../services/task-submission.service'
import { taskService } from '../services/task.service'
import { formError, formFields, safeValues, type FormState } from './form-state'

/**
 * Projects, tasks, submissions and collaboration. The browser sends ids and
 * values only; permissions, membership, transitions and ownership are decided
 * by the services (src/server/services/work-access.ts).
 */

function fileFrom(formData: FormData, key: string) {
  const value = formData.get(key)
  return value instanceof File && value.size > 0 ? value : null
}
async function toUpload(file: File) {
  return { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }
}

function refreshWork() {
  revalidatePath('/tasks', 'layout')
  revalidatePath('/projects', 'layout')
  revalidatePath('/my-work')
  revalidatePath('/')
}

async function run<T = undefined>(
  formData: FormData,
  operation: (fields: Record<string, string>) => Promise<{ message: string; data?: T }>,
): Promise<FormState<T>> {
  const fields = formFields(formData)
  try {
    const { message, data } = await operation(fields)
    refreshWork()
    return { status: 'success', message, data }
  } catch (error) {
    return formError(error, safeValues(fields))
  }
}

// ── Projects ────────────────────────────────────────────────────────────────

export async function createProjectAction(
  _previous: FormState<{ id: string }>,
  formData: FormData,
): Promise<FormState<{ id: string }>> {
  return run(formData, async (fields) => {
    const ctx = await requireApiContext()
    const project = await projectService.create(ctx, fields)
    return { message: 'Project created.', data: { id: project.id } }
  })
}

export async function updateProjectAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ projectId, ...fields }) => {
    const ctx = await requireApiContext()
    await projectService.update(ctx, projectId ?? '', fields)
    return { message: 'Project saved.' }
  })
}

export async function projectStatusAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    const ctx = await requireApiContext()
    const { to } = await projectLifecycleService.transitionStatus(ctx, fields)
    return { message: `Project moved to ${to.replace('_', ' ').toLowerCase()}.` }
  })
}

export async function setProjectMemberAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    const ctx = await requireApiContext()
    const { changed } = await projectService.setMember(ctx, fields)
    return { message: changed ? 'Member saved.' : 'No change.' }
  })
}

export async function removeProjectMemberAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    const ctx = await requireApiContext()
    await projectService.removeMember(ctx, fields)
    return { message: 'Member removed.' }
  })
}

export async function uploadProjectFileAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const file = fileFrom(formData, 'file')
  return run(formData, async ({ projectId, description }) => {
    const ctx = await requireApiContext()
    await projectService.uploadFile(
      ctx,
      projectId ?? '',
      file ? await toUpload(file) : { name: '', type: '', bytes: new Uint8Array() },
      description,
    )
    return { message: 'File uploaded.' }
  })
}

export async function deleteProjectFileAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ fileId }) => {
    const ctx = await requireApiContext()
    await projectService.removeFile(ctx, fileId ?? '')
    return { message: 'File deleted.' }
  })
}

// ── Milestones ──────────────────────────────────────────────────────────────

export async function saveMilestoneAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ projectId, milestoneId, ...fields }) => {
    const ctx = await requireApiContext()
    if (milestoneId) await milestoneService.update(ctx, milestoneId, fields)
    else await milestoneService.create(ctx, projectId ?? '', fields)
    return { message: milestoneId ? 'Milestone saved.' : 'Milestone created.' }
  })
}

export async function milestoneCommandAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    const ctx = await requireApiContext()
    await milestoneService.command(ctx, fields)
    return { message: 'Milestone updated.' }
  })
}

// ── Tasks ───────────────────────────────────────────────────────────────────

function assigneeList(formData: FormData) {
  return formData.getAll('assigneeIds').filter((value): value is string => typeof value === 'string' && value !== '')
}

export async function createTaskAction(
  _previous: FormState<{ id: string }>,
  formData: FormData,
): Promise<FormState<{ id: string }>> {
  const assigneeIds = assigneeList(formData)
  return run(formData, async (fields) => {
    const ctx = await requireApiContext()
    const task = await taskService.create(ctx, { ...fields, assigneeIds })
    return { message: 'Task created.', data: { id: task.id } }
  })
}

export async function updateTaskAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ taskId, ...fields }) => {
    const ctx = await requireApiContext()
    await taskService.update(ctx, taskId ?? '', fields)
    return { message: 'Task saved.' }
  })
}

export async function setAssigneesAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const assigneeIds = assigneeList(formData)
  return run(formData, async ({ taskId }) => {
    const ctx = await requireApiContext()
    const { changed } = await taskService.setAssignees(ctx, { taskId, assigneeIds })
    return { message: changed ? 'Assignees updated.' : 'No change.' }
  })
}

/** Status changes from buttons, menus, the board (drag or keyboard) — always via taskLifecycleService. */
export async function taskStatusAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    const ctx = await requireApiContext()
    const { changed, to } = await taskLifecycleService.transitionStatus(ctx, fields)
    return { message: changed ? `Moved to ${to.replace('_', ' ').toLowerCase()}.` : 'No change.' }
  })
}

export async function deleteTaskAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ taskId }) => {
    const ctx = await requireApiContext()
    await taskService.remove(ctx, taskId ?? '')
    return { message: 'Task deleted.' }
  })
}

export async function bulkTaskAction(
  _previous: FormState<{ failed: { id: string; error?: string }[] }>,
  formData: FormData,
): Promise<FormState<{ failed: { id: string; error?: string }[] }>> {
  const taskIds = formData.getAll('taskIds').filter((v): v is string => typeof v === 'string')
  return run(formData, async ({ action, value, reason }) => {
    const ctx = await requireApiContext()
    const result = await taskService.bulk(ctx, {
      taskIds,
      action,
      value: value || undefined,
      reason: reason || undefined,
    })
    const message =
      result.failed.length === 0
        ? `Updated ${result.succeeded} task${result.succeeded === 1 ? '' : 's'}.`
        : `Updated ${result.succeeded}; ${result.failed.length} couldn’t be changed.`
    return { message, data: { failed: result.failed } }
  })
}

// ── Submissions and reviews ────────────────────────────────────────────────

export async function submitTaskAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const files = formData.getAll('files').filter((value): value is File => value instanceof File && value.size > 0)
  return run(formData, async ({ taskId, message }) => {
    const ctx = await requireApiContext()
    const uploads = await Promise.all(files.map(toUpload))
    const { version } = await taskSubmissionService.submit(ctx, { taskId, message }, uploads)
    return { message: version > 1 ? `Resubmitted (version ${version}).` : 'Submitted for review.' }
  })
}

export async function reviewTaskAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    const ctx = await requireApiContext()
    const { decision } = await taskSubmissionService.review(ctx, fields)
    return { message: decision === 'APPROVED' ? 'Approved — task completed.' : 'Changes requested.' }
  })
}

// ── Collaboration ──────────────────────────────────────────────────────────

export async function addChecklistItemAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    const ctx = await requireApiContext()
    await taskCollaborationService.addChecklistItem(ctx, fields)
    return { message: 'Item added.' }
  })
}

export async function updateChecklistItemAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    const ctx = await requireApiContext()
    await taskCollaborationService.updateChecklistItem(ctx, fields)
    return { message: 'Checklist updated.' }
  })
}

export async function addDependencyAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    const ctx = await requireApiContext()
    await taskCollaborationService.addDependency(ctx, fields)
    return { message: 'Dependency added.' }
  })
}

export async function removeDependencyAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    const ctx = await requireApiContext()
    await taskCollaborationService.removeDependency(ctx, fields)
    return { message: 'Dependency removed.' }
  })
}

export async function addCommentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    const ctx = await requireApiContext()
    await taskCollaborationService.addComment(ctx, fields)
    return { message: 'Comment posted.' }
  })
}

export async function updateCommentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    const ctx = await requireApiContext()
    await taskCollaborationService.updateComment(ctx, fields)
    return { message: fields.remove ? 'Comment deleted.' : 'Comment saved.' }
  })
}

export async function uploadTaskAttachmentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const file = fileFrom(formData, 'file')
  return run(formData, async ({ taskId }) => {
    const ctx = await requireApiContext()
    await taskCollaborationService.uploadAttachment(
      ctx,
      taskId ?? '',
      file ? await toUpload(file) : { name: '', type: '', bytes: new Uint8Array() },
    )
    return { message: 'File attached.' }
  })
}

export async function removeTaskAttachmentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ attachmentId }) => {
    const ctx = await requireApiContext()
    await taskCollaborationService.removeAttachment(ctx, attachmentId ?? '')
    return { message: 'File removed.' }
  })
}

export async function logTimeAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ taskId, hours, minutes, description }) => {
    const ctx = await requireApiContext()
    const total = Math.round((Number(hours || 0) || 0) * 60 + (Number(minutes || 0) || 0))
    await taskCollaborationService.logTime(ctx, { taskId, minutes: String(total), description })
    return { message: 'Time logged.' }
  })
}

export async function removeTimeEntryAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ entryId }) => {
    const ctx = await requireApiContext()
    await taskCollaborationService.removeTimeEntry(ctx, entryId ?? '')
    return { message: 'Time entry removed.' }
  })
}

// ── Notifications ──────────────────────────────────────────────────────────

export async function markNotificationsReadAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const fields = formFields(formData)
  try {
    const ctx = await requireApiContext()
    await notificationService.markRead(ctx, fields.notificationId || undefined)
    revalidatePath('/', 'layout')
    return { status: 'success' }
  } catch (error) {
    return formError(error)
  }
}
