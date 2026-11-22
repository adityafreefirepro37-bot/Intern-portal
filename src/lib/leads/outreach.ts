/**
 * Outreach rules, as pure functions: the emails (an AI-written first email, or
 * a template when there's no AI or the draft fails a check, then two short
 * follow-ups), the footer every email carries (who is writing, why, the postal
 * address and a one-click unsubscribe), when sending is allowed (business
 * hours in India, a slow warm-up per mailbox) and what an incoming message is
 * (a reply, an automatic reply, a bounce or an unsubscribe request).
 */

export const AUDIT_LINK = '{audit_link}'
/** Emails in a sequence: the first one and two follow-ups. */
export const MAX_STEPS = 3

export interface Sender {
  name: string
  company: string
  website: string
  postalAddress: string
}

export interface EmailContext {
  businessName: string
  city: string | null
  findings: { title: string; detail: string }[]
  auditUrl: string
  unsubscribeUrl: string
  sender: Sender
  /** When the private audit page closes. */
  auditExpiresAt: Date | null
}

export interface Draft {
  subject: string
  body: string
}

/** Signature and the lines every outreach email ends with. */
export function footer(ctx: EmailContext): string {
  return [
    '',
    `${ctx.sender.name}`,
    `${ctx.sender.company} · ${ctx.sender.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}`,
    ctx.sender.postalAddress,
    '',
    `You're getting this because ${ctx.businessName}'s contact details are published on its website. If you'd rather not hear from us, unsubscribe here and we won't email again: ${ctx.unsubscribeUrl}`,
  ].join('\n')
}

/** The body as sent: the audit link filled in and the footer added. */
export function finalBody(body: string, ctx: EmailContext): string {
  return `${body.trim().replace(AUDIT_LINK, ctx.auditUrl)}\n${footer(ctx)}`
}

function lowerFirst(text: string) {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

/** The first email without AI: the top two findings, the audit link and a question. */
export function templateFirstEmail(ctx: EmailContext): Draft {
  const [first, second] = ctx.findings
  const problems = [first, second].filter((f): f is { title: string; detail: string } => Boolean(f))
  const lines = problems.map((f) => `- ${f.title}: ${lowerFirst(f.detail)}`)
  return {
    subject: `A few quick wins for ${ctx.businessName}`.slice(0, 90),
    body: [
      `Hi ${ctx.businessName} team,`,
      '',
      `I'm ${ctx.sender.name} from ${ctx.sender.company}. We ran a free check of your website and online presence${ctx.city ? ` in ${ctx.city}` : ''} and found a few things that may be costing you enquiries:`,
      '',
      ...lines,
      '',
      `The full audit is here, free and private to you: ${AUDIT_LINK}`,
      '',
      'Would it help if I walked you through it in 15 minutes?',
    ].join('\n'),
  }
}

/** Follow-ups (steps 2 and 3): short, in the same thread, the last one says it is the last. */
export function followUpEmail(step: number, ctx: EmailContext, firstSubject: string): Draft {
  const subject = /^re:/i.test(firstSubject) ? firstSubject : `Re: ${firstSubject}`
  const top = ctx.findings[0]
  if (step === 2)
    return {
      subject,
      body: [
        `Hi again,`,
        '',
        `Just making sure you saw the free audit for ${ctx.businessName}: ${AUDIT_LINK}`,
        top ? `\nThe quickest win is probably this one: ${lowerFirst(top.title)}.` : '',
        '',
        'Happy to explain it on a short call, or by email if that suits you better.',
      ]
        .filter((l, i, all) => l !== '' || all[i - 1] !== '')
        .join('\n'),
    }
  const until = ctx.auditExpiresAt
    ? ` It stays open until ${ctx.auditExpiresAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })}.`
    : ''
  return {
    subject,
    body: [
      'Hi,',
      '',
      `One last note from me: your audit is still here if it's useful: ${AUDIT_LINK}${until}`,
      '',
      "If now isn't the right time, no problem at all. I won't email again.",
    ].join('\n'),
  }
}

const SPAM_WORDS =
  /\b(guarantee[ds]?|100\s?%|risk[- ]free|act now|limited time|urgent|winner|congratulations|cheapest|lowest price|free trial|click here|buy now|no obligation|double your|skyrocket|#1)\b|₹|\brs\.?\s?\d|\$\d/i

/**
 * Checks an AI draft before it can be sent. Returns why it was rejected, or
 * null when it's fine. Numbers must come from the findings (no invented
 * statistics), the only link is the audit link, nothing spammy.
 */
export function draftProblem(draft: Draft, ctx: Pick<EmailContext, 'businessName' | 'findings'>): string | null {
  const subject = draft.subject.trim()
  const body = draft.body.trim()
  if (subject.length < 3 || subject.length > 90) return 'subject length'
  if (/^(re|fwd?):/i.test(subject)) return 'subject pretends to be a reply'
  if (subject === subject.toUpperCase() && /[A-Z]{4}/.test(subject)) return 'subject in capitals'
  if (body.length < 120 || body.length > 1100) return 'body length'
  if (body.split(AUDIT_LINK).length !== 2) return 'audit link missing or repeated'
  if (!body.toLowerCase().includes(ctx.businessName.toLowerCase())) return 'doesn’t name the business'
  if (/https?:\/\/|www\./i.test(body.replace(AUDIT_LINK, ''))) return 'other links'
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(body)) return 'email address in body'
  if (SPAM_WORDS.test(`${subject} ${body}`)) return 'spammy wording'
  if ((`${subject} ${body}`.match(/!/g) ?? []).length > 1) return 'exclamation marks'
  if (/\*\*|^#+\s|\[.+\]\(.+\)/m.test(body)) return 'markdown'
  const known = `${ctx.businessName} ${ctx.findings.map((f) => `${f.title} ${f.detail}`).join(' ')}`
  for (const number of `${subject} ${body}`.match(/\d+(?:[.,]\d+)?/g) ?? [])
    if (!known.includes(number) && number !== '15') return `number not in the findings (${number})`
  return null
}

// ─── When to send ────────────────────────────────────────────────────────────

/** Day of week (1 = Monday … 7 = Sunday) and hour in India. */
export function indiaTime(now: Date): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now)
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon'
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  return { day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekday) + 1, hour }
}

export function inSendWindow(now: Date, window: { days: number[]; fromHour: number; untilHour: number }): boolean {
  const { day, hour } = indiaTime(now)
  return window.days.includes(day) && hour >= window.fromHour && hour < window.untilHour
}

/**
 * Emails a mailbox may send today: a slow start that grows by 3 a day (5, 8,
 * 11…) up to the maximum, so a new mailbox builds a good sending reputation.
 */
export function mailboxDailyLimit(warmupStartedAt: Date | null, now: Date, max: number): number {
  const days = warmupStartedAt ? Math.max(0, Math.floor((now.getTime() - warmupStartedAt.getTime()) / 86_400_000)) : 0
  return Math.min(max, 5 + 3 * days)
}

// ─── Incoming mail ───────────────────────────────────────────────────────────

export interface InboundMessage {
  from: string
  subject: string
  /** Lower-case header names. */
  headers: Record<string, string>
  /** The start of the message text (and, for a bounce, the returned message). */
  text: string
}

export type InboundKind = 'bounce' | 'auto_reply' | 'unsubscribe' | 'reply'

export function classifyInbound(message: InboundMessage): InboundKind {
  const from = message.from.toLowerCase()
  const subject = message.subject.toLowerCase()
  const contentType = message.headers['content-type']?.toLowerCase() ?? ''
  if (/mailer-daemon|postmaster@/.test(from) || /report-type=delivery-status/.test(contentType) || /^(undeliver|delivery status notification|mail delivery failed|returned mail|failure notice)/.test(subject))
    return 'bounce'
  const auto = message.headers['auto-submitted']?.toLowerCase()
  if ((auto && auto !== 'no') || message.headers['x-autoreply'] || message.headers['x-autorespond'] || /^(auto(matic)?[- ]?reply|out of (the )?office|away from|autoreply)/.test(subject))
    return 'auto_reply'
  const firstLines = message.text.split(/\r?\n/).filter((l) => !l.startsWith('>')).slice(0, 8).join(' ').toLowerCase()
  if (/\b(unsubscribe|remove me|stop (emailing|sending)|do not (email|contact)|don't (email|contact)|take me off)\b/.test(`${subject} ${firstLines}`)) return 'unsubscribe'
  return 'reply'
}
