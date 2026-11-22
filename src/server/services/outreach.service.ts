import 'server-only'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import { mailboxDailyLimit } from '@/lib/leads/outreach'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { growthSettings, growthSettingsSchema } from '../leads/settings'
import { approvalsLeft, readiness, stopSequence, unsubscribeLead, unsubscribeUrl } from '../outreach/engine'
import { configuredMailboxes, outreachMailer } from '../outreach/mailer'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'

/**
 * Growth outreach for admins: readiness, mailboxes, the approval queue for the
 * first emails, the sent log and replies. Sending itself runs in the worker
 * (src/server/outreach/engine.ts). Admins only (lead.manage, organization scope).
 */

function requireManager(ctx: RequestContext) {
  authorizationService.require(ctx, 'lead.manage')
  if (authorizationService.scopeOf(ctx, 'lead.manage') !== 'ORGANIZATION') throw new NotFoundError('Outreach')
}

const outreachSettingsSchema = growthSettingsSchema
  .pick({
    outreachEnabled: true,
    senderName: true,
    companyName: true,
    companyWebsite: true,
    postalAddress: true,
    sendDays: true,
    sendFromHour: true,
    sendUntilHour: true,
    mailboxDailyMax: true,
    followUpGapDays: true,
    approvalsRequired: true,
  })
  .refine((s) => s.sendUntilHour > s.sendFromHour, { message: 'The sending window must end after it starts', path: ['sendUntilHour'] })

const approveSchema = z.object({
  messageId: z.uuid(),
  subject: z.string().trim().min(3).max(120).optional(),
  body: z.string().trim().min(50).max(5000).optional(),
})

function indiaDayStart(now: Date) {
  const india = new Date(now.getTime() + 5.5 * 3_600_000)
  return new Date(Date.UTC(india.getUTCFullYear(), india.getUTCMonth(), india.getUTCDate()) - 5.5 * 3_600_000)
}

export const outreachService = {
  async overview(ctx: RequestContext) {
    requireManager(ctx)
    const org = ctx.organization.id
    const settings = await growthSettings.get(org)
    const now = new Date()
    const [ready, states, statusCounts, queue, sent, replies, left, scheduled] = await Promise.all([
      readiness(settings),
      prisma.outreachMailbox.findMany({ where: { organization_id: org } }),
      prisma.lead.groupBy({ by: ['outreach_status'], where: { organization_id: org }, _count: { _all: true } }),
      prisma.outreachMessage.findMany({
        where: { organization_id: org, status: 'AWAITING_APPROVAL' },
        orderBy: { created_at: 'asc' },
        take: 50,
        include: { lead: { select: { id: true, name: true, city: true, tier: true } } },
      }),
      prisma.outreachMessage.findMany({
        where: { organization_id: org, status: { in: ['SENT', 'FAILED'] } },
        orderBy: { updated_at: 'desc' },
        take: 30,
        include: { lead: { select: { id: true, name: true, outreach_status: true } } },
      }),
      prisma.lead.findMany({
        where: { organization_id: org, outreach_status: { in: ['REPLIED', 'UNSUBSCRIBED', 'BOUNCED'] } },
        orderBy: { updated_at: 'desc' },
        take: 20,
        select: { id: true, name: true, outreach_status: true, outreach_replied_at: true, email: true },
      }),
      approvalsLeft(org, settings),
      prisma.outreachMessage.count({ where: { organization_id: org, status: 'SCHEDULED' } }),
    ])
    const dayStart = indiaDayStart(now)
    const byEmail = new Map(states.map((s) => [s.email, s]))
    const mailboxes = await Promise.all(
      configuredMailboxes().map(async (m) => {
        const state = byEmail.get(m.email)
        return {
          email: m.email,
          active: state?.active ?? true,
          sentToday: await prisma.outreachMessage.count({ where: { mailbox: m.email, sent_at: { gte: dayStart } } }),
          limit: mailboxDailyLimit(state?.warmup_started_at ?? null, now, settings.mailboxDailyMax),
          lastSentAt: state?.last_sent_at ?? null,
          lastInboxCheckAt: state?.last_inbox_check_at ?? null,
          lastError: state?.last_error ?? null,
        }
      }),
    )
    const domains = [...new Set(mailboxes.map((m) => m.email.split('@')[1]!))]
    const auth = await Promise.all(domains.map(async (domain) => ({ domain, ...(await outreachMailer().domainAuth(domain).catch(() => ({ spf: false, dmarc: false, dkim: null }))) })))
    return {
      settings,
      readiness: ready,
      domainAuth: auth,
      mailboxes,
      approvalsLeft: left,
      scheduled,
      counts: Object.fromEntries(statusCounts.map((c) => [c.outreach_status, c._count._all])) as Record<string, number>,
      queue: queue.map((m) => ({ id: m.id, lead: m.lead, to: m.to_email, subject: m.subject, body: m.body, createdAt: m.created_at })),
      sent: sent.map((m) => ({ id: m.id, lead: m.lead, step: m.step, subject: m.subject, mailbox: m.mailbox, sentAt: m.sent_at, status: m.status, error: m.error })),
      replies,
    }
  },

  async saveSettings(ctx: RequestContext, input: unknown) {
    requireManager(ctx)
    const data = parseInput(outreachSettingsSchema, input)
    const current = await growthSettings.get(ctx.organization.id)
    await growthSettings.save(ctx.organization.id, { ...current, ...data, sendDays: [...new Set(data.sendDays)].sort() })
    await auditService.logForContext(ctx, { action: AUDIT_ACTIONS.LEAD_SETTINGS_UPDATED, resourceType: 'settings', metadata: { outreachEnabled: data.outreachEnabled, mailboxDailyMax: data.mailboxDailyMax } })
    return { saved: true }
  },

  /** Approves a first email (optionally edited): it goes out in the next sending window. */
  async approve(ctx: RequestContext, input: z.input<typeof approveSchema>) {
    requireManager(ctx)
    const data = parseInput(approveSchema, input)
    const message = await prisma.outreachMessage.findFirst({
      where: { id: data.messageId, organization_id: ctx.organization.id },
      include: { lead: { select: { id: true, audit_token: true, status: true } } },
    })
    if (!message) throw new NotFoundError('Email')
    if (message.status !== 'AWAITING_APPROVAL') throw new ConflictError('This email was already handled')
    if (message.lead.status === 'DO_NOT_CONTACT') throw new ConflictError('This business asked not to be contacted')
    const body = data.body ?? message.body
    // The unsubscribe link and the audit link stay in every email.
    if (!message.lead.audit_token || !body.includes(unsubscribeUrl(message.lead.audit_token)) || !body.includes(`/audit/${message.lead.audit_token}`))
      throw new ValidationError('Keep the audit link and the unsubscribe line in the email', { body: 'Keep the audit link and the unsubscribe line' })
    await prisma.$transaction([
      prisma.outreachMessage.update({
        where: { id: message.id },
        data: { status: 'SCHEDULED', subject: data.subject ?? message.subject, body, approved_by: ctx.actor.userId, approved_at: new Date(), scheduled_for: new Date() },
      }),
      prisma.lead.update({ where: { id: message.lead_id }, data: { outreach_status: 'ACTIVE' } }),
    ])
    await auditService.logForContext(ctx, { action: AUDIT_ACTIONS.OUTREACH_APPROVED, resourceType: 'lead', resourceId: message.lead_id, metadata: { edited: Boolean(data.body || data.subject) } })
    return { approved: true }
  },

  /** Doesn't send this email and ends the lead's sequence. */
  async reject(ctx: RequestContext, messageId: string) {
    requireManager(ctx)
    const id = parseInput(z.uuid(), messageId)
    const message = await prisma.outreachMessage.findFirst({ where: { id, organization_id: ctx.organization.id } })
    if (!message) throw new NotFoundError('Email')
    if (message.status !== 'AWAITING_APPROVAL') throw new ConflictError('This email was already handled')
    await stopSequence(message.lead_id, 'STOPPED')
    await auditService.logForContext(ctx, { action: AUDIT_ACTIONS.OUTREACH_REJECTED, resourceType: 'lead', resourceId: message.lead_id })
    return { rejected: true }
  },

  /** Stops the automatic emails to one lead (e.g. the team takes over). */
  async stop(ctx: RequestContext, leadId: string) {
    requireManager(ctx)
    const id = parseInput(z.uuid(), leadId)
    const lead = await prisma.lead.findFirst({ where: { id, organization_id: ctx.organization.id }, select: { id: true, outreach_status: true } })
    if (!lead) throw new NotFoundError('Lead')
    if (!['ACTIVE', 'AWAITING_APPROVAL'].includes(lead.outreach_status)) throw new ConflictError('No automatic emails are running for this lead')
    await stopSequence(lead.id, 'STOPPED')
    await auditService.logForContext(ctx, { action: AUDIT_ACTIONS.OUTREACH_STOPPED, resourceType: 'lead', resourceId: lead.id })
    return { stopped: true }
  },
}

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,40}$/)

/** The unsubscribe link in every email (no sign-in). Works even after the audit page has closed. */
export async function unsubscribeByToken(token: string): Promise<{ ok: boolean; businessName?: string }> {
  const parsed = tokenSchema.safeParse(token)
  if (!parsed.success) return { ok: false }
  const lead = await prisma.lead.findUnique({ where: { audit_token: parsed.data }, select: { id: true, organization_id: true, email: true, name: true, outreach_status: true } })
  if (!lead) return { ok: false }
  if (lead.outreach_status !== 'UNSUBSCRIBED') await unsubscribeLead(lead, 'Unsubscribe link')
  return { ok: true, businessName: lead.name }
}
