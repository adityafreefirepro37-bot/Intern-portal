/**
 * Employee codes: `${prefix}${number padded to width}`, e.g. AYV-INT-0001.
 * The number comes from an atomic database counter (code_counters), never
 * from counting rows, so concurrent creations can't collide; a unique
 * constraint on (organization_id, employee_code) is the final guarantee.
 */
export const EMPLOYEE_CODE_COUNTER_KEY = 'intern.employee_code'
export const DEFAULT_EMPLOYEE_CODE_PREFIX = 'AYV-INT-'
export const EMPLOYEE_CODE_WIDTH = 4

export function formatEmployeeCode(value: number, prefix = DEFAULT_EMPLOYEE_CODE_PREFIX, width = EMPLOYEE_CODE_WIDTH): string {
  if (!Number.isInteger(value) || value < 1) throw new Error('Employee code number must be a positive integer')
  return `${prefix}${String(value).padStart(width, '0')}`
}

/** Numeric part of a code with the given prefix, or null. */
export function parseEmployeeCode(code: string, prefix = DEFAULT_EMPLOYEE_CODE_PREFIX): number | null {
  if (!code.startsWith(prefix)) return null
  const digits = code.slice(prefix.length)
  return /^\d+$/.test(digits) ? Number(digits) : null
}
