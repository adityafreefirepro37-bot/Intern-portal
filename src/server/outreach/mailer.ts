import 'server-only'
import { resolveTxt } from 'node:dns/promises'
import { ImapFlow } from 'imapflow'
import nodemailer, { type Transporter } from 'nodemailer'
import { config } from '@/lib/config'
import type { InboundMessage } from '@/lib/leads/outreach'

/**
 * Sending and reading the outreach mailboxes: SMTP to send, IMAP to read
 * replies and bounces, DNS to check the domain's email authentication. Behind
 * an interface so tests swap in a fake (setOutreachMailerForTests). Passwords
 * come from OUTREACH_MAILBOXES and are never logged.
 */

export interface MailboxConfig {
  email: string
  password: string
  name?: string
}

export interface OutgoingMail {
  from: { name: string; email: string }
  to: string
  subject: string
  text: string
  messageId: string
  inReplyTo?: string
  references?: string[]
  headers: Record<string, string>
}

export interface InboxItem {
  uid: number
  message: InboundMessage
  /** Message-IDs this message refers to (In-Reply-To, References, and any found in a bounce). */
  refersTo: string[]
}

export interface DomainAuth {
  spf: boolean
  dmarc: boolean
  /** null when no DKIM key was found under the usual selectors (it may still exist). */
  dkim: boolean | null
}

export interface OutreachMailer {
  send(mailbox: MailboxConfig, mail: OutgoingMail): Promise<void>
  /** Messages with a UID above `afterUid`; with null, nothing is read and the current top UID is returned as the start. */
  readInbox(mailbox: MailboxConfig, afterUid: number | null): Promise<{ items: InboxItem[]; lastUid: number }>
  domainAuth(domain: string): Promise<DomainAuth>
}

/** SMTP refusal of the address itself (it doesn't exist): treated like a bounce. */
export class RecipientRejectedError extends Error {}

const transports = new Map<string, Transporter>()

function transportFor(mailbox: MailboxConfig): Transporter {
  let transport = transports.get(mailbox.email)
  if (!transport) {
    const { host, port, secure } = config.outreach.smtp
    transport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user: mailbox.email, pass: mailbox.password },
      requireTLS: !secure,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })
    transports.set(mailbox.email, transport)
  }
  return transport
}

const MESSAGE_ID = /<[^<>\s@]+@[^<>\s]+>/g

function headerBlock(source: string): Record<string, string> {
  const end = source.search(/\r?\n\r?\n/)
  const raw = (end === -1 ? source : source.slice(0, end)).replace(/\r?\n[ \t]+/g, ' ')
  const headers: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] ??= line.slice(i + 1).trim()
  }
  return headers
}

function bodyText(source: string): string {
  const start = source.search(/\r?\n\r?\n/)
  return (start === -1 ? '' : source.slice(start))
    .replace(/=\r?\n/g, '')
    .replace(/<[^>]+>/g, ' ')
    .slice(0, 20_000)
}

const realMailer: OutreachMailer = {
  async send(mailbox, mail) {
    try {
      await transportFor(mailbox).sendMail({
        from: { name: mail.from.name, address: mail.from.email },
        to: mail.to,
        replyTo: mail.from.email,
        subject: mail.subject,
        text: mail.text,
        messageId: mail.messageId,
        inReplyTo: mail.inReplyTo,
        references: mail.references,
        headers: mail.headers,
      })
    } catch (error) {
      const code = (error as { responseCode?: number }).responseCode
      if (code === 550 || code === 551 || code === 553) throw new RecipientRejectedError(`Address refused (${code})`)
      throw new Error(`Sending failed${code ? ` (${code})` : ''}`)
    }
  },

  async readInbox(mailbox, afterUid) {
    const client = new ImapFlow({
      host: config.outreach.imap.host,
      port: config.outreach.imap.port,
      secure: true,
      auth: { user: mailbox.email, pass: mailbox.password },
      logger: false,
      socketTimeout: 30_000,
    })
    await client.connect()
    try {
      const lock = await client.getMailboxLock('INBOX')
      try {
        const status = await client.status('INBOX', { uidNext: true })
        const top = Math.max(0, ((status && status.uidNext) || 1) - 1)
        if (afterUid === null || top <= afterUid) return { items: [], lastUid: afterUid === null ? top : afterUid }
        const items: InboxItem[] = []
        for await (const message of client.fetch(`${afterUid + 1}:*`, { uid: true, envelope: true, source: { maxLength: 60_000 } }, { uid: true })) {
          if (message.uid <= afterUid || items.length >= 100) continue
          const source = message.source?.toString('utf8') ?? ''
          const headers = headerBlock(source)
          const text = bodyText(source)
          const refs = `${headers['in-reply-to'] ?? ''} ${headers.references ?? ''}`.match(MESSAGE_ID) ?? []
          const from = message.envelope?.from?.[0]?.address ?? ''
          const returned = /mailer-daemon|postmaster/i.test(from) ? (text.match(MESSAGE_ID) ?? []) : []
          items.push({
            uid: message.uid,
            message: { from, subject: message.envelope?.subject ?? '', headers, text },
            refersTo: [...new Set([...refs, ...returned])],
          })
        }
        return { items, lastUid: Math.max(afterUid, ...items.map((i) => i.uid)) }
      } finally {
        lock.release()
      }
    } finally {
      await client.logout().catch(() => undefined)
    }
  },

  async domainAuth(domain) {
    const txt = async (name: string) =>
      (await resolveTxt(name).catch(() => [] as string[][])).map((parts) => parts.join(''))
    const [root, dmarc] = await Promise.all([txt(domain), txt(`_dmarc.${domain}`)])
    let dkim: boolean | null = null
    for (const selector of ['hostingermail1', 'hostingermail2', 'hostingermail3', 'default', 'dkim', 'mail']) {
      if ((await txt(`${selector}._domainkey.${domain}`)).some((r) => /p=/.test(r))) {
        dkim = true
        break
      }
    }
    return {
      spf: root.some((r) => r.toLowerCase().startsWith('v=spf1')),
      dmarc: dmarc.some((r) => r.toUpperCase().startsWith('V=DMARC1')),
      dkim,
    }
  },
}

let active: OutreachMailer = realMailer

export function outreachMailer(): OutreachMailer {
  return active
}

/** Tests only: replace the mailer (pass null to restore). */
export function setOutreachMailerForTests(mailer: OutreachMailer | null) {
  active = mailer ?? realMailer
}

/** The configured mailboxes (from OUTREACH_MAILBOXES); tests can replace them. */
let mailboxOverride: MailboxConfig[] | null = null

export function configuredMailboxes(): MailboxConfig[] {
  return mailboxOverride ?? config.outreach.mailboxes
}

export function setMailboxesForTests(mailboxes: MailboxConfig[] | null) {
  mailboxOverride = mailboxes
}
