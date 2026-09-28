import { prisma } from '@/lib/db/client'

/**
 * Organization settings (non-secret, JSON values in the `settings` table).
 * Typed getters with defaults so features work before an admin configures them.
 */
async function read(organizationId: string, key: string): Promise<unknown> {
  const row = await prisma.setting.findUnique({
    where: { organization_id_key: { organization_id: organizationId, key } },
    select: { value: true },
  })
  return row?.value
}

export const SETTING_KEYS = {
  endingSoonDays: 'internship.ending_soon_days',
  employeeCodePrefix: 'intern.employee_code_prefix',
} as const

export const settingsService = {
  /** Days before the expected end date when an internship becomes ENDING_SOON (default 14). */
  async endingSoonDays(organizationId: string): Promise<number> {
    const value = (await read(organizationId, SETTING_KEYS.endingSoonDays)) as { days?: unknown } | undefined
    const days = Number(value?.days)
    return Number.isInteger(days) && days >= 1 && days <= 90 ? days : 14
  },

  /** Prefix for generated intern employee codes (default AYV-INT-). */
  async employeeCodePrefix(organizationId: string): Promise<string> {
    const value = (await read(organizationId, SETTING_KEYS.employeeCodePrefix)) as { prefix?: unknown } | undefined
    const prefix = typeof value?.prefix === 'string' ? value.prefix : ''
    return /^[A-Z0-9-]{1,16}$/.test(prefix) ? prefix : 'AYV-INT-'
  },
}
