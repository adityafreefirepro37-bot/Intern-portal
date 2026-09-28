/**
 * Helpers for keeping sensitive fields out of responses and UI.
 * Services return explicit DTOs; these helpers cover the remaining cases.
 */

export function maskValue(value: string | null | undefined, visible = 4): string | null {
  if (!value) return null
  if (value.length <= visible) return '•'.repeat(Math.max(value.length, 4))
  return `${'•'.repeat(6)}${value.slice(-visible)}`
}

export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const [local, domain] = email.split('@')
  if (!domain) return maskValue(email)
  const head = local.slice(0, Math.min(2, local.length))
  return `${head}${'•'.repeat(Math.max(local.length - head.length, 3))}@${domain}`
}

export function pick<T extends Record<string, unknown>, K extends keyof T>(record: T, keys: readonly K[]): Pick<T, K> {
  const output = {} as Pick<T, K>
  for (const key of keys) {
    if (key in record) output[key] = record[key]
  }
  return output
}

/**
 * Fields that must never be sent to the browser as part of a user object.
 * (Passwords are not stored at all; credentials live in the auth provider.)
 */
export const SERVER_ONLY_USER_FIELDS = ['auth_user_id', 'deleted_at'] as const

export function omitServerOnlyUserFields<T extends Record<string, unknown>>(user: T) {
  const copy: Record<string, unknown> = { ...user }
  for (const field of SERVER_ONLY_USER_FIELDS) delete copy[field]
  return copy as Omit<T, (typeof SERVER_ONLY_USER_FIELDS)[number]>
}
