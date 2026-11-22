import 'server-only'
import { randomUUID } from 'node:crypto'
import type { Lead, OutreachStatus } from '@prisma/client'
import { z } from 'zod'
import { buildOutreachEmailMessages } from '@/lib/ai/prompts'
import { config } from '@/lib/config'
import { prisma } from '@/lib/db/client'
import { servicesFor } from '@/lib/leads/audit'
import { AYAVA_SERVICES } from '@/lib/leads/catalog'
import {
  classifyInbound,
  draftProblem,
  finalBody,
  followUpEmail,
  inSendWindow,
  MAX_STEPS,
  mailboxDailyLimit,
  templateFirstEmail,
  type Draft,
  type EmailContext,
} from '@/lib/leads/outreach'
import { logger } from '@/lib/logging'
import { generateStructured, getAIProvider } from '../ai/provider'
import { aiSettingsService } from '../ai/settings.service'
import { enqueueJob, type JobHandler } from '../jobs/queue'
import { leadFindings, type LeadSummary } from '../leads/pipeline'
import { domainOf } from '../leads/safe-fetch'
import { growthSettings, type GrowthSettings } from '../leads/settings'
import { auditService } from '../services/audit.service'
import { AUDIT_ACTIONS } from '../services/audit-actions'
import { NOTIFICATION_TYPES, notificationService, usersWithPermission } from '../services/notification.service'
import { configuredMailboxes, outreachMailer, RecipientRejectedError, type MailboxConfig } from './mailer'

/**
 * Automatic outreach, run by the background worker:
 *
 *   enrol      AUTO-route Hot / Warm leads with a published email and an audit page
 *   draft      AI writes the first email from the findings (checked; a template if it fails)
 *              → the first `approvalsRequired` emails wait for an admin, then they send on their own
 *   send       business hours in India, one email per mailbox per run, daily limit with warm-up
 *   follow up  two short follow-ups in the same thread, then the sequence ends
 *   inbox      replies (→ a person takes over), automatic replies (ignored), bounces and
 *              unsubscribes (→ never emailed again) are read from each mailbox
 *
 * Nothing is sent before the outreach readiness checks pass (see readiness()).
 */

const MAX_ENROL_PER_RUN = 10
/** Minimum time between two emails from the same mailbox. */
const MAILBOX_GAP_MS = 4 * 60_000
const INBOX_EVERY_MS = 10 * 60_000
const RETRY_AFTER_MS = 30 * 60_000
const CONTACTABLE_STATUSES = ['NEW', 'REVIEWED', 'READY'] as const

// ─── Readiness ───────────────────────────────────────────────────────────────

export interface Readiness {
  ready: boolean
  problems: string[]
  mailboxes: string[]
  linkBase: string
}

/** Everything that must be true before an email can go out. */
export async function readiness(settings: GrowthSettings): Promise<Readiness> {
  const problems: string[] = []
  const mailboxes = configuredMailboxes().map((m) => m.email)
  if (!settings.outreachEnabled) problems.push('Automatic outreach is switched off.')
  if (!settings.senderName) problems.push('Add the sender’s name (it signs every email).')
  if (settings.postalAddress.length < 10) problems.push('Add the business’s postal address (every email shows it).')
  if (!mailboxes.length) problems.push('Add sending mailboxes to OUTREACH_MAILBOXES in the hosting settings.')
  const linkBase = config.app.url
  if (process.env.NODE_ENV !== 'test' && /localhost|127\.0\.0\.1/.test(linkBase)) problems.push('NEXT_PUBLIC_APP_URL is a local address, so audit links wouldn’t open for businesses.')
  for (const domain of new Set(mailboxes.map((m) => m.split('@')[1]!))) {
    const auth = await outreachMailer().domainAuth(domain).catch(() => null)
    if (!auth?.spf) problems.push(`${domain} has no SPF record, so emails would land in spam. Add the one your mail host gives you.`)
  }
  return { ready: problems.length === 0, problems, mailboxes, linkBase }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function auditUrl(token: string) {
  return `${config.app.url.replace(/\/$/, '')}/audit/${token}`
}

export function unsubscribeUrl(token: string) {
  return `${config.app.url.replace(/\/$/, '')}/api/outreach/unsubscribe/${token}`
}

function emailContext(lead: Lead & { industry: { checks: string[] } | null }, settings: GrowthSettings): EmailContext {
  const summary = lead.summary as unknown as LeadSummary | null
  const findings = leadFindings(lead)
  const problems = summary?.problems?.length ? summary.problems : findings.slice(0, 3).map((f) => ({ title: f.title, detail: f.detail }))
  return {
    businessName: lead.name,
    city: lead.city,
    findings: problems,
    auditUrl: auditUrl(lead.audit_token!),
    unsubscribeUrl: unsubscribeUrl(lead.audit_token!),
    sender: { name: settings.senderName, company: settings.companyName, website: settings.companyWebsite, postalAddress: settings.postalAddress },
    auditExpiresAt: lead.audit_expires_at,
  }
}

/** Why a lead can't get (more) automatic emails right now, or null when it can. */
async function blockedReason(lead: Pick<Lead, 'organization_id' | 'status' | 'route' | 'email' | 'audit_token' | 'audit_expires_at' | 'website'>) {
  if (!(CONTACTABLE_STATUSES as readonly string[]).includes(lead.status)) return 'the lead’s status changed'
  if (lead.route !== 'AUTO') return 'the lead is handled by the team'
  if (!lead.email || !lead.audit_token) return 'no email or audit page'
  if (lead.audit_expires_at && lead.audit_expires_at.getTime() < Date.now() + 2 * 86_400_000) return 'the audit page is about to close'
  const domain = domainOf(lead.website)
  const suppressed = await prisma.leadSuppression.findFirst({
    where: {
      organization_id: lead.organization_id,
      OR: [{ kind: 'EMAIL', value: lead.email.toLowerCase() }, ...(domain ? [{ kind: 'DOMAIN', value: domain }] : [])],
    },
    select: { id: true },
  })
  return suppressed ? 'the business opted out' : null
}

/** Ends a lead's sequence: scheduled emails are cancelled. */
export async function stopSequence(leadId: string, status: OutreachStatus, extra: Partial<Pick<Lead, 'status' | 'outreach_replied_at'>> = {}) {
  await prisma.$transaction([
    prisma.outreachMessage.updateMany({
      where: { lead_id: leadId, status: { in: ['AWAITING_APPROVAL', 'SCHEDULED'] } },
      data: { status: 'CANCELLED' },
    }),
    prisma.lead.update({ where: { id: leadId }, data: { outreach_status: status, ...extra } }),
  ])
}

/** Midnight in India, as a Date. */
function indiaDayStart(now: Date) {
  const india = new Date(now.getTime() + 5.5 * 3_600_000)
  return new Date(Date.UTC(india.getUTCFullYear(), india.getUTCMonth(), india.getUTCDate()) - 5.5 * 3_600_000)
}

async function syncMailboxes(organizationId: string) {
  const emails = configuredMailboxes().map((m) => m.email)
  if (emails.length)
    await prisma.outreachMailbox.createMany({
      data: emails.map((email) => ({ organization_id: organizationId, email })),
      skipDuplicates: true,
    })
}

// ─── Scheduler (every worker run) ────────────────────────────────────────────

export async function scheduleOutreach() {
  const rows = await prisma.setting.findMany({ where: { key: 'growth' }, select: { organization_id: true } })
  let queued = 0
  for (const { organization_id: organizationId } of rows) {
    const settings = await growthSettings.get(organizationId)
    if (!settings.outreachEnabled) continue
    await syncMailboxes(organizationId)

    const candidates = await prisma.lead.findMany({
      where: {
        organization_id: organizationId,
        route: 'AUTO',
        tier: { in: ['HOT', 'WARM'] },
        outreach_status: 'NONE',
        status: { in: [...CONTACTABLE_STATUSES] },
        research_status: 'DONE',
        email: { not: null },
        audit_token: { not: null },
      },
      orderBy: [{ tier: 'asc' }, { need_score: 'desc' }],
      take: MAX_ENROL_PER_RUN,
      select: { id: true },
    })
    for (const lead of candidates)
      if (await enqueueJob({ type: 'outreach.draft', organizationId, payload: { leadId: lead.id }, dedupeKey: `outreach.draft:${lead.id}`, maxAttempts: 2 }))
        queued++

    if (inSendWindow(new Date(), { days: settings.sendDays, fromHour: settings.sendFromHour, untilHour: settings.sendUntilHour }))
      if (await enqueueJob({ type: 'outreach.send', organizationId, payload: {}, dedupeKey: `outreach.send:${organizationId}`, maxAttempts: 1 }))
        queued++

    const due = await prisma.outreachMailbox.findMany({
      where: {
        organization_id: organizationId,
        active: true,
        email: { in: configuredMailboxes().map((m) => m.email) },
        OR: [{ last_inbox_check_at: null }, { last_inbox_check_at: { lt: new Date(Date.now() - INBOX_EVERY_MS) } }],
      },
      select: { email: true },
    })
    for (const mailbox of due)
      if (await enqueueJob({ type: 'outreach.inbox', organizationId, payload: { mailbox: mailbox.email }, dedupeKey: `outreach.inbox:${mailbox.email}`, maxAttempts: 1 }))
        queued++
  }
  return { queued }
}

// ─── Drafting ────────────────────────────────────────────────────────────────

const draftSchema = z.object({ subject: z.string().min(3).max(120), body: z.string().min(50).max(2000) })

async function aiDraft(lead: Lead & { industry: { name: string; checks: string[] } | null }, ctx: EmailContext, settings: GrowthSettings): Promise<Draft | null> {
  const provider = getAIProvider()
  const ai = await aiSettingsService.get(lead.organization_id)
  if (!provider || !ai.enabled || !settings.aiSummaries) return null
  const findings = leadFindings(lead)
  try {
    const started = Date.now()
    const { data, result } = await generateStructured(provider, draftSchema, {
      messages: buildOutreachEmailMessages({
        businessName: lead.name,
        industry: lead.industry?.name ?? lead.category,
        city: lead.city,
        findings: findings.slice(0, 6).map((f) => ({ title: f.title, detail: f.detail, service: AYAVA_SERVICES[f.service] })),
        services: servicesFor(findings).slice(0, 3).map((s) => s.name),
        proof: settings.proof,
        senderName: settings.senderName,
        companyName: settings.companyName,
      }),
      maxTokens: 600,
    })
    await prisma.aiUsageEvent.create({
      data: {
        organization_id: lead.organization_id,
        feature: 'LEADS',
        intent: 'outreach_email',
        provider: result.provider,
        model: result.model,
        tokens_input: result.usage.input,
        tokens_output: result.usage.output,
        latency_ms: Date.now() - started,
        success: true,
      },
    })
    const known = { businessName: lead.name, findings: [...ctx.findings, ...findings.map((f) => ({ title: f.title, detail: f.detail }))] }
    const problem = draftProblem(data, known)
    if (problem) {
      logger.info('AI outreach draft rejected, using the template', { leadId: lead.id, problem })
      return null
    }
    return { subject: data.subject.trim(), body: data.body.trim() }
  } catch (error) {
    logger.info('AI outreach draft failed, using the template', { leadId: lead.id, error: error instanceof Error ? error.message : String(error) })
    return null
  }
}

export async function approvalsLeft(organizationId: string, settings: GrowthSettings) {
  const approved = await prisma.outreachMessage.count({ where: { organization_id: organizationId, approved_by: { not: null } } })
  return Math.max(0, settings.approvalsRequired - approved)
}

const runDraft: JobHandler = async (payload) => {
  const leadId = z.uuid().parse(payload.leadId)
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { industry: { select: { name: true, checks: true } } } })
  if (!lead || lead.outreach_status !== 'NONE') return
  const settings = await growthSettings.get(lead.organization_id)
  if (!settings.outreachEnabled) return
  const blocked = await blockedReason(lead)
  if (blocked) return
  const ctx = emailContext(lead, settings)
  const draft = (await aiDraft(lead, ctx, settings)) ?? templateFirstEmail(ctx)
  const needsApproval = (await approvalsLeft(lead.organization_id, settings)) > 0
  const created = await prisma.outreachMessage
    .create({
      data: {
        organization_id: lead.organization_id,
        lead_id: lead.id,
        step: 1,
        status: needsApproval ? 'AWAITING_APPROVAL' : 'SCHEDULED',
        to_email: lead.email!,
        subject: draft.subject,
        body: finalBody(draft.body, ctx),
        scheduled_for: new Date(),
      },
      select: { id: true },
    })
    .catch((error: unknown) => {
      if ((error as { code?: string })?.code === 'P2002') return null
      throw error
    })
  if (!created) return
  await prisma.lead.update({
    where: { id: lead.id },
    data: { outreach_status: needsApproval ? 'AWAITING_APPROVAL' : 'ACTIVE', outreach_started_at: new Date() },
  })
  if (needsApproval) await remindApprovers(lead.organization_id)
}

/** Tells admins emails are waiting (at most every 6 hours). */
async function remindApprovers(organizationId: string) {
  const recent = await prisma.notification.findFirst({
    where: { organization_id: organizationId, type: NOTIFICATION_TYPES.OUTREACH_APPROVAL_NEEDED, created_at: { gt: new Date(Date.now() - 6 * 3_600_000) } },
    select: { id: true },
  })
  if (recent) return
  const waiting = await prisma.outreachMessage.count({ where: { organization_id: organizationId, status: 'AWAITING_APPROVAL' } })
  await notificationService.notify(
    organizationId,
    await usersWithPermission(organizationId, 'lead.manage'),
    {
      type: NOTIFICATION_TYPES.OUTREACH_APPROVAL_NEEDED,
      title: `${waiting} outreach email${waiting === 1 ? '' : 's'} waiting for approval`,
      body: 'Check and approve them in Growth → Outreach. After the first ones, emails send on their own.',
      entityType: 'outreach',
      entityId: null,
    },
    null,
  )
}

// ─── Sending ─────────────────────────────────────────────────────────────────

function messageIdFor(mailbox: string) {
  return `<${randomUUID()}@${mailbox.split('@')[1]}>`
}

async function sendOne(organizationId: string, mailbox: MailboxConfig, settings: GrowthSettings) {
  const now = new Date()
  const next = await prisma.outreachMessage.findFirst({
    where: {
      organization_id: organizationId,
      status: 'SCHEDULED',
      scheduled_for: { lte: now },
      // Follow-ups go from the mailbox that sent the first email (same thread).
      OR: [{ mailbox: null }, { mailbox: mailbox.email }],
    },
    orderBy: [{ step: 'desc' }, { scheduled_for: 'asc' }],
  })
  if (!next) return false
  const claimed = await prisma.outreachMessage.updateMany({ where: { id: next.id, status: 'SCHEDULED' }, data: { status: 'SENDING' } })
  if (!claimed.count) return false
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: next.lead_id }, include: { industry: { select: { checks: true } } } })
  const blocked = lead.outreach_status === 'ACTIVE' ? await blockedReason(lead) : 'the sequence was stopped'
  if (blocked) {
    await prisma.outreachMessage.update({ where: { id: next.id }, data: { status: 'CANCELLED', error: `Not sent: ${blocked}` } })
    if (lead.outreach_status === 'ACTIVE') await stopSequence(lead.id, 'STOPPED')
    return true
  }
  const first = next.step > 1 ? await prisma.outreachMessage.findUnique({ where: { lead_id_step: { lead_id: lead.id, step: 1 } } }) : null
  const messageId = messageIdFor(mailbox.email)
  const unsubscribe = unsubscribeUrl(lead.audit_token!)
  try {
    await outreachMailer().send(mailbox, {
      from: { name: settings.senderName, email: mailbox.email },
      to: next.to_email,
      subject: next.subject,
      text: next.body,
      messageId,
      ...(first?.message_id ? { inReplyTo: first.message_id, references: [first.message_id] } : {}),
      headers: {
        'List-Unsubscribe': `<${unsubscribe}>, <mailto:${mailbox.email}?subject=unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    })
  } catch (error) {
    if (error instanceof RecipientRejectedError) {
      await prisma.outreachMessage.update({ where: { id: next.id }, data: { status: 'FAILED', error: error.message, mailbox: mailbox.email } })
      await markBounced(lead.id, lead.organization_id, next.to_email)
    } else {
      await prisma.outreachMessage.update({
        where: { id: next.id },
        data: { status: 'SCHEDULED', scheduled_for: new Date(Date.now() + RETRY_AFTER_MS), error: error instanceof Error ? error.message : 'Sending failed' },
      })
      await prisma.outreachMailbox.update({
        where: { organization_id_email: { organization_id: organizationId, email: mailbox.email } },
        data: { last_error: error instanceof Error ? error.message : 'Sending failed', last_sent_at: now },
      })
    }
    return true
  }
  await prisma.outreachMessage.update({ where: { id: next.id }, data: { status: 'SENT', sent_at: now, mailbox: mailbox.email, message_id: messageId, error: null } })
  await prisma.outreachMailbox.updateMany({
    where: { organization_id: organizationId, email: mailbox.email },
    data: { last_sent_at: now, last_error: null },
  })
  await prisma.outreachMailbox.updateMany({
    where: { organization_id: organizationId, email: mailbox.email, warmup_started_at: null },
    data: { warmup_started_at: now },
  })
  if (next.step < MAX_STEPS) {
    const ctx = emailContext(lead, settings)
    const draft = followUpEmail(next.step + 1, ctx, first?.subject ?? next.subject)
    const gap = settings.followUpGapDays[next.step - 1] ?? 4
    await prisma.outreachMessage.create({
      data: {
        organization_id: organizationId,
        lead_id: lead.id,
        step: next.step + 1,
        status: 'SCHEDULED',
        to_email: next.to_email,
        mailbox: mailbox.email,
        subject: draft.subject,
        body: finalBody(draft.body, ctx),
        scheduled_for: new Date(now.getTime() + gap * 86_400_000),
      },
    })
  } else {
    await prisma.lead.update({ where: { id: lead.id }, data: { outreach_status: 'COMPLETED' } })
  }
  return true
}

const runSend: JobHandler = async (_payload, job) => {
  const organizationId = job.organizationId
  if (!organizationId) return
  const settings = await growthSettings.get(organizationId)
  const now = new Date()
  if (!inSendWindow(now, { days: settings.sendDays, fromHour: settings.sendFromHour, untilHour: settings.sendUntilHour })) return
  if (!(await readiness(settings)).ready) return
  await syncMailboxes(organizationId)
  const states = new Map(
    (await prisma.outreachMailbox.findMany({ where: { organization_id: organizationId } })).map((m) => [m.email, m]),
  )
  const dayStart = indiaDayStart(now)
  for (const mailbox of configuredMailboxes()) {
    const state = states.get(mailbox.email)
    if (!state?.active) continue
    if (state.last_sent_at && now.getTime() - state.last_sent_at.getTime() < MAILBOX_GAP_MS) continue
    const sentToday = await prisma.outreachMessage.count({ where: { mailbox: mailbox.email, sent_at: { gte: dayStart } } })
    if (sentToday >= mailboxDailyLimit(state.warmup_started_at, now, settings.mailboxDailyMax)) continue
    await sendOne(organizationId, mailbox, settings)
  }
}

// ─── Inbox ───────────────────────────────────────────────────────────────────

async function markBounced(leadId: string, organizationId: string, email: string) {
  await prisma.leadSuppression.createMany({
    data: [{ organization_id: organizationId, kind: 'EMAIL', value: email.toLowerCase(), reason: 'Email bounced' }],
    skipDuplicates: true,
  })
  await stopSequence(leadId, 'BOUNCED')
}

/** "Unsubscribe": the address is never emailed again and the lead is marked Do not contact. */
export async function unsubscribeLead(lead: Pick<Lead, 'id' | 'organization_id' | 'email'>, how: string) {
  if (lead.email)
    await prisma.leadSuppression.createMany({
      data: [{ organization_id: lead.organization_id, kind: 'EMAIL', value: lead.email.toLowerCase(), reason: how }],
      skipDuplicates: true,
    })
  await stopSequence(lead.id, 'UNSUBSCRIBED', { status: 'DO_NOT_CONTACT' })
  await auditService.log({ organizationId: lead.organization_id, actorUserId: null, action: AUDIT_ACTIONS.LEAD_UNSUBSCRIBED, resourceType: 'lead', resourceId: lead.id, metadata: { how } })
}

async function notifyOwners(lead: Pick<Lead, 'id' | 'organization_id' | 'assigned_to'>, title: string, body: string) {
  const recipients = lead.assigned_to ? [lead.assigned_to] : await usersWithPermission(lead.organization_id, 'lead.manage')
  await notificationService.notify(lead.organization_id, recipients, { type: NOTIFICATION_TYPES.LEAD_REPLIED, title, body, entityType: 'lead', entityId: lead.id }, null)
}

const runInbox: JobHandler = async (payload, job) => {
  const organizationId = job.organizationId
  const email = z.string().parse(payload.mailbox)
  const mailbox = configuredMailboxes().find((m) => m.email === email)
  if (!organizationId || !mailbox) return
  const state = await prisma.outreachMailbox.findUnique({ where: { organization_id_email: { organization_id: organizationId, email } } })
  if (!state) return
  let result
  try {
    result = await outreachMailer().readInbox(mailbox, state.last_inbox_uid)
  } catch (error) {
    await prisma.outreachMailbox.update({ where: { id: state.id }, data: { last_inbox_check_at: new Date(), last_error: error instanceof Error ? `Inbox: ${error.message}` : 'Inbox check failed' } })
    return
  }
  for (const item of result.items) {
    const kind = classifyInbound(item.message)
    if (kind === 'auto_reply') continue
    const sent = item.refersTo.length
      ? await prisma.outreachMessage.findFirst({ where: { organization_id: organizationId, message_id: { in: item.refersTo } }, include: { lead: true } })
      : kind === 'bounce'
        ? null
        : await prisma.outreachMessage.findFirst({
            where: { organization_id: organizationId, status: 'SENT', to_email: item.message.from.toLowerCase() },
            orderBy: { sent_at: 'desc' },
            include: { lead: true },
          })
    if (!sent) continue
    const lead = sent.lead
    if (kind === 'bounce') {
      await markBounced(lead.id, organizationId, sent.to_email)
    } else if (kind === 'unsubscribe') {
      await unsubscribeLead(lead, 'Asked by email to stop')
      await notifyOwners(lead, `${lead.name} asked not to be emailed`, 'They replied asking to stop; they won’t be contacted again.')
    } else if (lead.outreach_status !== 'REPLIED') {
      await stopSequence(lead.id, 'REPLIED', { outreach_replied_at: new Date() })
      await notifyOwners(lead, `${lead.name} replied`, `A reply arrived in ${email}: “${item.message.subject.slice(0, 80)}”. Answer it personally from that mailbox.`)
    }
  }
  await prisma.outreachMailbox.update({ where: { id: state.id }, data: { last_inbox_uid: result.lastUid, last_inbox_check_at: new Date(), last_error: null } })
}

export const OUTREACH_JOB_HANDLERS: Record<string, JobHandler> = {
  'outreach.draft': runDraft,
  'outreach.send': runSend,
  'outreach.inbox': runInbox,
}
