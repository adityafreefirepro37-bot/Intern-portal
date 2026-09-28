export interface PasswordPolicy {
  minLength: number
  requireLetter: boolean
  requireNumber: boolean
}

export function getPasswordPolicy(): PasswordPolicy {
  const minLength = Number(process.env.AUTH_PASSWORD_MIN_LENGTH ?? 10)
  return {
    minLength: Number.isFinite(minLength) && minLength >= 8 ? minLength : 10,
    requireLetter: true,
    requireNumber: true,
  }
}

export function validatePassword(
  password: string,
  policy: PasswordPolicy = getPasswordPolicy()
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (typeof password !== 'string' || password.length < policy.minLength) {
    errors.push(`Password must be at least ${policy.minLength} characters`)
  }
  if (policy.requireLetter && !/[A-Za-z]/.test(password)) {
    errors.push('Password must include a letter')
  }
  if (policy.requireNumber && !/\d/.test(password)) {
    errors.push('Password must include a number')
  }
  if (password.length > 128) {
    errors.push('Password is too long')
  }
  return { valid: errors.length === 0, errors }
}

export function passwordStrengthLabel(password: string): 'weak' | 'fair' | 'strong' {
  let score = 0
  if (password.length >= 10) score += 1
  if (password.length >= 14) score += 1
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1
  if (/\d/.test(password)) score += 1
  if (/[^A-Za-z0-9]/.test(password)) score += 1
  if (score <= 2) return 'weak'
  if (score <= 3) return 'fair'
  return 'strong'
}
