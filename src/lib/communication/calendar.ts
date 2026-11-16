/**
 * Calendar shapes and pure date helpers shared by the calendar service and UI.
 * Calendar dates are UTC-midnight `Date`s (as everywhere in the HR code);
 * instants (meeting times) are bucketed into days in the organization timezone.
 */

export const CALENDAR_VIEWS = ['month', 'week', 'agenda'] as const
export type CalendarView = (typeof CALENDAR_VIEWS)[number]

export type CalendarItemKind =
  | 'MEETING'
  | 'EVENT'
  | 'TASK'
  | 'MILESTONE'
  | 'LEAVE'
  | 'HOLIDAY'
  | 'LEARNING'
  | 'GOAL'
  | 'ONBOARDING'

export interface CalendarItem {
  /** Stable key for React lists. */
  key: string
  kind: CalendarItemKind
  title: string
  /** Calendar day (YYYY-MM-DD) in the organization timezone. */
  day: string
  /** Start instant for timed items (meetings, timed events); null for all-day items. */
  start: Date | null
  end: Date | null
  href: string | null
  /** Short secondary text (location, project, leave type…). */
  detail?: string | null
  /** e.g. a cancelled meeting or a declined invitation. */
  muted?: boolean
}

export const CALENDAR_KIND_LABELS: Record<CalendarItemKind, string> = {
  MEETING: 'Meeting',
  EVENT: 'Event',
  TASK: 'Task due',
  MILESTONE: 'Milestone',
  LEAVE: 'Leave',
  HOLIDAY: 'Holiday',
  LEARNING: 'Learning due',
  GOAL: 'Goal target',
  ONBOARDING: 'Onboarding due',
}

/** Tones pair with the always-visible text label; colour never carries meaning alone. */
export const CALENDAR_KIND_TONE: Record<CalendarItemKind, string> = {
  MEETING: 'bg-primary/10 text-primary',
  EVENT: 'bg-info/12 text-info',
  TASK: 'bg-warning/14 text-warning',
  MILESTONE: 'bg-secondary text-secondary-foreground',
  LEAVE: 'bg-success/12 text-success',
  HOLIDAY: 'bg-muted text-muted-foreground',
  LEARNING: 'bg-secondary text-secondary-foreground',
  GOAL: 'bg-secondary text-secondary-foreground',
  ONBOARDING: 'bg-secondary text-secondary-foreground',
}

export const EVENT_TYPE_LABELS = {
  MEETING: 'Meeting',
  DEADLINE: 'Deadline',
  TRAINING: 'Training',
  REVIEW: 'Review',
  LEAVE: 'Leave',
  HOLIDAY: 'Holiday',
  OTHER: 'Company event',
} as const
export type CalendarEventTypeValue = keyof typeof EVENT_TYPE_LABELS
/** Types people create by hand (leave and holidays have their own modules). */
export const CREATABLE_EVENT_TYPES: CalendarEventTypeValue[] = ['OTHER', 'TRAINING', 'DEADLINE', 'REVIEW']

const DAY_MS = 86_400_000

/** "YYYY-MM-DD" → UTC midnight; invalid → null. */
export function parseDay(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date
}

export function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

/** Monday of the week containing `date` (weeks start on Monday). */
export function startOfWeek(date: Date): Date {
  const dow = (date.getUTCDay() + 6) % 7 // Monday = 0
  return addDaysUtc(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())), -dow)
}

/** The 7 days (Mon–Sun) of the week containing `date`. */
export function weekDays(date: Date): Date[] {
  const start = startOfWeek(date)
  return Array.from({ length: 7 }, (_, i) => addDaysUtc(start, i))
}

/** Whole weeks (Mon–Sun) covering the month that contains `date`: 4–6 rows of 7 days. */
export function monthGrid(date: Date): Date[][] {
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
  const weeks: Date[][] = []
  for (let day = startOfWeek(first); day <= last; day = addDaysUtc(day, 7)) weeks.push(weekDays(day))
  return weeks
}

/**
 * The days a view covers and the dates its "previous" / "next" buttons go to.
 * Agenda shows 30 days from the anchor.
 */
export function viewRange(view: CalendarView, anchor: Date): { days: Date[]; prev: Date; next: Date } {
  if (view === 'week') {
    const days = weekDays(anchor)
    return { days, prev: addDaysUtc(days[0], -7), next: addDaysUtc(days[0], 7) }
  }
  if (view === 'agenda') {
    const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()))
    return {
      days: Array.from({ length: 30 }, (_, i) => addDaysUtc(start, i)),
      prev: addDaysUtc(start, -30),
      next: addDaysUtc(start, 30),
    }
  }
  const days = monthGrid(anchor).flat()
  return {
    days,
    prev: new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 1, 1)),
    next: new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1)),
  }
}

/** Calendar day (YYYY-MM-DD) of an instant in `timeZone`. */
export function dayKeyIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    instant,
  )
}

/** Items sorted for display: all-day first, then by start time, then title. */
export function sortItems(items: CalendarItem[]): CalendarItem[] {
  return [...items].sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      (a.start ? 1 : 0) - (b.start ? 1 : 0) ||
      (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0) ||
      a.title.localeCompare(b.title),
  )
}

/** Do two time ranges overlap (end-exclusive)? */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd
}
