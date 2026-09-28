import { Logger, REDACTED, redact, type LogLevel } from '@/lib/logging'

describe('redact', () => {
  it('removes sensitive keys at any depth', () => {
    const output = redact({
      userId: 'u1',
      password: 'hunter2',
      nested: { apiKey: 'sk-live', authorization: 'Bearer x', ok: true },
      list: [{ sessionToken: 't' }],
      profile: { date_of_birth: '2001-01-01' },
    }) as Record<string, unknown>

    expect(output.userId).toBe('u1')
    expect(output.password).toBe(REDACTED)
    expect(output.nested).toEqual({ apiKey: REDACTED, authorization: REDACTED, ok: true })
    expect(output.list).toEqual([{ sessionToken: REDACTED }])
    expect(output.profile).toEqual({ date_of_birth: REDACTED })
  })

  it('serializes errors to name, message and stack', () => {
    const output = redact(new TypeError('bad')) as Record<string, unknown>
    expect(output.name).toBe('TypeError')
    expect(output.message).toBe('bad')
  })
})

describe('Logger', () => {
  function capture(minLevel: LogLevel) {
    const lines: { level: LogLevel; entry: Record<string, unknown> }[] = []
    const logger = new Logger(minLevel, { write: (level, line) => lines.push({ level, entry: JSON.parse(line) }) })
    return { logger, lines }
  }

  it('writes structured JSON with redacted context', () => {
    const { logger, lines } = capture('debug')
    logger.info('User invited', { email: 'a@b.com', token: 'abc' })
    expect(lines).toHaveLength(1)
    expect(lines[0].entry).toMatchObject({ level: 'info', message: 'User invited', email: 'a@b.com', token: REDACTED })
    expect(typeof lines[0].entry.time).toBe('string')
  })

  it('respects the minimum level', () => {
    const { logger, lines } = capture('warn')
    logger.debug('hidden')
    logger.info('hidden')
    logger.warn('shown')
    logger.error('shown')
    expect(lines.map((line) => line.level)).toEqual(['warn', 'error'])
  })

  it('merges child bindings', () => {
    const { logger, lines } = capture('info')
    logger.child({ requestId: 'r1' }).info('hello', { route: '/api/search' })
    expect(lines[0].entry).toMatchObject({ requestId: 'r1', route: '/api/search' })
  })
})
