import { config } from '@/lib/config'
import { AppError } from '@/lib/errors'
import { logger } from '@/lib/logging'

/**
 * Outbound application email (invitations). Password-reset and verification
 * emails are sent by the auth provider (Supabase) itself.
 *
 * Providers: Resend (EMAIL_PROVIDER=resend). When no provider is configured,
 * `isConfigured()` is false and callers fall back to a development-only flow;
 * message bodies (which contain links with tokens) are never logged.
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

export const emailService = {
  isConfigured(): boolean {
    return config.email.provider === 'resend' && Boolean(config.email.apiKey && config.email.from)
  },

  async send(message: EmailMessage): Promise<void> {
    if (!this.isConfigured()) throw new AppError('NOT_IMPLEMENTED', 'Email delivery is not configured')
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
