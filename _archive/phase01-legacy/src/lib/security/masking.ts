export function maskValue(value: string | null | undefined, visible = 4): string | null {
  if (!value) return null
  if (value.length <= visible) return '•'.repeat(Math.max(value.length, 4))
  return `${'•'.repeat(6)}${value.slice(-visible)}`
}

export function omitUnauthorizedFields<T extends Record<string, unknown>>(
  record: T,
  allowed: readonly (keyof T)[]
): Partial<T> {
  const result: Partial<T> = {}
  for (const key of allowed) {
    if (key in record) {
      result[key] = record[key]
    }
  }
  return result
}

export const SENSITIVE_USER_FIELDS = [
  'passwordHash',
  'auth_user_id',
] as const

export type PublicUserFields = {
  id: string
  email: string
  first_name: string
  last_name: string
  avatar_url: string | null
  phone: string | null
  role: string
  status: string
  department_id: string | null
  team_id: string | null
  organization_id: string
  email_verified: Date | null
  last_login_at: Date | null
}

export function toPublicUser(user: {
  id: string
  email: string
  first_name: string
  last_name: string
  avatar_url: string | null
  phone: string | null
  role: string
  status: string
  department_id: string | null
  team_id: string | null
  organization_id: string
  email_verified: Date | null
  last_login_at: Date | null
}): PublicUserFields {
  return {
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    avatar_url: user.avatar_url,
    phone: user.phone,
    role: user.role,
    status: user.status,
    department_id: user.department_id,
    team_id: user.team_id,
    organization_id: user.organization_id,
    email_verified: user.email_verified,
    last_login_at: user.last_login_at,
  }
}
