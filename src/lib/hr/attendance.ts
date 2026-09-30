import type { AttendanceStatus } from '@prisma/client'
import { dayKey, minutesOfDay, parseClock } from './time'

/**
 * Attendance rules (pure). Configured per organization in HR settings; the
 * defaults below apply until HR changes them.
 */
export interface AttendanceRules {
  /** Expected start of the working day, "HH:MM" in the organization timezone. */
  workStart: string
  /** Minutes after workStart before a check-in counts as late. */
  graceMinutes: number
  /** Worked minutes (breaks excluded) for a full day. */
  fullDayMinutes: number
  /** Worked minutes for a half day; less than this counts as absent. */
  halfDayMinutes: number
  /** Working weekdays, 0 = Sunday … 6 = Saturday. */
  workingDays: number[]
}

export const DEFAULT_ATTENDANCE_RULES: AttendanceRules = {
  workStart: '09:30',
  graceMinutes: 15,
  fullDayMinutes: 420,
  halfDayMinutes: 210,
  workingDays: [1, 2, 3, 4, 5],
}

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: 'Present',
  LATE: 'Late',
  HALF_DAY: 'Half day',
  ABSENT: 'Absent',
  ON_LEAVE: 'On leave',
  HOLIDAY: 'Holiday',
  WEEKEND: 'Weekend',
  MISSING: 'Missing check-out',
}

/** Short text codes so the calendar never relies on colour alone. */
export const ATTENDANCE_STATUS_CODES: Record<AttendanceStatus, string> = {
  PRESENT: 'P',
  LATE: 'L',
  HALF_DAY: 'H',
  ABSENT: 'A',
  ON_LEAVE: 'LV',
  HOLIDAY: 'HO',
  WEEKEND: 'W',
  MISSING: 'M',
}

export function isWorkingDay(date: Date, rules: Pick<AttendanceRules, 'workingDays'>): boolean {
  return rules.workingDays.includes(date.getUTCDay())
}

/** Lateness of a check-in against the rules (evaluated in the organization timezone). */
export function lateness(checkIn: Date, rules: AttendanceRules, timeZone: string) {
  const start = parseClock(rules.workStart)
  const minutes = minutesOfDay(checkIn, timeZone)
  const late = minutes > start + rules.graceMinutes
  return { isLate: late, lateMinutes: late ? minutes - start : null }
}

/** Worked minutes between check-in and check-out, excluding breaks (never negative). */
export function workedMinutes(checkIn: Date, checkOut: Date, breakMinutes: number): number {
  const gross = Math.floor((checkOut.getTime() - checkIn.getTime()) / 60_000)
  return Math.max(0, gross - Math.max(0, breakMinutes))
}

/** Total minutes of closed breaks (an open break counts up to `until`). */
export function breakTotal(breaks: readonly { started_at: Date; ended_at: Date | null }[], until: Date): number {
  return breaks.reduce((sum, b) => {
    const end = b.ended_at ?? until
    return sum + Math.max(0, Math.floor((end.getTime() - b.started_at.getTime()) / 60_000))
  }, 0)
}

/**
 * The status of a day's record from its times.
 *  - open (no check-out): PRESENT or LATE (provisional)
 *  - worked ≥ full day: PRESENT, or LATE when the check-in was late
 *  - worked ≥ half day: HALF_DAY
 *  - otherwise ABSENT
 */
export function computeStatus(input: {
  checkIn: Date
  checkOut: Date | null
  breakMinutes: number
  rules: AttendanceRules
  timeZone: string
}): { status: AttendanceStatus; totalMinutes: number | null; isLate: boolean; lateMinutes: number | null } {
  const late = lateness(input.checkIn, input.rules, input.timeZone)
  if (!input.checkOut) return { status: late.isLate ? 'LATE' : 'PRESENT', totalMinutes: null, ...late }
  const total = workedMinutes(input.checkIn, input.checkOut, input.breakMinutes)
  const status: AttendanceStatus =
    total >= input.rules.fullDayMinutes
      ? late.isLate
        ? 'LATE'
        : 'PRESENT'
      : total >= input.rules.halfDayMinutes
        ? 'HALF_DAY'
        : 'ABSENT'
  return { status, totalMinutes: total, ...late }
}

export interface DayRecord {
  status: AttendanceStatus
  check_in_at: Date | null
  check_out_at: Date | null
}

/**
 * The status shown for one calendar day. Absence and missing check-outs are
 * only ever derived for days that have passed; today and future days without
 * a record have no status yet (null).
 */
export function resolveDay(input: {
  date: Date
  today: Date
  record: DayRecord | null
  onLeave: boolean
  holiday: boolean
  rules: Pick<AttendanceRules, 'workingDays'>
  /** Days outside the internship (before joining / after it ended) are not tracked. */
  trackedFrom?: Date | null
  trackedTo?: Date | null
}): AttendanceStatus | null {
  const { date, today, record } = input
  if (record) {
    if (record.check_in_at && !record.check_out_at && date < today) return 'MISSING'
    return record.status
  }
  if (input.onLeave) return 'ON_LEAVE'
  if (input.holiday) return 'HOLIDAY'
  if (!isWorkingDay(date, input.rules)) return 'WEEKEND'
  if (date >= today) return null
  if (input.trackedFrom && date < input.trackedFrom) return null
  if (input.trackedTo && date > input.trackedTo) return null
  return 'ABSENT'
}

export interface MonthlySummary {
  workingDays: number
  present: number
  late: number
  halfDay: number
  absent: number
  onLeave: number
  holidays: number
  missing: number
  workedMinutes: number
  /** Attended working days (present, late, half day as ½) ÷ elapsed working days that were due. */
  attendanceRate: number | null
}

export function summarize(
  days: readonly { date: Date; status: AttendanceStatus | null; totalMinutes?: number | null }[],
): MonthlySummary {
  const count = (status: AttendanceStatus) => days.filter((d) => d.status === status).length
  const present = count('PRESENT')
  const late = count('LATE')
  const halfDay = count('HALF_DAY')
  const absent = count('ABSENT')
  const missing = count('MISSING')
  const due = present + late + halfDay + absent + missing
  return {
    workingDays: days.filter((d) => d.status && !['WEEKEND', 'HOLIDAY'].includes(d.status)).length,
    present,
    late,
    halfDay,
    absent,
    onLeave: count('ON_LEAVE'),
    holidays: count('HOLIDAY'),
    missing,
    workedMinutes: days.reduce((sum, d) => sum + (d.totalMinutes ?? 0), 0),
    attendanceRate: due === 0 ? null : Math.round(((present + late + missing + halfDay / 2) / due) * 100),
  }
}

/** Set of "YYYY-MM-DD" dates covered by leave ranges. */
export function leaveDaySet(ranges: readonly { start_date: Date; end_date: Date }[]): Set<string> {
  const set = new Set<string>()
  for (const range of ranges) {
    for (let t = range.start_date.getTime(); t <= range.end_date.getTime(); t += 86_400_000) {
      set.add(dayKey(new Date(t)))
    }
  }
  return set
}
