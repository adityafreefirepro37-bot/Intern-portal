/**
 * Pure helpers for analytics: month buckets, rates and CSV rows.
 */

export const PERIOD_OPTIONS = [3, 6, 12] as const
export type PeriodMonths = (typeof PERIOD_OPTIONS)[number]

export function parsePeriod(value: string | undefined): PeriodMonths {
  const n = Number(value)
  return (PERIOD_OPTIONS as readonly number[]).includes(n) ? (n as PeriodMonths) : 6
}

/** The last `months` month keys ("YYYY-MM"), oldest first, ending with the month of `today`. */
export function monthKeys(today: Date, months: number): string[] {
  const keys: string[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1))
    keys.push(d.toISOString().slice(0, 7))
  }
  return keys
}

/** "2026-11" → "Nov" (or "Nov 2026" when `withYear`). */
export function monthLabel(key: string, withYear = false): string {
  const d = new Date(`${key}-01T00:00:00Z`)
  return new Intl.DateTimeFormat('en-IN', { month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(d)
}

/** Rows keyed by month → a value for every month in `keys` (missing months are 0). */
export function fillMonths<T extends { month: string }>(keys: string[], rows: T[], pick: (row: T) => number): number[] {
  const byMonth = new Map(rows.map((r) => [r.month, pick(r)]))
  return keys.map((k) => byMonth.get(k) ?? 0)
}

/** Whole-number percentage, or null when there is nothing to divide by. */
export function rate(part: number, total: number): number | null {
  return total > 0 ? Math.round((part / total) * 100) : null
}

/** Neutralizes spreadsheet formulas (cells starting with = + - @ get a leading '). */
export function csvCell(value: string | number | null): string {
  if (value === null) return ''
  if (typeof value === 'number') return String(value)
  let text = value
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows: (string | number | null)[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
