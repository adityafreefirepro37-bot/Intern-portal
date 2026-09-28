import { differenceInCalendarDays, formatDistanceToNowStrict } from 'date-fns'

/** Up to two uppercase initials from a display name. */
export function initials(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : ''
  return (first + last).toUpperCase()
}

export function fullName(user: { first_name: string; last_name: string; display_name?: string | null }): string {
  return user.display_name?.trim() || `${user.first_name} ${user.last_name}`.trim()
}

/** "Good morning" / "Good afternoon" / "Good evening" in the given IANA zone. */
export function greeting(now: Date = new Date(), timeZone = 'UTC'): string {
  let hour: number
  try {
    hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(now))
  } catch {
    hour = now.getUTCHours()
  }
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function formatDate(value: Date | string | null | undefined, timeZone?: string): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(date)
}

/** Human description of a due date relative to now: "Due today", "Due in 3 days", "Overdue by 2 days". */
export function describeDue(due: Date, now: Date = new Date()): { label: string; tone: 'overdue' | 'soon' | 'later' } {
  const days = differenceInCalendarDays(due, now)
  if (days < 0) return { label: `Overdue by ${pluralize(-days, 'day')}`, tone: 'overdue' }
  if (days === 0) return { label: 'Due today', tone: 'soon' }
  if (days === 1) return { label: 'Due tomorrow', tone: 'soon' }
  return { label: `Due in ${pluralize(days, 'day')}`, tone: days <= 3 ? 'soon' : 'later' }
}

export function timeAgo(value: Date, now: Date = new Date()): string {
  if (Math.abs(now.getTime() - value.getTime()) < 60_000) return 'just now'
  return formatDistanceToNowStrict(value, { addSuffix: true })
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/** "IN_REVIEW" → "In review" */
export function humanizeEnum(value: string): string {
  const text = value.toLowerCase().replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function percent(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((part / total) * 100)
}

/** Formats a calendar date (SQL `date`, stored as UTC midnight) without timezone shifting. */
export function formatDay(value: Date | string | null | undefined): string {
  return formatDate(value, 'UTC')
}
