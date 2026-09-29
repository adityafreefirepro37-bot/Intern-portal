import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { logger } from '@/lib/logging'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { authorizationService } from './authorization.service'

/**
 * In-app notifications (the `notifications` table from Phase 01). Created by
 * domain-event subscribers (src/server/events/subscribers.ts); Phase 06 adds
 * email/push delivery and preferences on top of the same records.
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
} as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES]

export interface NotificationInput {
  type: NotificationType
  title: string
  body?: string
  entityType: 'task' | 'project'
  entityId: string
}

/** Where a notification's entity lives in the app. */
export function notificationHref(entityType: string | null, entityId: string | null): string | null {
  if (!entityId) return null
  if (entityType === 'task') return `/tasks/${entityId}`
  if (entityType === 'project') return `/projects/${entityId}`
  return null
}

export const notificationService = {
  /**
   * Creates one notification per recipient (deduplicated; the actor is never
   * notified about their own action). Recipients must be active members of the
   * organization. Failures are logged and never break the calling operation.
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
      const { count } = await prisma.notification.createMany({
        data: active.map(({ id }) => ({
          organization_id: organizationId,
          user_id: id,
          type: input.type,
          title: input.title.slice(0, 200),
          body: input.body?.slice(0, 500) ?? null,
          related_entity_type: input.entityType,
          related_entity_id: input.entityId,
        })),
      })
      return count
    } catch (error) {
      logger.error('Failed to create notifications', { type: input.type, error })
      return 0
    }
  },

  async listRecent(ctx: RequestContext, take = 8) {
    if (!authorizationService.can(ctx, 'notification.read')) return { items: [], unread: 0 }
    const where = { user_id: ctx.actor.userId, organization_id: ctx.organization.id }
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({
        where,
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
      }),
      prisma.notification.count({ where: { ...where, read_at: null } }),
    ])
    return {
      items: items.map((item) => ({
        ...item,
        href: notificationHref(item.related_entity_type, item.related_entity_id),
      })),
      unread,
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
