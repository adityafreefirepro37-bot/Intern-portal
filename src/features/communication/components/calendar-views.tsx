import Link from 'next/link'
import { CalendarDays } from 'lucide-react'
import { EmptyState } from '@/components/common/states'
import {
  CALENDAR_KIND_LABELS,
  CALENDAR_KIND_TONE,
  toDayKey,
  type CalendarItem,
  type CalendarView,
} from '@/lib/communication/calendar'
import { formatTime } from '@/lib/hr/time'
import { cn } from '@/lib/utils'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function dayLabel(date: Date, style: 'long' | 'short' = 'long') {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: style === 'long' ? 'long' : 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(date)
}

function byDay(items: CalendarItem[]) {
  const map = new Map<string, CalendarItem[]>()
  for (const item of items) map.set(item.day, [...(map.get(item.day) ?? []), item])
  return map
}

function timeRange(item: CalendarItem, tz: string) {
  if (!item.start) return 'All day'
  return item.end ? `${formatTime(item.start, tz)} – ${formatTime(item.end, tz)}` : formatTime(item.start, tz)
}

function KindChip({ item }: { item: CalendarItem }) {
  return (
    <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-caption font-medium', CALENDAR_KIND_TONE[item.kind])}>
      {CALENDAR_KIND_LABELS[item.kind]}
    </span>
  )
}

function ItemTitle({ item, className }: { item: CalendarItem; className?: string }) {
  const content = <span className={cn(item.muted && 'text-muted-foreground line-through decoration-1', className)}>{item.title}</span>
  return item.href ? (
    <Link href={item.href} className="min-w-0 hover:underline">
      {content}
    </Link>
  ) : (
    content
  )
}

/** One row in the week and agenda lists. */
function ItemRow({ item, tz }: { item: CalendarItem; tz: string }) {
  return (
    <li className="flex flex-wrap items-start gap-x-2 gap-y-1 text-small">
      <KindChip item={item} />
      <span className="tabular w-full shrink-0 text-caption text-muted-foreground sm:w-auto sm:min-w-28 sm:pt-0.5">
        {timeRange(item, tz)}
      </span>
      <span className="min-w-0 flex-1">
        <ItemTitle item={item} className="font-medium" />
        {item.detail && <span className="block text-caption text-muted-foreground">{item.detail}</span>}
      </span>
    </li>
  )
}

/** Days with items as a list (agenda view, and the month view on small screens). */
function DayList({ days, items, tz, today }: { days: Date[]; items: CalendarItem[]; tz: string; today: string }) {
  const grouped = byDay(items)
  const busy = days.filter((d) => grouped.has(toDayKey(d)))
  if (busy.length === 0) {
    return <EmptyState icon={CalendarDays} title="Nothing scheduled" description="Meetings, deadlines and events show up here." compact />
  }
  return (
    <ol className="divide-y">
      {busy.map((day) => {
        const key = toDayKey(day)
        return (
          <li key={key} className={cn('grid gap-2 py-3 sm:grid-cols-[11rem_1fr]', key === today && 'rounded-md bg-primary/5 px-2')}>
            <p className="text-small font-medium">
              {dayLabel(day)}
              {key === today && <span className="text-primary"> · Today</span>}
            </p>
            <ul className="space-y-2">
              {grouped.get(key)!.map((item) => (
                <ItemRow key={item.key} item={item} tz={tz} />
              ))}
            </ul>
          </li>
        )
      })}
    </ol>
  )
}

function MonthGrid({
  days,
  items,
  tz,
  today,
  month,
}: {
  days: Date[]
  items: CalendarItem[]
  tz: string
  today: string
  month: number
}) {
  const grouped = byDay(items)
  const MAX = 3
  return (
    <div role="grid" aria-label="Month" className="overflow-hidden rounded-lg border">
      <div role="row" className="grid grid-cols-7 border-b bg-muted/50">
        {WEEKDAYS.map((d) => (
          <div key={d} role="columnheader" className="px-2 py-1.5 text-caption font-medium text-muted-foreground">
            {d}
          </div>
        ))}
      </div>
      {Array.from({ length: days.length / 7 }, (_, w) => (
        <div role="row" key={w} className="grid grid-cols-7 divide-x border-b last:border-b-0">
          {days.slice(w * 7, w * 7 + 7).map((day) => {
            const key = toDayKey(day)
            const dayItems = grouped.get(key) ?? []
            const outside = day.getUTCMonth() !== month
            return (
              <div
                role="gridcell"
                key={key}
                aria-label={`${dayLabel(day)}${dayItems.length ? `, ${dayItems.length} item${dayItems.length === 1 ? '' : 's'}` : ''}`}
                className={cn('min-h-28 space-y-1 p-1.5', outside && 'bg-muted/30 text-muted-foreground')}
              >
                <Link
                  href={`/calendar?view=week&date=${key}`}
                  className={cn(
                    'tabular inline-flex size-6 items-center justify-center rounded-full text-caption font-medium hover:bg-accent',
                    key === today && 'bg-primary text-primary-foreground hover:bg-primary',
                  )}
                  aria-label={`Week of ${dayLabel(day)}`}
                >
                  {day.getUTCDate()}
                </Link>
                <ul className="space-y-0.5">
                  {dayItems.slice(0, MAX).map((item) => (
                    <li key={item.key} className="truncate text-caption" title={`${CALENDAR_KIND_LABELS[item.kind]}: ${item.title}`}>
                      <span className={cn('mr-1 rounded px-1 font-medium', CALENDAR_KIND_TONE[item.kind])}>
                        {item.start ? formatTime(item.start, tz) : CALENDAR_KIND_LABELS[item.kind]}
                      </span>
                      <ItemTitle item={item} />
                    </li>
                  ))}
                </ul>
                {dayItems.length > MAX && (
                  <Link href={`/calendar?view=week&date=${key}`} className="text-caption font-medium text-primary hover:underline">
                    +{dayItems.length - MAX} more
                  </Link>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function WeekColumns({ days, items, tz, today }: { days: Date[]; items: CalendarItem[]; tz: string; today: string }) {
  const grouped = byDay(items)
  return (
    <ol className="grid gap-3 lg:grid-cols-7">
      {days.map((day) => {
        const key = toDayKey(day)
        const dayItems = grouped.get(key) ?? []
        return (
          <li key={key} className={cn('rounded-lg border p-3', key === today && 'border-primary bg-primary/5')}>
            <p className="mb-2 text-small font-medium">
              {dayLabel(day, 'short')}
              {key === today && <span className="text-primary"> · Today</span>}
            </p>
            {dayItems.length === 0 ? (
              <p className="text-caption text-muted-foreground">Free</p>
            ) : (
              <ul className="space-y-2.5">
                {dayItems.map((item) => (
                  <li key={item.key} className="space-y-0.5 text-small">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <KindChip item={item} />
                      <span className="tabular text-caption text-muted-foreground">{timeRange(item, tz)}</span>
                    </div>
                    <ItemTitle item={item} className="font-medium" />
                    {item.detail && <p className="text-caption text-muted-foreground">{item.detail}</p>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ol>
  )
}

export function CalendarBody({
  view,
  days,
  items,
  timeZone,
  today,
  anchor,
}: {
  view: CalendarView
  days: Date[]
  items: CalendarItem[]
  timeZone: string
  today: Date
  anchor: Date
}) {
  const todayKey = toDayKey(today)
  if (view === 'agenda') return <DayList days={days} items={items} tz={timeZone} today={todayKey} />
  if (view === 'week') return <WeekColumns days={days} items={items} tz={timeZone} today={todayKey} />
  const month = anchor.getUTCMonth()
  return (
    <>
      <div className="hidden md:block">
        <MonthGrid days={days} items={items} tz={timeZone} today={todayKey} month={month} />
      </div>
      <div className="md:hidden">
        <DayList days={days.filter((d) => d.getUTCMonth() === month)} items={items} tz={timeZone} today={todayKey} />
      </div>
    </>
  )
}

/** View switcher and previous / today / next links (all server-rendered links). */
export function CalendarToolbar({
  view,
  label,
  prev,
  next,
  anchor,
}: {
  view: CalendarView
  label: string
  prev: string
  next: string
  anchor: string
}) {
  const link = 'inline-flex h-8 items-center rounded-md border bg-card px-3 text-caption font-medium hover:bg-accent'
  const views: { key: CalendarView; label: string }[] = [
    { key: 'month', label: 'Month' },
    { key: 'week', label: 'Week' },
    { key: 'agenda', label: 'Agenda' },
  ]
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/calendar?view=${view}&date=${prev}`} className={link} aria-label="Previous">
          ← Prev
        </Link>
        <Link href={`/calendar?view=${view}`} className={link}>
          Today
        </Link>
        <Link href={`/calendar?view=${view}&date=${next}`} className={link} aria-label="Next">
          Next →
        </Link>
        <h2 className="ml-1 text-h3" aria-live="polite">
          {label}
        </h2>
      </div>
      <nav aria-label="Calendar view" className="flex gap-1 rounded-md border bg-card p-0.5">
        {views.map((v) => (
          <Link
            key={v.key}
            href={`/calendar?view=${v.key}&date=${anchor}`}
            aria-current={v.key === view ? 'page' : undefined}
            className={cn(
              'inline-flex h-7 items-center rounded px-3 text-caption font-medium',
              v.key === view ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
            )}
          >
            {v.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
