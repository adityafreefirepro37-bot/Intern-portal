import type { Metadata } from 'next'
import Link from 'next/link'
import { Download, Mail } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { CalendarBody, CalendarToolbar } from '@/features/communication/components/calendar-views'
import { EventEditor } from '@/features/communication/components/event-editor'
import { MeetingEditor } from '@/features/communication/components/meeting-editor'
import { CALENDAR_KIND_LABELS, CALENDAR_KIND_TONE, toDayKey } from '@/lib/communication/calendar'
import { formatTime, monthLabel } from '@/lib/hr/time'
import { cn } from '@/lib/utils'
import { firstParam } from '@/lib/validation/list-params'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { calendarService } from '@/server/services/calendar.service'
import { meetingService } from '@/server/services/meeting.service'

export const metadata: Metadata = { title: 'Calendar' }

function rangeLabel(view: string, days: Date[], anchor: Date) {
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-IN', { ...opts, timeZone: 'UTC' }).format(d)
  if (view === 'month') return monthLabel(anchor)
  const first = days[0]
  const last = days[days.length - 1]
  return `${fmt(first, { day: 'numeric', month: 'short' })} – ${fmt(last, { day: 'numeric', month: 'short', year: 'numeric' })}`
}

/**
 * Personal calendar: the viewer's meetings and everything else with a date
 * that concerns them (task deadlines, milestones, leave, holidays, learning,
 * goals, onboarding) plus organization events. Month / week / agenda views.
 */
export default async function CalendarPage({ searchParams }: PageProps<'/calendar'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'calendar.read')) return <AccessDenied what="the calendar" />
  const params = await searchParams
  const tz = ctx.organization.timezone
  const canSchedule = authorizationService.can(ctx, 'meeting.manage')
  const canAddEvent = authorizationService.can(ctx, 'calendar.create')
  const canReadMeetings = authorizationService.can(ctx, 'meeting.read')
  const [page, people, upcoming] = await Promise.all([
    calendarService.page(ctx, { view: firstParam(params, 'view'), date: firstParam(params, 'date') }),
    canSchedule ? meetingService.inviteOptions(ctx) : Promise.resolve([]),
    meetingService.upcoming(ctx, 20),
  ])
  const awaiting = upcoming.filter((m) => m.myResponse === 'PENDING')
  const defaultDate = toDayKey(page.anchor < page.today ? page.today : page.anchor)

  return (
    <>
      <PageHeader
        title="Calendar"
        description={`Your meetings, deadlines, leave and company events. Times in ${tz}.`}
        actions={
          <>
            {canReadMeetings && (
              <a href="/api/calendar/ics" className={buttonVariants({ variant: 'ghost', size: 'sm' })} download>
                <Download aria-hidden /> Export meetings (.ics)
              </a>
            )}
            {canAddEvent && <EventEditor timeZone={tz} defaultDate={defaultDate} />}
            {canSchedule && (
              <MeetingEditor
                people={people.map((p) => ({ id: p.id, name: p.name, detail: p.role }))}
                timeZone={tz}
                defaultDate={defaultDate}
                defaultOpen={firstParam(params, 'schedule') === '1'}
              />
            )}
          </>
        }
      />

      {awaiting.length > 0 && (
        <Card className="mb-4 border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col gap-2 p-4">
            <p className="flex items-center gap-2 text-small font-medium">
              <Mail className="size-4 text-primary" aria-hidden />
              {awaiting.length === 1 ? 'An invitation is waiting for your reply' : `${awaiting.length} invitations are waiting for your reply`}
            </p>
            <ul className="flex flex-wrap gap-2">
              {awaiting.slice(0, 6).map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/calendar/meetings/${m.id}`}
                    className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-caption hover:bg-accent"
                  >
                    <span className="font-medium">{m.title}</span>
                    <span className="text-muted-foreground">
                      {new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: tz }).format(m.start_at)},{' '}
                      {formatTime(m.start_at, tz)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CalendarToolbar
            view={page.view}
            label={rangeLabel(page.view, page.days, page.anchor)}
            prev={page.prev}
            next={page.next}
            anchor={toDayKey(page.anchor)}
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <CalendarBody
            view={page.view}
            days={page.days}
            items={page.items}
            timeZone={tz}
            today={page.today}
            anchor={page.anchor}
          />
          <ul className="flex flex-wrap gap-x-3 gap-y-1.5 border-t pt-3" aria-label="Legend">
            {(Object.keys(CALENDAR_KIND_LABELS) as (keyof typeof CALENDAR_KIND_LABELS)[]).map((kind) => (
              <li key={kind} className={cn('rounded px-1.5 py-0.5 text-caption font-medium', CALENDAR_KIND_TONE[kind])}>
                {CALENDAR_KIND_LABELS[kind]}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  )
}
