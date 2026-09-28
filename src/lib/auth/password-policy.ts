/**
 * Password policy (shared by client and server; the server decision is final).
 *
 * Follows current NIST SP 800-63B guidance: length matters more than
 * composition rules, so we require a minimum length (configurable, default 10)
 * and reject passwords that are trivially guessable, instead of demanding
 * arbitrary symbol/number mixes.
 */

export const PASSWORD_MAX_LENGTH = 128

const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'qwertyuiop',
  'iloveyou',
  'admin123',
  'welcome123',
  'letmein123',
  'abc12345',
  'football',
  'baseball',
  'sunshine1',
  'princess1',
  'trustno1',
  'ayava123',
  'ayavacreatives',
  'interns123',
  'changeme',
  'changeme123',
])

export interface PasswordCheck {
  valid: boolean
  errors: string[]
  strength: 'weak' | 'fair' | 'good' | 'strong'
}

export function checkPassword(
  password: string,
  options: { minLength: number; email?: string | null; name?: string | null } = { minLength: 10 },
): PasswordCheck {
  const errors: string[] = []
  const value = typeof password === 'string' ? password : ''
  const lower = value.toLowerCase()

  if (value.length < options.minLength) errors.push(`Use at least ${options.minLength} characters`)
  if (value.length > PASSWORD_MAX_LENGTH) errors.push(`Use at most ${PASSWORD_MAX_LENGTH} characters`)
  if (value.length > 0 && new Set(value).size <= 2) errors.push('Avoid repeating the same character')
  if (COMMON_PASSWORDS.has(lower)) errors.push('This password is too common')

  const emailLocal = options.email?.split('@')[0]?.toLowerCase()
  if (emailLocal && emailLocal.length >= 4 && lower.includes(emailLocal))
    errors.push('Don’t include your email address')
  const first = options.name?.trim().split(/\s+/)[0]?.toLowerCase()
  if (first && first.length >= 4 && lower.includes(first)) errors.push('Don’t include your name')

  return { valid: errors.length === 0, errors, strength: estimateStrength(value) }
}

function estimateStrength(password: string): PasswordCheck['strength'] {
  let classes = 0
  if (/[a-z]/.test(password)) classes += 1
  if (/[A-Z]/.test(password)) classes += 1
  if (/\d/.test(password)) classes += 1
  if (/[^A-Za-z0-9]/.test(password)) classes += 1
  const score = password.length + classes * 3
  if (password.length < 10 || score < 16) return 'weak'
  if (score < 20) return 'fair'
  if (score < 26) return 'good'
  return 'strong'
}
