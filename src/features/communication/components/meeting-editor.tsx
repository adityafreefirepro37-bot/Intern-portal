'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CalendarPlus, Pencil } from 'lucide-react'
import { PeoplePicker, type PickerOption } from '@/components/common/people-picker'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input, Textarea } from '@/components/ui/input'
import { Field, FormMessage, SubmitButton } from '@/features/auth/components/form-bits'
import { useFormAction } from '@/features/interns/components/use-form-action'
import { saveMeetingAction } from '@/server/actions/communication'

export interface EditableMeeting {
  id: string
  title: string
  description: string | null
  location: string | null
  meeting_url: string | null
  /** Wall-clock values in the organization timezone. */
  date: string
  startTime: string
  endTime: string
  attendeeIds: string[]
}

/** Schedule (or edit) a meeting: time in the organization timezone, attendees, place or link. */
export function MeetingEditor({
  meeting,
  people,
  timeZone,
  defaultDate,
  defaultOpen = false,
  variant = 'default',
}: {
  meeting?: EditableMeeting
  people: PickerOption[]
  timeZone: string
  defaultDate: string
  defaultOpen?: boolean
  variant?: 'default' | 'outline'
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(defaultOpen)
  const [state, action] = useFormAction(saveMeetingAction, {
    onSuccess: (result) => {
      setOpen(false)
      if (!meeting && result.data?.id) router.push(`/calendar/meetings/${result.data.id}`)
    },
  })
  const id = React.useId()
  const v = state.values
  return (
    <>
      {meeting ? (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Pencil aria-hidden /> Edit
        </Button>
      ) : (
        <Button variant={variant} onClick={() => setOpen(true)}>
          <CalendarPlus aria-hidden /> Schedule meeting
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{meeting ? 'Edit meeting' : 'Schedule a meeting'}</DialogTitle>
            <DialogDescription>
              Times are in {timeZone}. Invitees get a notification{meeting ? ' about changes' : ''} and can reply.
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="grid gap-4">
            <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
            {meeting && <input type="hidden" name="meetingId" value={meeting.id} />}
            <Field label="Title" htmlFor={`${id}-title`} error={state.fields?.title}>
              <Input
                id={`${id}-title`}
                name="title"
                required
                minLength={3}
                maxLength={160}
                defaultValue={v?.title ?? meeting?.title}
                placeholder="Weekly 1:1, Design review…"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Date" htmlFor={`${id}-date`} error={state.fields?.date}>
                <Input id={`${id}-date`} name="date" type="date" required defaultValue={v?.date ?? meeting?.date ?? defaultDate} />
              </Field>
              <Field label="Starts" htmlFor={`${id}-start`} error={state.fields?.startTime}>
                <Input
                  id={`${id}-start`}
                  name="startTime"
                  type="time"
                  required
                  defaultValue={v?.startTime ?? meeting?.startTime ?? '10:00'}
                />
              </Field>
              <Field label="Ends" htmlFor={`${id}-end`} error={state.fields?.endTime}>
                <Input
                  id={`${id}-end`}
                  name="endTime"
                  type="time"
                  required
                  defaultValue={v?.endTime ?? meeting?.endTime ?? '10:30'}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Location (optional)" htmlFor={`${id}-location`} error={state.fields?.location}>
                <Input
                  id={`${id}-location`}
                  name="location"
                  maxLength={200}
                  defaultValue={v?.location ?? meeting?.location ?? ''}
                  placeholder="Meeting room, office…"
                />
              </Field>
              <Field label="Video link (optional)" htmlFor={`${id}-url`} error={state.fields?.meetingUrl}>
                <Input
                  id={`${id}-url`}
                  name="meetingUrl"
                  type="url"
                  inputMode="url"
                  maxLength={500}
                  defaultValue={v?.meetingUrl ?? meeting?.meeting_url ?? ''}
                  placeholder="https://meet.google.com/…"
                />
              </Field>
            </div>
            <Field label="Agenda (optional)" htmlFor={`${id}-description`} error={state.fields?.description}>
              <Textarea
                id={`${id}-description`}
                name="description"
                rows={3}
                maxLength={4000}
                defaultValue={v?.description ?? meeting?.description ?? ''}
              />
            </Field>
            <Field
              label="Invite"
              htmlFor={`${id}-people`}
              error={state.fields?.attendeeIds}
              hint="You're included as the organizer."
            >
              <PeoplePicker
                id={`${id}-people`}
                name="attendeeIds"
                label="Invitees"
                options={people}
                defaultSelected={meeting?.attendeeIds ?? []}
                emptyLabel="There’s nobody you can invite yet."
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton pendingLabel="Saving…">{meeting ? 'Save changes' : 'Schedule'}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
