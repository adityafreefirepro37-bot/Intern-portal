import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MapPin } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EventEditor } from '@/features/communication/components/event-editor'
import { DeleteEventButton } from '@/features/communication/components/event-actions'
import { EVENT_TYPE_LABELS, dayKeyIn, type CalendarEventTypeValue } from '@/lib/communication/calendar'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { clockIn, formatTime } from '@/lib/hr/time'
import { fullName } from '@/lib/utils'
import { idSchema } from '@/lib/validation'
import { requirePageContext } from '@/server/context'
import { calendarService } from '@/server/services/calendar.service'

export const metadata: Metadata = { title: 'Event' }

export default async function EventPage({ params }: PageProps<'/calendar/events/[id]'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  if (!idSchema.safeParse(id).success) notFound()
  let event: Awaited<ReturnType<typeof calendarService.getEvent>>
  try {
    event = await calendarService.getEvent(ctx, id)
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    if (error instanceof ForbiddenError) return <AccessDenied what="the calendar" />
    throw error
  }
  const tz = ctx.organization.timezone
  const day = (d: Date) =>
    new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz }).format(d)
  const startDay = dayKeyIn(event.start_at, tz)
  const endDay = event.end_at ? dayKeyIn(event.end_at, tz) : startDay
  const when = event.all_day
    ? startDay === endDay
      ? `${day(event.start_at)} · All day`
      : `${day(event.start_at)} – ${day(event.end_at!)}`
    : `${day(event.start_at)} · ${formatTime(event.start_at, tz)}${event.end_at ? ` – ${startDay === endDay ? formatTime(event.end_at, tz) : `${day(event.end_at)} ${formatTime(event.end_at, tz)}`}` : ''}`

  return (
    <>
      <PageHeader
        title={event.title}
        breadcrumbs={[{ label: 'Calendar', href: '/calendar' }, { label: 'Event' }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="info">{EVENT_TYPE_LABELS[event.event_type as CalendarEventTypeValue] ?? 'Event'}</Badge>
            {when}
          </span>
        }
        actions={
          <>
            {event.canEdit && (
              <EventEditor
                timeZone={tz}
                defaultDate={startDay}
                event={{
                  id: event.id,
                  title: event.title,
                  description: event.description,
                  eventType: event.event_type,
                  location: event.location,
                  allDay: event.all_day,
                  startDate: startDay,
                  endDate: endDay === startDay ? '' : endDay,
                  startTime: event.all_day ? '' : clockIn(event.start_at, tz),
                  endTime: event.all_day || !event.end_at ? '' : clockIn(event.end_at, tz),
                }}
              />
            )}
            {event.canDelete && <DeleteEventButton eventId={event.id} title={event.title} />}
          </>
        }
      />
      <Card className="max-w-3xl">
        <CardContent className="space-y-3 p-5 text-small">
          {event.location && (
            <p className="flex items-center gap-2">
              <MapPin className="size-4 text-muted-foreground" aria-hidden />
              {event.location}
            </p>
          )}
          {event.description ? (
            <p className="whitespace-pre-line break-words">{event.description}</p>
          ) : (
            <p className="text-muted-foreground">No details added.</p>
          )}
          {event.creator && <p className="border-t pt-3 text-caption text-muted-foreground">Added by {fullName(event.creator)}</p>}
        </CardContent>
      </Card>
    </>
  )
}
