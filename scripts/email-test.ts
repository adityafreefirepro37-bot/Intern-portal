/**
 * Checks outbound email settings and sends one test message.
 *
 *   npm run email:test -- you@example.com
 *
 * With EMAIL_PROVIDER=smtp it first connects and logs in to the SMTP server
 * (reporting a wrong host, port or password clearly), then sends the test
 * email. Uses the same code path as invitation emails. Reads .env.
 */
import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd())

async function main() {
  const to = process.argv[2]?.trim()
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    console.error('Usage: npm run email:test -- you@example.com')
    process.exit(1)
  }

  const { config } = await import('../src/lib/config')
  const { emailService, escapeHtml } = await import('../src/server/services/email.service')

  if (!emailService.isConfigured()) {
    console.error(
      'Email is not configured. Set EMAIL_FROM and either EMAIL_PROVIDER=smtp with SMTP_HOST, SMTP_USER and ' +
        'SMTP_PASSWORD, or EMAIL_PROVIDER=resend with EMAIL_API_KEY.',
    )
    process.exit(1)
  }

  if (config.email.provider === 'smtp') {
    const { host, port, secure, user } = config.email.smtp
    console.log(`Connecting to ${host}:${port} (${secure ? 'TLS' : 'STARTTLS'}) as ${user}…`)
    try {
      await emailService.verifySmtp()
    } catch (error) {
      const e = error as { code?: string; responseCode?: number; message?: string }
      console.error(`SMTP check failed (${e.code ?? 'error'}${e.responseCode ? ` ${e.responseCode}` : ''}).`)
      if (e.code === 'EAUTH') console.error('The server rejected the username or password.')
      else if (e.code === 'ETIMEDOUT' || e.code === 'ECONNECTION' || e.code === 'ESOCKET') {
        console.error(
          'Could not reach the server: check SMTP_HOST, SMTP_PORT and SMTP_SECURE (465 → true, 587 → false).',
        )
      }
      process.exit(1)
    }
    console.log('Connected and signed in.')
  }

  await emailService.send({
    to,
    subject: `Test email from ${config.app.name}`,
    text: `This is a test email from ${config.app.name} (${config.app.url}). If you can read it, email delivery works.`,
    html: `<p>This is a test email from <strong>${escapeHtml(config.app.name)}</strong> (${escapeHtml(config.app.url)}).</p><p>If you can read it, email delivery works.</p>`,
  })
  console.log(`Sent a test email to ${to} from ${config.email.from}.`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
