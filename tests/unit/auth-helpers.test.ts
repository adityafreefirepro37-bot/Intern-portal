import { checkPassword } from '@/lib/auth/password-policy'
import { safeNextPath } from '@/lib/auth/redirect'
import { describeUserAgent } from '@/lib/http/request-meta'
import { buildContentSecurityPolicy, generateNonce } from '@/lib/security/csp'

describe('password policy', () => {
  const opts = { minLength: 10 }

  it('accepts long passphrases without composition rules', () => {
    expect(checkPassword('correct horse battery', opts).valid).toBe(true)
    expect(checkPassword('Tr1cky-Pa55word!', opts)).toMatchObject({ valid: true, strength: 'strong' })
  })

  it('rejects short, repetitive, common and personal passwords', () => {
    expect(checkPassword('short1', opts).errors).toContain('Use at least 10 characters')
    expect(checkPassword('aaaaaaaaaaaa', opts).errors).toContain('Avoid repeating the same character')
    expect(checkPassword('password123', opts).errors).toContain('This password is too common')
    expect(checkPassword('meera.iyer-2026!', { minLength: 10, email: 'meera.iyer@ayava.com' }).errors).toContain(
      'Don’t include your email address',
    )
    expect(checkPassword('aanya-rocks-2026', { minLength: 10, name: 'Aanya Sharma' }).errors).toContain(
      'Don’t include your name',
    )
    expect(checkPassword('x'.repeat(129) + 'yz', opts).errors).toContain('Use at most 128 characters')
  })

  it('respects the configured minimum length', () => {
    expect(checkPassword('abcdefgh12', { minLength: 12 }).valid).toBe(false)
  })
})

describe('safeNextPath (open-redirect protection)', () => {
  it('allows same-site paths with query strings', () => {
    expect(safeNextPath('/tasks?status=IN_REVIEW')).toBe('/tasks?status=IN_REVIEW')
    expect(safeNextPath('/interns/abc')).toBe('/interns/abc')
  })

  it('rejects external, protocol-relative and malformed destinations', () => {
    for (const bad of [
      'https://evil.com',
      '//evil.com',
      '/\\evil.com',
      'javascript:alert(1)',
      'evil.com',
      '/x\u0000y',
      '/a\r\nSet-Cookie:x',
      '',
      undefined,
      42,
    ]) {
      expect(safeNextPath(bad)).toBe('/')
    }
  })

  it('keeps percent-encoded characters encoded (inert in a Location header)', () => {
    expect(safeNextPath('/%0d%0aSet-Cookie:x')).toBe('/%0d%0aSet-Cookie:x')
  })

  it('never returns to auth pages', () => {
    expect(safeNextPath('/login')).toBe('/')
    expect(safeNextPath('/reset-password')).toBe('/')
    expect(safeNextPath('/auth/confirm?token_hash=x')).toBe('/')
  })
})

describe('Content Security Policy', () => {
  it('uses a nonce and no unsafe-inline for scripts', () => {
    const nonce = generateNonce()
    const csp = buildContentSecurityPolicy({ nonce, isDev: false })
    const script = csp.split('; ').find((directive) => directive.startsWith('script-src'))!
    expect(script).toContain(`'nonce-${nonce}'`)
    expect(script).toContain("'strict-dynamic'")
    expect(script).not.toContain('unsafe-inline')
    expect(script).not.toContain('unsafe-eval')
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
  })

  it('adds unsafe-eval only in development and allows the Supabase origin', () => {
    const csp = buildContentSecurityPolicy({ nonce: 'n', isDev: true, supabaseOrigin: 'https://abc.supabase.co' })
    expect(csp).toContain("'unsafe-eval'")
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co")
  })

  it('generates unpredictable nonces', () => {
    const nonces = new Set(Array.from({ length: 50 }, generateNonce))
    expect(nonces.size).toBe(50)
  })
})

describe('describeUserAgent', () => {
  it('labels common browsers without storing raw strings in the UI', () => {
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0',
      ),
    ).toBe('Edge on Windows')
    expect(
      describeUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1',
      ),
    ).toBe('Safari on iOS')
    expect(describeUserAgent(null)).toBe('Unknown device')
  })
})
