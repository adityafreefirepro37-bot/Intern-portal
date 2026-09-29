import nodemailer, { type Transporter } from 'nodemailer'
import { config } from '@/lib/config'
import { AppError } from '@/lib/errors'
import { logger } from '@/lib/logging'

/**
 * Outbound application email (invitations). Password-reset and verification
 * emails are sent by the auth provider (Supabase) itself — configure custom
 * SMTP for those in the Supabase dashboard.
 *
 * Providers:
 *   EMAIL_PROVIDER=resend  Resend HTTP API (EMAIL_API_KEY)
 *   EMAIL_PROVIDER=smtp    any SMTP server, e.g. your mail host (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD)
 * When no provider is configured, `isConfigured()` is false and callers fall
 * back to a development-only flow; message bodies (which contain links with
 * tokens) and credentials are never logged.
 */
export interface EmailMessage {
  to: string
  subject: string
  text: string
  html: string
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  )
}

let smtpTransport: Transporter | null = null

/** One transport per server instance, created on first use. */
function getSmtpTransport(): Transporter {
  if (!smtpTransport) {
    const { host, port, secure, user, password } = config.email.smtp
    smtpTransport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass: password },
      // Upgrade to TLS on 587/25 and refuse to send credentials in clear text.
      requireTLS: !secure,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })
  }
  return smtpTransport
}

/** Non-sensitive facts about an SMTP failure (never the message or credentials). */
function smtpErrorFacts(error: unknown) {
  const e = error as { code?: unknown; responseCode?: unknown; command?: unknown }
  return { code: e?.code, responseCode: e?.responseCode, command: e?.command }
}

export const emailService = {
  isConfigured(): boolean {
    const { provider, apiKey, from, smtp } = config.email
    if (!from) return false
    if (provider === 'resend') return Boolean(apiKey)
    if (provider === 'smtp') return Boolean(smtp.host && smtp.user && smtp.password)
    return false
  },

  async send(message: EmailMessage): Promise<void> {
    if (!this.isConfigured()) throw new AppError('NOT_IMPLEMENTED', 'Email delivery is not configured')
    if (config.email.provider === 'smtp') {
      try {
        await getSmtpTransport().sendMail({
          from: config.email.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        })
      } catch (error) {
        logger.error('SMTP server rejected a message', { ...smtpErrorFacts(error), subject: message.subject })
        throw new AppError('INTERNAL_ERROR', 'Email could not be sent')
      }
      return
    }
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.email.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: config.email.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    })
    if (!response.ok) {
      logger.error('Email provider rejected a message', { status: response.status, subject: message.subject })
      throw new AppError('INTERNAL_ERROR', 'Email could not be sent')
    }
  },

  /**
   * Checks the SMTP connection and login without sending anything (used by
   * `npm run email:test`). Resend has no equivalent check.
   */
  async verifySmtp(): Promise<void> {
    if (config.email.provider !== 'smtp' || !this.isConfigured()) {
      throw new AppError(
        'NOT_IMPLEMENTED',
        'SMTP is not configured (EMAIL_PROVIDER=smtp, SMTP_HOST, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM)',
      )
    }
    await getSmtpTransport().verify()
  },

  invitationMessage(input: {
    to: string
    inviteUrl: string
    organizationName: string
    roleName: string
    inviterName: string
    expiresAt: Date
  }): EmailMessage {
    const expires = input.expiresAt.toUTCString()
    const subject = `You're invited to ${input.organizationName} on AYAVA Intern OS`
    const text = [
      `${input.inviterName} invited you to join ${input.organizationName} on AYAVA Intern OS as ${input.roleName}.`,
      '',
      `Accept the invitation: ${input.inviteUrl}`,
      '',
      `This link expires on ${expires} and can be used once. If you weren't expecting it, ignore this email.`,
    ].join('\n')
    const html = `<p>${escapeHtml(input.inviterName)} invited you to join <strong>${escapeHtml(input.organizationName)}</strong> on AYAVA Intern OS as ${escapeHtml(input.roleName)}.</p>
<p><a href="${escapeHtml(input.inviteUrl)}">Accept the invitation</a></p>
<p style="color:#666">This link expires on ${escapeHtml(expires)} and can be used once. If you weren't expecting it, ignore this email.</p>`
    return { to: input.to, subject, text, html }
  },
}
