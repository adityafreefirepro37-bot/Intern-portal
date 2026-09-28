import { verifyCsrf } from '@/lib/security/csrf'
import { maskEmail, maskValue, omitServerOnlyUserFields } from '@/lib/security/masking'
import { MemoryRateLimitStore } from '@/lib/security/rate-limit'
import { generateSecureToken, hashToken, tokensEqual } from '@/lib/security/tokens'

describe('verifyCsrf', () => {
  const base = { appUrl: 'https://intern.ayava.test', csrfCookie: 'abc', csrfHeader: 'abc' }

  it('lets safe methods through', () => {
    expect(
      verifyCsrf({ ...base, method: 'GET', origin: null, referer: null, csrfCookie: null, csrfHeader: null }).valid,
    ).toBe(true)
  })

  it('requires a same-origin request and matching token for mutations', () => {
    expect(verifyCsrf({ ...base, method: 'POST', origin: 'https://intern.ayava.test', referer: null }).valid).toBe(true)
    expect(verifyCsrf({ ...base, method: 'POST', origin: 'https://evil.test', referer: null })).toEqual({
      valid: false,
      reason: 'Invalid origin',
    })
    expect(
      verifyCsrf({ ...base, method: 'DELETE', origin: 'https://intern.ayava.test', referer: null, csrfHeader: 'xyz' })
        .reason,
    ).toBe('Invalid CSRF token')
  })

  it('falls back to the referer origin', () => {
    expect(
      verifyCsrf({ ...base, method: 'PATCH', origin: null, referer: 'https://intern.ayava.test/tasks' }).valid,
    ).toBe(true)
  })
})

describe('MemoryRateLimitStore', () => {
  it('allows up to the limit within a window', async () => {
    const store = new MemoryRateLimitStore()
    const results = []
    for (let i = 0; i < 4; i++) results.push(await store.increment('login:1.2.3.4', 60_000, 3))
    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false])
    expect(results[3].retryAfterSeconds).toBeGreaterThan(0)
  })
})

describe('tokens and masking', () => {
  it('generates unguessable tokens and compares hashes in constant time', () => {
    const token = generateSecureToken()
    expect(token.length).toBeGreaterThanOrEqual(43)
    expect(generateSecureToken()).not.toBe(token)
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/)
    expect(tokensEqual(hashToken(token), hashToken(token))).toBe(true)
    expect(tokensEqual(hashToken(token), hashToken('other'))).toBe(false)
  })

  it('masks sensitive values', () => {
    expect(maskValue('9876543210')).toBe('••••••3210')
    expect(maskEmail('kavya@ayavacreatives.com')).toBe('ka•••@ayavacreatives.com')
    expect(omitServerOnlyUserFields({ id: '1', auth_user_id: 'x', deleted_at: null, email: 'a@b.c' })).toEqual({
      id: '1',
      email: 'a@b.c',
    })
  })
})
