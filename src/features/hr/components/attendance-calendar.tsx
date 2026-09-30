import type { AttendanceStatus } from '@prisma/client'
import { StatusBadge } from '@/components/common/badges'
import { ATTENDANCE_STATUS_CODES, ATTENDANCE_STATUS_LABELS, type MonthlySummary } from '@/lib/hr/attendance'
import { formatDuration, formatTime } from '@/lib/hr/time'
import { cn, formatDay } from '@/lib/utils'

interface Day {
  date: Date
  key: string
  status: AttendanceStatus | null
  isToday: boolean
  holiday: string | null
  record: {
    checkIn: Date | null
    checkOut: Date | null
    totalMinutes: number | null
    breakMinutes: number
    lateMinutes: number | null
    source: string
  } | null
}

const TINT: Partial<Record<AttendanceStatus, string>> = {
  PRESENT: 'bg-success/12',
  LATE: 'bg-warning/14',
  HALF_DAY: 'bg-warning/10',
  ABSENT: 'bg-destructive/10',
  MISSING: 'bg-warning/14',
  ON_LEAVE: 'bg-info/12',
  HOLIDAY: 'bg-muted',
  WEEKEND: 'bg-muted/60',
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * Month attendance grid. Every day carries a text code (P, L, A…) and a full
 * accessible label, so status never depends on colour; a legend explains the codes.
 */
export function AttendanceCalendar({ days, caption }: { days: Day[]; caption: string }) {
  const lead = days.length ? (days[0].date.getUTCDay() + 6) % 7 : 0
  return (
    <div className="space-y-3">
      <table className="w-full table-fixed border-separate border-spacing-1 text-center">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {WEEKDAYS.map((d) => (
              <th key={d} scope="col" className="text-caption font-medium text-muted-foreground">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chunk<Day | null>([...Array<null>(lead).fill(null), ...days], 7).map((week, i) => (
            <tr key={i}>
              {week.map((day, j) =>
                day ? (
                  <td
                    key={day.key}
                    className={cn(
                      'h-14 rounded-md border align-top sm:h-16',
                      day.status && TINT[day.status],
                      day.isToday && 'ring-2 ring-primary',
                    )}
                  >
                    <span className="sr-only">
                      {formatDay(day.date)}: {day.status ? ATTENDANCE_STATUS_LABELS[day.status] : 'No record'}
                      {day.holiday ? ` (${day.holiday})` : ''}
                      {day.isToday ? ' — today' : ''}
                    </span>
                    <span aria-hidden className="flex h-full flex-col items-center justify-between py-1">
                      <span className="text-caption text-muted-foreground">{day.date.getUTCDate()}</span>
                      <span className="text-small font-semibold">
                        {day.status ? ATTENDANCE_STATUS_CODES[day.status] : ''}
                      </span>
                    </span>
                  </td>
                ) : (
                  <td key={`blank-${i}-${j}`} aria-hidden />
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground">
        {(Object.keys(ATTENDANCE_STATUS_CODES) as AttendanceStatus[]).map((status) => (
          <li key={status} className="flex items-center gap-1.5">
            <span
              className={cn(
                'inline-flex h-5 min-w-6 items-center justify-center rounded border px-1 font-semibold text-foreground',
                TINT[status],
              )}
            >
              {ATTENDANCE_STATUS_CODES[status]}
            </span>
            {ATTENDANCE_STATUS_LABELS[status]}
          </li>
        ))}
      </ul>
    </div>
  )
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    const row = items.slice(i, i + size)
    while (row.length < size) row.push(null as T)
    rows.push(row)
  }
  return rows
}

export function AttendanceSummary({ summary }: { summary: MonthlySummary }) {
  const items = [
    { label: 'Attendance rate', value: summary.attendanceRate === null ? '—' : `${summary.attendanceRate}%` },
    { label: 'Present', value: summary.present },
    { label: 'Late', value: summary.late },
    { label: 'Half days', value: summary.halfDay },
    { label: 'Absent', value: summary.absent },
    { label: 'Missing check-out', value: summary.missing },
    { label: 'On leave', value: summary.onLeave },
    { label: 'Hours worked', value: formatDuration(summary.workedMinutes) },
  ]
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border p-3">
          <dt className="text-caption text-muted-foreground">{item.label}</dt>
          <dd className="tabular text-h3">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Days with a record, as a table (the calendar's detail view). */
export function AttendanceDays({ days, timeZone }: { days: Day[]; timeZone: string }) {
  const rows = days.filter((d) => d.record).reverse()
  if (rows.length === 0)
    return <p className="py-4 text-center text-small text-muted-foreground">No check-ins this month.</p>
  return (
    <div role="region" aria-label="Daily attendance" tabIndex={0} className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-small">
        <caption className="sr-only">Daily attendance</caption>
        <thead>
          <tr className="border-b bg-muted/50 text-left text-caption text-muted-foreground">
            <th scope="col" className="h-9 px-3 font-medium">
              Date
            </th>
            <th scope="col" className="px-3 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 font-medium">
              In
            </th>
            <th scope="col" className="px-3 font-medium">
              Out
            </th>
            <th scope="col" className="hidden px-3 font-medium sm:table-cell">
              Breaks
            </th>
            <th scope="col" className="px-3 font-medium">
              Worked
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((day) => (
            <tr key={day.key} className="border-b last:border-0">
              <td className="whitespace-nowrap px-3 py-2">{formatDay(day.date)}</td>
              <td className="px-3 py-2">
                {day.status && <StatusBadge status={day.status} label={ATTENDANCE_STATUS_LABELS[day.status]} />}
                {day.record?.source !== 'SELF' && (
                  <span className="ml-1 text-caption text-muted-foreground">
                    ({day.record?.source === 'HR' ? 'HR edit' : 'corrected'})
                  </span>
                )}
              </td>
              <td className="tabular whitespace-nowrap px-3 py-2">{formatTime(day.record?.checkIn, timeZone)}</td>
              <td className="tabular whitespace-nowrap px-3 py-2">{formatTime(day.record?.checkOut, timeZone)}</td>
              <td className="tabular hidden px-3 py-2 sm:table-cell">{formatDuration(day.record?.breakMinutes)}</td>
              <td className="tabular px-3 py-2">{formatDuration(day.record?.totalMinutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
