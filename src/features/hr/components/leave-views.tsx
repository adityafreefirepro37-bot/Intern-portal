import { StatusBadge } from '@/components/common/badges'
import { dayKey, eachDay } from '@/lib/hr/time'
import { formatDay } from '@/lib/utils'

interface Balance {
  type: { id: string; name: string }
  allocated: number | null
  used: number
  pending: number
  remaining: number | null
  unlimited: boolean
}

/** Allocated / used / pending / remaining per leave type (unlimited types show usage only). */
export function LeaveBalances({ balances }: { balances: Balance[] }) {
  if (balances.length === 0) return <p className="text-small text-muted-foreground">No leave types are configured.</p>
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {balances.map((b) => (
        <li key={b.type.id} className="rounded-xl border bg-card p-4">
          <p className="text-label">{b.type.name}</p>
          <p className="tabular mt-2 text-h2">
            {b.unlimited ? b.used : b.remaining}
            <span className="ml-1 text-small font-normal text-muted-foreground">
              {b.unlimited ? 'days used' : `of ${b.allocated} left`}
            </span>
          </p>
          <dl className="mt-2 flex gap-4 text-caption text-muted-foreground">
            <div>
              <dt className="inline">Used </dt>
              <dd className="tabular inline font-medium text-foreground">{b.used}</dd>
            </div>
            <div>
              <dt className="inline">Pending </dt>
              <dd className="tabular inline font-medium text-foreground">{b.pending}</dd>
            </div>
            {b.unlimited && <div>No fixed allowance</div>}
          </dl>
        </li>
      ))}
    </ul>
  )
}

interface CalendarLeave {
  id: string
  start_date: Date
  end_date: Date
  status: string
  userName: string
  leave_type: { name: string }
}

/**
 * Leave calendar as an agenda (one entry per day with leave or a holiday).
 * Text labels carry the meaning; it reads well on phones and with screen readers.
 */
export function LeaveAgenda({
  start,
  end,
  leave,
  holidays,
}: {
  start: Date
  end: Date
  leave: CalendarLeave[]
  holidays: { date: Date; name: string; is_optional: boolean }[]
}) {
  const days = eachDay(start, end)
    .map((date) => ({
      date,
      holiday: holidays.find((h) => dayKey(h.date) === dayKey(date)) ?? null,
      people: leave.filter((l) => l.start_date <= date && l.end_date >= date),
    }))
    .filter((day) => day.holiday || day.people.length)
  if (days.length === 0)
    return <p className="py-6 text-center text-small text-muted-foreground">No leave or holidays this month.</p>
  return (
    <ol className="divide-y rounded-xl border bg-card">
      {days.map((day) => (
        <li key={dayKey(day.date)} className="grid gap-2 p-3 sm:grid-cols-[9rem_1fr]">
          <p className="text-small font-medium">
            {new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' }).format(day.date)},{' '}
            {formatDay(day.date)}
          </p>
          <ul className="flex flex-wrap gap-2 text-small">
            {day.holiday && (
              <li>
                <StatusBadge
                  status="HOLIDAY"
                  label={`Holiday: ${day.holiday.name}${day.holiday.is_optional ? ' (optional)' : ''}`}
                />
              </li>
            )}
            {day.people.map((l) => (
              <li key={l.id} className="flex items-center gap-1.5 rounded-md border px-2 py-0.5">
                <span>{l.userName}</span>
                <span className="text-muted-foreground">· {l.leave_type.name}</span>
                {l.status === 'PENDING' && <span className="text-caption text-warning">(pending)</span>}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  )
}
