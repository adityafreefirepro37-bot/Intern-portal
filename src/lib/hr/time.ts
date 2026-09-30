/**
 * Wall-clock helpers in an IANA timezone. Attendance timestamps are stored as
 * instants (timestamptz); rules such as "late after 09:45" are evaluated in the
 * organization's timezone, never the server's or the browser's.
 */

interface Parts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

function partsIn(instant: Date, timeZone: string): Parts {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  )
  return { year: values.year, month: values.month, day: values.day, hour: values.hour % 24, minute: values.minute }
}

/** Minutes since local midnight of `instant` in `timeZone`. */
export function minutesOfDay(instant: Date, timeZone: string): number {
  const { hour, minute } = partsIn(instant, timeZone)
  return hour * 60 + minute
}

/** "HH:MM" → minutes since midnight (input already validated). */
export function parseClock(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

/** Minutes since midnight → "HH:MM". */
export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** The instant at local wall-clock time `clock` ("HH:MM") on calendar `date` (UTC midnight) in `timeZone`. */
export function instantAt(date: Date, clock: string, timeZone: string): Date {
  const wanted = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) + parseClock(clock) * 60_000
  let guess = wanted
  // Two passes settle DST boundaries; zones without DST converge in one.
  for (let i = 0; i < 2; i++) {
    const p = partsIn(new Date(guess), timeZone)
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
    guess += wanted - shown
  }
  return new Date(guess)
}

/** "HH:MM" of an instant in `timeZone` (for inputs and display). */
export function clockIn(instant: Date, timeZone: string): string {
  return formatClock(minutesOfDay(instant, timeZone))
}

/** Display time, e.g. "9:47 am". */
export function formatTime(instant: Date | string | null | undefined, timeZone: string): string {
  if (!instant) return '—'
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(instant))
}

/** "7h 25m" */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** "2026-09" → first day of that month (UTC midnight); invalid input → null. */
export function parseMonth(value: string | undefined | null): Date | null {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null
  return new Date(`${value}-01T00:00:00.000Z`)
}

export function formatMonth(date: Date): string {
  return date.toISOString().slice(0, 7)
}

export function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
}

/** [first day, last day] of the month containing `date` (UTC calendar dates). */
export function monthRange(date: Date): [Date, Date] {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
  return [start, end]
}

export function shiftMonth(date: Date, delta: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1))
}

/** Every calendar date from `start` to `end`, inclusive. */
export function eachDay(start: Date, end: Date): Date[] {
  const days: Date[] = []
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) days.push(new Date(t))
  return days
}

export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}
