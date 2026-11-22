import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { logger } from '@/lib/logging'
import type { PermissionKey } from '@/lib/permissions'
import { categoryOf } from '@/lib/notifications/categories'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { authorizationService } from './authorization.service'
import { notificationDeliveryService, preferencesFor } from './notification-delivery.service'

/**
 * In-app notifications (the `notifications` table from Phase 01). Created by
 * domain-event subscribers (src/server/events/subscribers.ts). Each person
 * chooses per category whether they arrive in the app and/or by email
 * (notification-delivery.service.ts).
 */
export const NOTIFICATION_TYPES = {
  TASK_ASSIGNED: 'TASK_ASSIGNED',
  TASK_DUE_SOON: 'TASK_DUE_SOON',
  TASK_OVERDUE: 'TASK_OVERDUE',
  TASK_STATUS_CHANGED: 'TASK_STATUS_CHANGED',
  TASK_COMMENT_MENTION: 'TASK_COMMENT_MENTION',
  TASK_SUBMITTED: 'TASK_SUBMITTED',
  TASK_REVIEWED: 'TASK_REVIEWED',
  TASK_CHANGES_REQUESTED: 'TASK_CHANGES_REQUESTED',
  TASK_APPROVED: 'TASK_APPROVED',
  PROJECT_MEMBER_ADDED: 'PROJECT_MEMBER_ADDED',
  PROJECT_MILESTONE_DUE: 'PROJECT_MILESTONE_DUE',
  PROJECT_STATUS_CHANGED: 'PROJECT_STATUS_CHANGED',
  LEAVE_REQUESTED: 'LEAVE_REQUESTED',
  LEAVE_APPROVED: 'LEAVE_APPROVED',
  LEAVE_REJECTED: 'LEAVE_REJECTED',
  LEAVE_CANCELLED: 'LEAVE_CANCELLED',
  ATTENDANCE_CORRECTION_REQUESTED: 'ATTENDANCE_CORRECTION_REQUESTED',
  ATTENDANCE_CORRECTION_APPROVED: 'ATTENDANCE_CORRECTION_APPROVED',
  ATTENDANCE_CORRECTION_REJECTED: 'ATTENDANCE_CORRECTION_REJECTED',
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  DOCUMENT_VERIFIED: 'DOCUMENT_VERIFIED',
  DOCUMENT_REJECTED: 'DOCUMENT_REJECTED',
  DOCUMENT_EXPIRING: 'DOCUMENT_EXPIRING',
  ONBOARDING_ITEM_ASSIGNED: 'ONBOARDING_ITEM_ASSIGNED',
  ONBOARDING_ITEM_OVERDUE: 'ONBOARDING_ITEM_OVERDUE',
  HR_REQUEST_CREATED: 'HR_REQUEST_CREATED',
  HR_REQUEST_UPDATED: 'HR_REQUEST_UPDATED',
  HR_REQUEST_COMMENTED: 'HR_REQUEST_COMMENTED',
  ANNOUNCEMENT_PUBLISHED: 'ANNOUNCEMENT_PUBLISHED',
  COURSE_ASSIGNED: 'COURSE_ASSIGNED',
  LEARNING_PATH_ASSIGNED: 'LEARNING_PATH_ASSIGNED',
  LEARNING_DEADLINE_APPROACHING: 'LEARNING_DEADLINE_APPROACHING',
  LEARNING_OVERDUE: 'LEARNING_OVERDUE',
  COURSE_COMPLETED: 'COURSE_COMPLETED',
  QUIZ_PASSED: 'QUIZ_PASSED',
  QUIZ_FAILED: 'QUIZ_FAILED',
  ASSIGNMENT_SUBMITTED: 'ASSIGNMENT_SUBMITTED',
  ASSIGNMENT_REVIEWED: 'ASSIGNMENT_REVIEWED',
  ASSIGNMENT_CHANGES_REQUESTED: 'ASSIGNMENT_CHANGES_REQUESTED',
  CHECKIN_OPEN: 'CHECKIN_OPEN',
  CHECKIN_DUE: 'CHECKIN_DUE',
  CHECKIN_REVIEWED: 'CHECKIN_REVIEWED',
  FEEDBACK_RECEIVED: 'FEEDBACK_RECEIVED',
  FEEDBACK_REQUESTED: 'FEEDBACK_REQUESTED',
  GOAL_ASSIGNED: 'GOAL_ASSIGNED',
  GOAL_DEADLINE_APPROACHING: 'GOAL_DEADLINE_APPROACHING',
  REVIEW_OPENED: 'REVIEW_OPENED',
  SELF_REVIEW_DUE: 'SELF_REVIEW_DUE',
  MANAGER_REVIEW_DUE: 'MANAGER_REVIEW_DUE',
  MENTOR_REVIEW_DUE: 'MENTOR_REVIEW_DUE',
  HR_REVIEW_DUE: 'HR_REVIEW_DUE',
  REVIEW_COMPLETED: 'REVIEW_COMPLETED',
  REVIEW_OVERDUE: 'REVIEW_OVERDUE',
  DEVELOPMENT_PLAN_CREATED: 'DEVELOPMENT_PLAN_CREATED',
  MEETING_INVITED: 'MEETING_INVITED',
  MEETING_UPDATED: 'MEETING_UPDATED',
  MEETING_CANCELLED: 'MEETING_CANCELLED',
  MEETING_RESPONSE: 'MEETING_RESPONSE',
  MESSAGE_MENTION: 'MESSAGE_MENTION',
  DIRECT_MESSAGE: 'DIRECT_MESSAGE',
  CHANNEL_ADDED: 'CHANNEL_ADDED',
  CERTIFICATE_ISSUED: 'CERTIFICATE_ISSUED',
  CERTIFICATE_REVOKED: 'CERTIFICATE_REVOKED',
  ASSESSMENT_APPROVAL_NEEDED: 'ASSESSMENT_APPROVAL_NEEDED',
  ASSESSMENT_READY: 'ASSESSMENT_READY',
  ASSESSMENT_SUBMITTED: 'ASSESSMENT_SUBMITTED',
  ASSESSMENT_GRADED: 'ASSESSMENT_GRADED',
  LEAD_ASSIGNED: 'LEAD_ASSIGNED',
  LEAD_AUDIT_VIEWED: 'LEAD_AUDIT_VIEWED',
  LEAD_TEAM: 'LEAD_TEAM',
  LEAD_REPLIED: 'LEAD_REPLIED',
  OUTREACH_APPROVAL_NEEDED: 'OUTREACH_APPROVAL_NEEDED',
} as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES]

export interface NotificationInput {
  type: NotificationType
  title: string
  body?: string
  entityType: NotificationEntity
  entityId: string | null
}

export type NotificationEntity =
  | 'task'
  | 'project'
  | 'leave'
  | 'attendance_correction'
  | 'document'
  | 'intern_onboarding'
  | 'hr_request'
  | 'announcement'
  | 'course'
  | 'learning_plan'
  | 'learning_submission'
  | 'quiz_attempt'
  | 'goal'
  | 'checkin'
  | 'feedback'
  | 'feedback_request'
  | 'review'
  | 'development_plan'
  | 'meeting'
  | 'channel'
  | 'certificate'
  | 'assessment'
  | 'lead'
  | 'outreach'

/** Where a notification's entity lives in the app. */
export function notificationHref(entityType: string | null, entityId: string | null): string | null {
  if (entityType === 'outreach') return '/growth/outreach'
  if (!entityId) return null
  if (entityType === 'task') return `/tasks/${entityId}`
  if (entityType === 'project') return `/projects/${entityId}`
  if (entityType === 'hr_request') return `/requests/${entityId}`
  if (entityType === 'announcement') return `/announcements?highlight=${entityId}`
  if (entityType === 'intern_onboarding') return `/interns/${entityId}/onboarding`
  // Leave, corrections and documents open the page that lists them for the viewer.
  if (entityType === 'leave') return `/leave?highlight=${entityId}`
  if (entityType === 'attendance_correction') return `/attendance?highlight=${entityId}`
  if (entityType === 'document') return `/documents?highlight=${entityId}`
  if (entityType === 'course') return `/learning/courses/${entityId}`
  if (entityType === 'learning_plan') return `/learning?view=paths&highlight=${entityId}`
  if (entityType === 'learning_submission') return `/learning/reviews/${entityId}`
  if (entityType === 'quiz_attempt') return `/learning/quizzes/attempts/${entityId}`
  if (entityType === 'goal') return `/performance/goals/${entityId}`
  if (entityType === 'checkin') return `/performance/checkins/${entityId}`
  if (entityType === 'feedback') return `/performance/feedback?highlight=${entityId}`
  if (entityType === 'feedback_request') return `/performance/feedback?view=requests&highlight=${entityId}`
  if (entityType === 'review') return `/performance/reviews/${entityId}`
  if (entityType === 'development_plan') return `/performance/development/${entityId}`
  if (entityType === 'meeting') return `/calendar/meetings/${entityId}`
  if (entityType === 'channel') return `/messages/${entityId}`
  if (entityType === 'certificate') return `/certificates/${entityId}`
  if (entityType === 'assessment') return `/assessments/${entityId}`
  if (entityType === 'lead') return `/growth/leads/${entityId}`
  return null
}

/**
 * Active users holding `permission` organization-wide — e.g. the people who
 * handle HR queues. Derived from grants (data), never from role names.
 */
export async function usersWithPermission(organizationId: string, permission: PermissionKey): Promise<string[]> {
  const [resource, action] = permission.split('.')
  const rows = await prisma.userRole.findMany({
    where: {
      user: { organization_id: organizationId, status: 'ACTIVE', deleted_at: null },
      role: {
        organization_id: organizationId,
        role_permissions: { some: { scope: 'ORGANIZATION', permission: { resource, action } } },
      },
    },
    select: { user_id: true },
  })
  return [...new Set(rows.map((row) => row.user_id))]
}

export const notificationService = {
  /**
   * Creates one notification per recipient (deduplicated; the actor is never
   * notified about their own action). Recipients must be active members of the
   * organization. Each recipient's preference for the type's category decides
   * whether it shows in the app (a muted one is stored already read, so it
   * stays in history without a badge) and whether an email copy is queued.
   * Failures are logged and never break the calling operation.
   */
  async notify(
    organizationId: string,
    recipientIds: (string | null | undefined)[],
    input: NotificationInput,
    actorUserId: string | null,
  ) {
    const ids = [...new Set(recipientIds.filter((id): id is string => Boolean(id) && id !== actorUserId))]
    if (ids.length === 0) return 0
    try {
      const active = await prisma.user.findMany({
        where: { id: { in: ids }, organization_id: organizationId, status: 'ACTIVE', deleted_at: null },
        select: { id: true },
      })
      if (active.length === 0) return 0
      const preferences = await preferencesFor(
        active.map(({ id }) => id),
        categoryOf(input.type),
      )
      const recipients = active.filter(({ id }) => {
        const p = preferences.get(id)!
        return p.inApp || p.email
      })
      if (recipients.length === 0) return 0
      const now = new Date()
      const created = await prisma.notification.createManyAndReturn({
        data: recipients.map(({ id }) => ({
          organization_id: organizationId,
          user_id: id,
          type: input.type,
          title: input.title.slice(0, 200),
          body: input.body?.slice(0, 500) ?? null,
          related_entity_type: input.entityType,
          related_entity_id: input.entityId,
          read_at: preferences.get(id)!.inApp ? null : now,
        })),
        select: { id: true, user_id: true },
      })
      await notificationDeliveryService.queueEmail(
        organizationId,
        created.filter((n) => preferences.get(n.user_id)!.email),
      )
      return created.length
    } catch (error) {
      logger.error('Failed to create notifications', { type: input.type, error })
      return 0
    }
  },

  async listRecent(ctx: RequestContext, take = 8) {
    if (!authorizationService.can(ctx, 'notification.read')) return { items: [], unread: 0 }
    const items = await prisma.notification.findMany({
      where: { user_id: ctx.actor.userId, organization_id: ctx.organization.id },
      orderBy: { created_at: 'desc' },
      take,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        read_at: true,
        created_at: true,
        related_entity_type: true,
        related_entity_id: true,
      },
    })
    // The unread count comes with the identity query (see RequestContext.shell).
    const unread = ctx.shell.unreadNotifications
    return {
      items: items.map((item) => ({
        ...item,
        href: notificationHref(item.related_entity_type, item.related_entity_id),
      })),
      unread,
    }
  },

  /** The full notification history, newest first (50 per page). */
  async history(ctx: RequestContext, options: { unreadOnly?: boolean; page?: number } = {}) {
    authorizationService.require(ctx, 'notification.read')
    const take = 50
    const page = Math.max(1, Math.min(options.page ?? 1, 200))
    const where = {
      user_id: ctx.actor.userId,
      organization_id: ctx.organization.id,
      ...(options.unreadOnly ? { read_at: null } : {}),
    }
    const rows = await prisma.notification.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * take,
      take: take + 1,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        read_at: true,
        created_at: true,
        related_entity_type: true,
        related_entity_id: true,
      },
    })
    return {
      page,
      hasMore: rows.length > take,
      items: rows.slice(0, take).map((item) => ({
        ...item,
        href: notificationHref(item.related_entity_type, item.related_entity_id),
      })),
    }
  },

  /** Marks one (or all, without an id) of the caller's own notifications read. */
  async markRead(ctx: RequestContext, notificationId?: string) {
    authorizationService.require(ctx, 'notification.read')
    const id = notificationId ? parseInput(z.uuid(), notificationId) : undefined
    const { count } = await prisma.notification.updateMany({
      where: { user_id: ctx.actor.userId, organization_id: ctx.organization.id, read_at: null, ...(id ? { id } : {}) },
      data: { read_at: new Date() },
    })
    return { count }
  },
}
