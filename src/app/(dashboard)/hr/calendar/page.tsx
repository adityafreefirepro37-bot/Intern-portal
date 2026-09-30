import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { HrNav, MonthNav } from '@/features/hr/components/hr-nav'
import { hrNavItems } from '@/features/hr/nav'
import { monthLabel } from '@/lib/hr/time'
import { cn, formatDay } from '@/lib/utils'
import { firstParam } from '@/lib/validation/list-params'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { hrDashboardService, type CalendarKind } from '@/server/services/hr-dashboard.service'

export const metadata: Metadata = { title: 'HR calendar' }

const KIND_LABELS: Record<CalendarKind, string> = {
  JOINING: 'Joining',
  ENDING: 'Ends',
  LEAVE: 'Leave',
  HOLIDAY: 'Holiday',
  ONBOARDING: 'Onboarding due',
  DOCUMENT: 'Document expiry',
  REVIEW: 'Review',
  MEETING: 'Meeting',
}

const KIND_TONE: Record<CalendarKind, string> = {
  JOINING: 'bg-success/12 text-success',
  ENDING: 'bg-warning/14 text-warning',
  LEAVE: 'bg-info/12 text-info',
  HOLIDAY: 'bg-muted text-muted-foreground',
  ONBOARDING: 'bg-primary/10 text-primary',
  DOCUMENT: 'bg-destructive/10 text-destructive',
  REVIEW: 'bg-secondary text-secondary-foreground',
  MEETING: 'bg-secondary text-secondary-foreground',
}

/**
 * HR agenda for a month: joining and end dates, leave, holidays, onboarding
 * deadlines, document expiries, review periods and meetings. Every entry has a
 * text label, so the calendar never depends on colour.
 */
export default async function HrCalendarPage({ searchParams }: PageProps<'/hr/calendar'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'hr_dashboard.read')) return <AccessDenied what="the HR calendar" />
  const calendar = await hrDashboardService.calendar(ctx, firstParam(await searchParams, 'month'))
  const busyDays = calendar.days.filter((d) => d.events.length)
  return (
    <>
      <PageHeader
        title="HR calendar"
        description="Key dates across the programme. Calendar sync arrives in Phase 06."
      />
      <HrNav items={hrNavItems(ctx)} active="/hr/calendar" />
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <MonthNav
            label={monthLabel(calendar.month)}
            prevHref={`/hr/calendar?month=${calendar.prev}`}
            nextHref={`/hr/calendar?month=${calendar.next}`}
            todayHref="/hr/calendar"
          />
          <p className="text-small text-muted-foreground">
            {calendar.total} event{calendar.total === 1 ? '' : 's'}
          </p>
        </CardHeader>
        <CardContent>
          {busyDays.length === 0 ? (
            <p className="py-10 text-center text-small text-muted-foreground">Nothing scheduled this month.</p>
          ) : (
            <ol className="divide-y">
              {busyDays.map((day) => (
                <li
                  key={day.key}
                  className={cn(
                    'grid gap-2 py-3 sm:grid-cols-[10rem_1fr]',
                    day.date.getTime() === calendar.today.getTime() && 'rounded-md bg-primary/5 px-2',
                  )}
                >
                  <p className="text-small font-medium">
                    {new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' }).format(day.date)},{' '}
                    {formatDay(day.date)}
                    {day.date.getTime() === calendar.today.getTime() && <span className="text-primary"> · Today</span>}
                  </p>
                  <ul className="space-y-1.5">
                    {day.events.map((event, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2 text-small">
                        <span className={cn('rounded px-1.5 py-0.5 text-caption font-medium', KIND_TONE[event.kind])}>
                          {KIND_LABELS[event.kind]}
                        </span>
                        {event.href ? (
                          <Link href={event.href} className="hover:underline">
                            {event.title}
                          </Link>
                        ) : (
                          <span>{event.title}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </>
  )
}
