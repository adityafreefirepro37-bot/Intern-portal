/**
 * Calendar-date helpers for internship business logic.
 *
 * Dates such as joining/end/due dates are stored as SQL `date` values (UTC
 * midnight in JS). "Today" is always computed in the organization's timezone,
 * never the browser's, so a deadline flips to overdue at the same moment for
 * everyone in the organization.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Today's calendar date in `timeZone`, as a UTC-midnight Date. */
export function todayIn(timeZone: string, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  return new Date(`${parts}T00:00:00.000Z`)
}

/** Normalizes any Date to its UTC calendar date (UTC midnight). */
export function toDateOnly(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((toDateOnly(to).getTime() - toDateOnly(from).getTime()) / DAY_MS)
}

export function addDays(date: Date, days: number): Date {
  return new Date(toDateOnly(date).getTime() + days * DAY_MS)
}

/** Parses "YYYY-MM-DD" (already validated) into a UTC-midnight Date. */
export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

export function formatDateOnly(value: Date): string {
  return toDateOnly(value).toISOString().slice(0, 10)
}
