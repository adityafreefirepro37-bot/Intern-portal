import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CalendarClock, Download, ExternalLink, MapPin } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import type { PickerOption } from '@/components/common/people-picker'
import { AccessDenied } from '@/components/common/states'
import { UserAvatar } from '@/components/common/user-avatar'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CancelMeetingButton, MeetingResponse } from '@/features/communication/components/meeting-actions'
import { MeetingEditor } from '@/features/communication/components/meeting-editor'
import { dayKeyIn } from '@/lib/communication/calendar'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { clockIn, formatTime } from '@/lib/hr/time'
import { fullName } from '@/lib/utils'
import { idSchema } from '@/lib/validation'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { meetingService, type MeetingView } from '@/server/services/meeting.service'

export const metadata: Metadata = { title: 'Meeting' }

const RESPONSE_LABEL = { PENDING: 'No reply yet', ACCEPTED: 'Going', TENTATIVE: 'Maybe', DECLINED: 'Declined' } as const
const RESPONSE_VARIANT = { PENDING: 'outline', ACCEPTED: 'success', TENTATIVE: 'warning', DECLINED: 'secondary' } as const

export default async function MeetingPage({ params }: PageProps<'/calendar/meetings/[id]'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  if (!idSchema.safeParse(id).success) notFound()
  let meeting: MeetingView
  try {
    meeting = await meetingService.get(ctx, id)
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    if (error instanceof ForbiddenError) return <AccessDenied what="meetings" />
    throw error
  }
  const tz = ctx.organization.timezone
  const people: PickerOption[] = meeting.canEdit
    ? (await meetingService.inviteOptions(ctx)).map((p) => ({ id: p.id, name: p.name, detail: p.role }))
    : []
  // Current attendees stay selectable even if they're outside the editor's invite scope.
  for (const a of meeting.attendees) {
    if (!a.is_organizer && !people.some((p) => p.id === a.user_id)) people.push({ id: a.user_id, name: fullName(a.user), detail: null })
  }
  const date = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz }).format(
    meeting.start_at,
  )
  const cancelled = meeting.status === 'CANCELLED'
  const past = meeting.end_at < new Date()
  const organizer = meeting.attendees.find((a) => a.is_organizer)?.user ?? meeting.creator

  return (
    <>
      <PageHeader
        title={meeting.title}
        breadcrumbs={[{ label: 'Calendar', href: '/calendar' }, { label: 'Meeting' }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {cancelled && <Badge variant="destructive">Cancelled</Badge>}
            {!cancelled && past && <Badge variant="secondary">Ended</Badge>}
            <span>
              {date} · {formatTime(meeting.start_at, tz)} – {formatTime(meeting.end_at, tz)} ({tz})
            </span>
          </span>
        }
        actions={
          <>
            <a href={`/api/meetings/${meeting.id}/ics`} className={buttonVariants({ variant: 'ghost', size: 'sm' })} download>
              <Download aria-hidden /> Add to my calendar (.ics)
            </a>
            {meeting.canEdit && !past && (
              <>
                <MeetingEditor
                  meeting={{
                    id: meeting.id,
                    title: meeting.title,
                    description: meeting.description,
                    location: meeting.location,
                    meeting_url: meeting.meeting_url,
                    date: dayKeyIn(meeting.start_at, tz),
                    startTime: clockIn(meeting.start_at, tz),
                    endTime: clockIn(meeting.end_at, tz),
                    attendeeIds: meeting.attendees.filter((a) => !a.is_organizer).map((a) => a.user_id),
                  }}
                  people={people}
                  timeZone={tz}
                  defaultDate={dayKeyIn(meeting.start_at, tz)}
                />
                <CancelMeetingButton meetingId={meeting.id} title={meeting.title} />
              </>
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {cancelled && (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="p-4 text-small">
                This meeting was cancelled{meeting.cancel_reason ? `: ${meeting.cancel_reason}` : '.'}
              </CardContent>
            </Card>
          )}
          {meeting.canRespond && (
            <Card>
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-small font-medium">
                  {meeting.myResponse === 'PENDING' ? 'Will you attend?' : `Your reply: ${RESPONSE_LABEL[meeting.myResponse!]}`}
                </p>
                <MeetingResponse meetingId={meeting.id} current={meeting.myResponse} />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-small">
              <p className="flex items-center gap-2">
                <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
                {formatTime(meeting.start_at, tz)} – {formatTime(meeting.end_at, tz)}
              </p>
              {meeting.location && (
                <p className="flex items-center gap-2">
                  <MapPin className="size-4 text-muted-foreground" aria-hidden />
                  {meeting.location}
                </p>
              )}
              {meeting.meeting_url && !cancelled && (
                <p>
                  <a
                    href={meeting.meeting_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonVariants({ size: 'sm' })}
                  >
                    <ExternalLink aria-hidden /> Join video call
                  </a>
                </p>
              )}
              {meeting.description ? (
                <div className="space-y-1 border-t pt-3">
                  <p className="text-caption font-medium text-muted-foreground">Agenda</p>
                  <p className="whitespace-pre-line break-words">{meeting.description}</p>
                </div>
              ) : (
                <p className="text-muted-foreground">No agenda added.</p>
              )}
            </CardContent>
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>People</CardTitle>
            <p className="text-caption text-muted-foreground">
              {meeting.counts.accepted} going · {meeting.counts.tentative} maybe · {meeting.counts.declined} declined ·{' '}
              {meeting.counts.pending} no reply
            </p>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5">
              {meeting.attendees.map((a) => (
                <li key={a.user_id} className="flex items-center gap-2.5">
                  <UserAvatar person={a.user} className="size-7" />
                  <span className="min-w-0 flex-1 truncate text-small">
                    {fullName(a.user)}
                    {a.user_id === ctx.actor.userId && <span className="text-muted-foreground"> (you)</span>}
                  </span>
                  {a.is_organizer ? (
                    <Badge variant="outline">Organizer</Badge>
                  ) : (
                    <Badge variant={RESPONSE_VARIANT[a.response]}>{RESPONSE_LABEL[a.response]}</Badge>
                  )}
                </li>
              ))}
            </ul>
            {organizer && !meeting.attendees.some((a) => a.is_organizer) && (
              <p className="mt-3 text-caption text-muted-foreground">Organized by {fullName(organizer)}</p>
            )}
            {authorizationService.can(ctx, 'message.send') && (
              <p className="mt-4 border-t pt-3 text-caption text-muted-foreground">
                Questions? Message the organizer from <Link href="/messages" className="font-medium text-primary hover:underline">Messages</Link>.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
