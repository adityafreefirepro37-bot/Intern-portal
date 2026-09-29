import { parseEnv } from '@/lib/config'

/**
 * Email delivery: provider selection, SMTP settings and failure handling.
 * The SMTP transport is mocked; a real send against a local SMTP server is
 * covered manually with `npm run email:test`.
 */

const sendMail = jest.fn()
const verify = jest.fn()
const createTransport = jest.fn((_options: unknown) => ({ sendMail, verify }))
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: (o: unknown) => createTransport(o) } }))

const logError = jest.fn()
jest.mock('@/lib/logging', () => ({
  logger: { error: (...args: unknown[]) => logError(...args), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}))

const SMTP_ENV = {
  EMAIL_PROVIDER: 'smtp',
  EMAIL_FROM: 'Ayava Intern OS <noreply@ayavacreatives.com>',
  SMTP_HOST: 'smtp.hostinger.com',
  SMTP_USER: 'noreply@ayavacreatives.com',
  SMTP_PASSWORD: 'mailbox-password',
}

/** Loads email.service with a fresh config built from `env`. */
function loadEmailService(env: Record<string, string>) {
  let service!: typeof import('@/server/services/email.service')
  const saved = { ...process.env }
  jest.isolateModules(() => {
    process.env = { ...saved, ...env }
    service = jest.requireActual('@/server/services/email.service')
  })
  process.env = saved
  return service.emailService
}

const message = {
  to: 'intern@example.com',
  subject: 'Welcome',
  text: 'Accept: https://x/invite/SECRET-TOKEN',
  html: '<p>SECRET-TOKEN</p>',
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('email configuration', () => {
  it('accepts smtp as a provider and defaults to TLS on port 465', () => {
    const env = parseEnv(SMTP_ENV)
    expect(env.EMAIL_PROVIDER).toBe('smtp')
    expect(env.SMTP_PORT).toBeUndefined()
    expect(parseEnv({ ...SMTP_ENV, SMTP_PORT: '587', SMTP_SECURE: 'false' })).toMatchObject({
      SMTP_PORT: 587,
      SMTP_SECURE: false,
    })
  })

  it('rejects unknown providers and invalid ports', () => {
    expect(() => parseEnv({ EMAIL_PROVIDER: 'gmail' })).toThrow(/EMAIL_PROVIDER/)
    expect(() => parseEnv({ SMTP_PORT: 'abc' })).toThrow(/SMTP_PORT/)
    expect(() => parseEnv({ SMTP_PORT: '70000' })).toThrow(/SMTP_PORT/)
  })

  it('is configured only when every required SMTP setting is present', () => {
    expect(loadEmailService(SMTP_ENV).isConfigured()).toBe(true)
    for (const missing of ['EMAIL_FROM', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD']) {
      expect(loadEmailService({ ...SMTP_ENV, [missing]: '' }).isConfigured()).toBe(false)
    }
    expect(loadEmailService({ EMAIL_PROVIDER: '', EMAIL_FROM: 'x@y.z' }).isConfigured()).toBe(false)
    expect(
      loadEmailService({ EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: 're_x', EMAIL_FROM: 'x@y.z' }).isConfigured(),
    ).toBe(true)
  })
})

describe('option settings pasted into hosting dashboards', () => {
  it('ignores quotes, spaces and capitals', () => {
    expect(parseEnv({ STORAGE_PROVIDER: ' "Supabase" ', EMAIL_PROVIDER: "'SMTP'" })).toMatchObject({
      STORAGE_PROVIDER: 'supabase',
      EMAIL_PROVIDER: 'smtp',
    })
  })

  it('treats blank or missing values as the default', () => {
    const empty = parseEnv({})
    expect(empty).toMatchObject({ STORAGE_PROVIDER: 'local', LOG_LEVEL: 'info' })
    expect(empty.EMAIL_PROVIDER).toBeUndefined()
    expect(parseEnv({ STORAGE_PROVIDER: '', EMAIL_PROVIDER: '', LOG_LEVEL: ' ' })).toMatchObject({
      STORAGE_PROVIDER: 'local',
      EMAIL_PROVIDER: undefined,
      LOG_LEVEL: 'info',
    })
  })

  it('explains an invalid value with the allowed options', () => {
    expect(() => parseEnv({ STORAGE_PROVIDER: 's3' })).toThrow(
      'STORAGE_PROVIDER: must be one of local, supabase (got "s3")',
    )
  })
})

describe('SMTP delivery', () => {
  it('sends through the configured server with TLS on 465', async () => {
    sendMail.mockResolvedValue({ messageId: '1' })
    await loadEmailService(SMTP_ENV).send(message)
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.hostinger.com',
        port: 465,
        secure: true,
        auth: { user: 'noreply@ayavacreatives.com', pass: 'mailbox-password' },
      }),
    )
    expect(sendMail).toHaveBeenCalledWith({ from: SMTP_ENV.EMAIL_FROM, ...message })
  })

  it('uses STARTTLS and requires encryption on port 587', async () => {
    sendMail.mockResolvedValue({ messageId: '1' })
    await loadEmailService({ ...SMTP_ENV, SMTP_PORT: '587' }).send(message)
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 587, secure: false, requireTLS: true }),
    )
  })

  it('reports failures without leaking the message, token or password', async () => {
    sendMail.mockRejectedValue(
      Object.assign(new Error('535 Authentication failed for mailbox-password'), { code: 'EAUTH', responseCode: 535 }),
    )
    await expect(loadEmailService(SMTP_ENV).send(message)).rejects.toThrow('Email could not be sent')
    expect(logError).toHaveBeenCalledTimes(1)
    const logged = JSON.stringify(logError.mock.calls[0])
    expect(logged).toContain('EAUTH')
    expect(logged).not.toContain('SECRET-TOKEN')
    expect(logged).not.toContain('mailbox-password')
  })

  it('refuses to send when not configured', async () => {
    await expect(loadEmailService({ EMAIL_PROVIDER: 'smtp', EMAIL_FROM: '' }).send(message)).rejects.toThrow(
      /not configured/,
    )
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('verifies the SMTP login without sending', async () => {
    verify.mockResolvedValue(true)
    await loadEmailService(SMTP_ENV).verifySmtp()
    expect(verify).toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
    await expect(
      loadEmailService({ EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: 'x', EMAIL_FROM: 'x@y.z' }).verifySmtp(),
    ).rejects.toThrow(/SMTP is not configured/)
  })
})
