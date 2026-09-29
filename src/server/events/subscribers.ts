import { prisma } from '@/lib/db/client'
import { TASK_STATUS_LABELS } from '@/lib/work/tasks'
import { PROJECT_STATUS_LABELS } from '@/lib/work/projects'
import { NOTIFICATION_TYPES, notificationService } from '../services/notification.service'
import { domainEvents } from './domain-events'

/**
 * Built-in domain-event subscribers: turn work events into in-app
 * notifications. Registered once per process (lazily, on the first emit).
 * Email/push delivery (Phase 06) can subscribe to the same events.
 */

async function taskInfo(taskId: string) {
  return prisma.task.findUnique({
    where: { id: taskId },
    select: {
      title: true,
      created_by: true,
      assignees: { select: { user_id: true } },
      project: { select: { name: true, owner_id: true, manager_id: true } },
    },
  })
}

export function registerSubscribers() {
  domainEvents.on('task.assigned', async ({ organizationId, actorUserId, payload }) => {
    const task = await taskInfo(payload.taskId)
    if (!task) return
    await notificationService.notify(
      organizationId,
      payload.assigneeIds,
      {
        type: NOTIFICATION_TYPES.TASK_ASSIGNED,
        title: `You were assigned “${task.title}”`,
        body: task.project?.name,
        entityType: 'task',
        entityId: payload.taskId,
      },
      actorUserId,
    )
  })

  domainEvents.on('task.status_changed', async ({ organizationId, actorUserId, payload }) => {
    const task = await taskInfo(payload.taskId)
    if (!task) return
    const to = payload.to as keyof typeof TASK_STATUS_LABELS
    // Blockers go to whoever owns the work; closing/reopening goes to the people doing it.
    const recipients =
      to === 'BLOCKED'
        ? [task.created_by, task.project?.manager_id, task.project?.owner_id]
        : ['COMPLETED', 'CANCELLED'].includes(to) || payload.from === 'COMPLETED'
          ? task.assignees.map((a) => a.user_id)
          : []
    await notificationService.notify(
      organizationId,
      recipients,
      {
        type: NOTIFICATION_TYPES.TASK_STATUS_CHANGED,
        title: `“${task.title}” is now ${TASK_STATUS_LABELS[to] ?? to}`,
        entityType: 'task',
        entityId: payload.taskId,
      },
      actorUserId,
    )
  })

  domainEvents.on('task.comment_mention', async ({ organizationId, actorUserId, payload }) => {
    const task = await taskInfo(payload.taskId)
    if (!task) return
    await notificationService.notify(
      organizationId,
      payload.mentionedUserIds,
      {
        type: NOTIFICATION_TYPES.TASK_COMMENT_MENTION,
        title: `You were mentioned on “${task.title}”`,
        entityType: 'task',
        entityId: payload.taskId,
      },
      actorUserId,
    )
  })

  domainEvents.on('task.submitted', async ({ organizationId, actorUserId, payload }) => {
    const task = await taskInfo(payload.taskId)
    if (!task) return
    // The submitter's own manager and mentor are reviewers too.
    const guides = actorUserId
      ? await prisma.intern.findMany({
          where: { organization_id: organizationId, user_id: actorUserId },
          select: { manager_id: true, mentor_id: true },
        })
      : []
    await notificationService.notify(
      organizationId,
      [
        task.created_by,
        task.project?.manager_id,
        task.project?.owner_id,
        ...guides.flatMap((g) => [g.manager_id, g.mentor_id]),
      ],
      {
        type: NOTIFICATION_TYPES.TASK_SUBMITTED,
        title: `${payload.resubmission ? 'Resubmitted' : 'Submitted'} for review: “${task.title}”`,
        body: `Version ${payload.version}`,
        entityType: 'task',
        entityId: payload.taskId,
      },
      actorUserId,
    )
  })

  domainEvents.on('task.reviewed', async ({ organizationId, actorUserId, payload }) => {
    const task = await taskInfo(payload.taskId)
    if (!task) return
    const approved = payload.decision === 'APPROVED'
    await notificationService.notify(
      organizationId,
      [payload.submitterId],
      {
        type: approved ? NOTIFICATION_TYPES.TASK_APPROVED : NOTIFICATION_TYPES.TASK_CHANGES_REQUESTED,
        title: approved ? `Approved: “${task.title}”` : `Changes requested on “${task.title}”`,
        body: `Version ${payload.version}`,
        entityType: 'task',
        entityId: payload.taskId,
      },
      actorUserId,
    )
  })

  for (const name of ['task.due_soon', 'task.overdue'] as const) {
    domainEvents.on(name, async ({ organizationId, payload }) => {
      const task = await taskInfo(payload.taskId)
      if (!task) return
      await notificationService.notify(
        organizationId,
        task.assignees.map((a) => a.user_id),
        {
          type: name === 'task.due_soon' ? NOTIFICATION_TYPES.TASK_DUE_SOON : NOTIFICATION_TYPES.TASK_OVERDUE,
          title: name === 'task.due_soon' ? `Due tomorrow: “${task.title}”` : `Overdue: “${task.title}”`,
          entityType: 'task',
          entityId: payload.taskId,
        },
        null,
      )
    })
  }

  domainEvents.on('project.member_added', async ({ organizationId, actorUserId, payload }) => {
    const project = await prisma.project.findUnique({ where: { id: payload.projectId }, select: { name: true } })
    if (!project) return
    await notificationService.notify(
      organizationId,
      [payload.userId],
      {
        type: NOTIFICATION_TYPES.PROJECT_MEMBER_ADDED,
        title: `You were added to ${project.name}`,
        entityType: 'project',
        entityId: payload.projectId,
      },
      actorUserId,
    )
  })

  domainEvents.on('project.status_changed', async ({ organizationId, actorUserId, payload }) => {
    const project = await prisma.project.findUnique({
      where: { id: payload.projectId },
      select: { name: true, members: { select: { user_id: true } } },
    })
    if (!project) return
    const to = payload.to as keyof typeof PROJECT_STATUS_LABELS
    await notificationService.notify(
      organizationId,
      project.members.map((m) => m.user_id),
      {
        type: NOTIFICATION_TYPES.PROJECT_STATUS_CHANGED,
        title: `${project.name} is now ${PROJECT_STATUS_LABELS[to] ?? to}`,
        entityType: 'project',
        entityId: payload.projectId,
      },
      actorUserId,
    )
  })

  domainEvents.on('project.milestone_due', async ({ organizationId, payload }) => {
    const project = await prisma.project.findUnique({
      where: { id: payload.projectId },
      select: {
        name: true,
        owner_id: true,
        manager_id: true,
        members: { where: { role: { in: ['OWNER', 'MANAGER'] } }, select: { user_id: true } },
      },
    })
    const milestone = await prisma.milestone.findUnique({ where: { id: payload.milestoneId }, select: { name: true } })
    if (!project || !milestone) return
    await notificationService.notify(
      organizationId,
      [project.owner_id, project.manager_id, ...project.members.map((m) => m.user_id)],
      {
        type: NOTIFICATION_TYPES.PROJECT_MILESTONE_DUE,
        title: `Milestone due tomorrow: ${milestone.name}`,
        body: project.name,
        entityType: 'project',
        entityId: payload.projectId,
      },
      null,
    )
  })
}
