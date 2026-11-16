import { z } from 'zod'
import { config } from '@/lib/config'
import { prisma } from '@/lib/db/client'
import { logger } from '@/lib/logging'
import {
  DEFAULT_PREFERENCE,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_INFO,
  type NotificationCategory,
} from '@/lib/notifications/categories'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { emailService } from './email.service'

/**
 * Where notifications arrive (per person and category) and the email copies.
 * Email copies are queued as notification_deliveries rows by notify() and sent
 * after the response (Next.js after()), with the daily job retrying what's left.
 */

const MAX_ATTEMPTS = 3
const BATCH = 50

export interface Preference {
  category: NotificationCategory
  inApp: boolean
  email: boolean
}

/** Effective preferences for many people in one category (defaults where unset). */
export async function preferencesFor(userIds: string[], category: NotificationCategory) {
  const rows = userIds.length
    ? await prisma.notificationPreference.findMany({
        where: { user_id: { in: userIds }, category },
        select: { user_id: true, in_app: true, email: true },
      })
    : []
  const byUser = new Map(rows.map((row) => [row.user_id, row]))
  return new Map(
    userIds.map((id) => {
      const row = byUser.get(id)
      return [id, { inApp: row?.in_app ?? DEFAULT_PREFERENCE[category].inApp, email: row?.email ?? DEFAULT_PREFERENCE[category].email }]
    }),
  )
}

const bool = z.preprocess((value) => value === 'on' || value === 'true' || value === true, z.boolean())
const preferencesSchema = z.strictObject(
  Object.fromEntries(
    NOTIFICATION_CATEGORIES.flatMap((category) => [
      [`${category}.inApp`, bool],
      [`${category}.email`, bool],
    ]),
  ) as Record<string, typeof bool>,
)

/** Runs `task` after the response when inside a request; otherwise leaves it to the caller/daily job. */
async function afterResponse(task: () => Promise<unknown>) {
  try {
    const { after } = await import('next/server')
    after(task)
    return true
  } catch {
    return false
  }
}

export const notificationDeliveryService = {
  async preferences(ctx: RequestContext): Promise<{ items: (Preference & { label: string; description: string })[]; emailAvailable: boolean }> {
    authorizationService.require(ctx, 'notification.read')
    const rows = await prisma.notificationPreference.findMany({
      where: { user_id: ctx.actor.userId },
      select: { category: true, in_app: true, email: true },
    })
    const byCategory = new Map(rows.map((row) => [row.category, row]))
    return {
      emailAvailable: emailService.isConfigured(),
      items: NOTIFICATION_CATEGORIES.map((category) => {
        const row = byCategory.get(category)
        return {
          category,
          ...NOTIFICATION_CATEGORY_INFO[category],
          inApp: row?.in_app ?? DEFAULT_PREFERENCE[category].inApp,
          email: row?.email ?? DEFAULT_PREFERENCE[category].email,
        }
      }),
    }
  },

  /** Saves the whole preference grid (unchecked boxes arrive as missing fields = off). */
  async savePreferences(ctx: RequestContext, input: Record<string, unknown>) {
    authorizationService.require(ctx, 'notification.read')
    const known = Object.fromEntries(
      NOTIFICATION_CATEGORIES.flatMap((category) => [
        [`${category}.inApp`, input[`${category}.inApp`] ?? false],
        [`${category}.email`, input[`${category}.email`] ?? false],
      ]),
    )
    const data = parseInput(preferencesSchema, known) as Record<string, boolean>
    await prisma.$transaction(
      NOTIFICATION_CATEGORIES.map((category) =>
        prisma.notificationPreference.upsert({
          where: { user_id_category: { user_id: ctx.actor.userId, category } },
          update: { in_app: data[`${category}.inApp`], email: data[`${category}.email`] },
          create: {
            organization_id: ctx.organization.id,
            user_id: ctx.actor.userId,
            category,
            in_app: data[`${category}.inApp`],
            email: data[`${category}.email`],
          },
        }),
      ),
    )
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.NOTIFICATION_PREFERENCES_UPDATED,
      resourceType: 'user',
      resourceId: ctx.actor.userId,
      metadata: {
        emailOn: NOTIFICATION_CATEGORIES.filter((c) => data[`${c}.email`]),
        inAppOff: NOTIFICATION_CATEGORIES.filter((c) => !data[`${c}.inApp`]),
      },
    })
  },

  /** Queues email copies and sends them once the response has gone out. */
  async queueEmail(organizationId: string, notifications: { id: string; user_id: string }[]) {
    if (notifications.length === 0) return
    await prisma.notificationDelivery.createMany({
      data: notifications.map((n) => ({ organization_id: organizationId, notification_id: n.id, user_id: n.user_id })),
    })
    await afterResponse(() => this.flush())
  },

  /**
   * Sends pending email copies (oldest first). Without an email provider they
   * are marked SKIPPED, so the queue never grows unbounded. Safe to run concurrently:
   * each row is claimed by bumping `attempts` while still PENDING.
   */
  async flush(limit = BATCH) {
    const result = { sent: 0, failed: 0, skipped: 0 }
    const pending = await prisma.notificationDelivery.findMany({
      where: { status: 'PENDING', attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { created_at: 'asc' },
      take: limit,
      select: {
        id: true,
        attempts: true,
        notification: { select: { title: true, body: true, related_entity_type: true, related_entity_id: true } },
        user: { select: { email: true, status: true, deleted_at: true, first_name: true } },
        organization: { select: { name: true } },
      },
    })
    if (pending.length === 0) return result
    const configured = emailService.isConfigured()
    const { notificationHref } = await import('./notification.service')
    for (const row of pending) {
      const claimed = await prisma.notificationDelivery.updateMany({
        where: { id: row.id, status: 'PENDING', attempts: row.attempts },
        data: { attempts: { increment: 1 } },
      })
      if (claimed.count === 0) continue
      if (!configured || row.user.status !== 'ACTIVE' || row.user.deleted_at) {
        await prisma.notificationDelivery.update({
          where: { id: row.id },
          data: { status: 'SKIPPED', last_error: configured ? 'Recipient is not active' : 'Email is not configured' },
        })
        result.skipped++
        continue
      }
      const href = notificationHref(row.notification.related_entity_type, row.notification.related_entity_id)
      try {
        await emailService.send(
          emailService.notificationMessage({
            to: row.user.email,
            firstName: row.user.first_name,
            organizationName: row.organization.name,
            title: row.notification.title,
            body: row.notification.body,
            link: href ? new URL(href, config.app.url).toString() : config.app.url,
            settingsLink: new URL('/notifications?view=settings', config.app.url).toString(),
          }),
        )
        await prisma.notificationDelivery.update({
          where: { id: row.id },
          data: { status: 'SENT', sent_at: new Date(), last_error: null },
        })
        result.sent++
      } catch (error) {
        const finalAttempt = row.attempts + 1 >= MAX_ATTEMPTS
        await prisma.notificationDelivery.update({
          where: { id: row.id },
          data: { status: finalAttempt ? 'FAILED' : 'PENDING', last_error: 'Email could not be sent' },
        })
        logger.warn('Notification email failed', { deliveryId: row.id, finalAttempt, error })
        result.failed++
      }
    }
    return result
  },

  /** Delivery health for administrators (counts only — never message contents). */
  async stats(ctx: RequestContext) {
    authorizationService.require(ctx, 'notification.manage')
    const since = new Date(Date.now() - 7 * 86_400_000)
    const groups = await prisma.notificationDelivery.groupBy({
      by: ['status'],
      where: { organization_id: ctx.organization.id, created_at: { gte: since } },
      _count: { _all: true },
    })
    const count = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0
    return {
      configured: emailService.isConfigured(),
      sent: count('SENT'),
      pending: count('PENDING'),
      failed: count('FAILED'),
      skipped: count('SKIPPED'),
    }
  },

  /** Puts failed deliveries of the last 7 days back in the queue and sends them. */
  async retryFailed(ctx: RequestContext) {
    authorizationService.require(ctx, 'notification.manage')
    const { count } = await prisma.notificationDelivery.updateMany({
      where: {
        organization_id: ctx.organization.id,
        status: 'FAILED',
        created_at: { gte: new Date(Date.now() - 7 * 86_400_000) },
      },
      data: { status: 'PENDING', attempts: 0 },
    })
    if (count > 0) {
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.NOTIFICATION_DELIVERY_RETRIED,
        resourceType: 'organization',
        resourceId: ctx.organization.id,
        metadata: { count },
      })
      if (!(await afterResponse(() => this.flush()))) await this.flush()
    }
    return { count }
  },
}
