'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CalendarRange, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input, inputClassName, Textarea } from '@/components/ui/input'
import { Field, FormMessage, SubmitButton } from '@/features/auth/components/form-bits'
import { useFormAction } from '@/features/interns/components/use-form-action'
import { CREATABLE_EVENT_TYPES, EVENT_TYPE_LABELS } from '@/lib/communication/calendar'
import { saveCalendarEventAction } from '@/server/actions/communication'

export interface EditableEvent {
  id: string
  title: string
  description: string | null
  eventType: string
  location: string | null
  allDay: boolean
  startDate: string
  endDate: string
  startTime: string
  endTime: string
}

/** Organization-wide calendar events: trainings, company events, deadlines, reviews. */
export function EventEditor({
  event,
  timeZone,
  defaultDate,
}: {
  event?: EditableEvent
  timeZone: string
  defaultDate: string
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [allDay, setAllDay] = React.useState(event?.allDay ?? true)
  const [state, action] = useFormAction(saveCalendarEventAction, {
    onSuccess: (result) => {
      setOpen(false)
      if (!event && result.data?.id) router.push(`/calendar/events/${result.data.id}`)
    },
  })
  const id = React.useId()
  const v = state.values
  return (
    <>
      {event ? (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Pencil aria-hidden /> Edit
        </Button>
      ) : (
        <Button variant="outline" onClick={() => setOpen(true)}>
          <CalendarRange aria-hidden /> Add event
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{event ? 'Edit event' : 'Add an event'}</DialogTitle>
            <DialogDescription>Everyone in the organization sees it on their calendar. Times are in {timeZone}.</DialogDescription>
          </DialogHeader>
          <form action={action} className="grid gap-4">
            <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
            {event && <input type="hidden" name="eventId" value={event.id} />}
            <Field label="Title" htmlFor={`${id}-title`} error={state.fields?.title}>
              <Input id={`${id}-title`} name="title" required minLength={3} maxLength={160} defaultValue={v?.title ?? event?.title} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type" htmlFor={`${id}-type`} error={state.fields?.eventType}>
                <select
                  id={`${id}-type`}
                  name="eventType"
                  defaultValue={v?.eventType ?? event?.eventType ?? 'OTHER'}
                  className={inputClassName}
                >
                  {CREATABLE_EVENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {EVENT_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Location (optional)" htmlFor={`${id}-location`} error={state.fields?.location}>
                <Input id={`${id}-location`} name="location" maxLength={200} defaultValue={v?.location ?? event?.location ?? ''} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-small">
              <input
                type="checkbox"
                name="allDay"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
                className="size-4 accent-primary"
              />
              All day
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Starts" htmlFor={`${id}-start-date`} error={state.fields?.startDate}>
                <Input
                  id={`${id}-start-date`}
                  name="startDate"
                  type="date"
                  required
                  defaultValue={v?.startDate ?? event?.startDate ?? defaultDate}
                />
              </Field>
              <Field label="Ends (optional)" htmlFor={`${id}-end-date`} error={state.fields?.endDate}>
                <Input id={`${id}-end-date`} name="endDate" type="date" defaultValue={v?.endDate ?? event?.endDate ?? ''} />
              </Field>
              {!allDay && (
                <>
                  <Field label="Start time" htmlFor={`${id}-start-time`} error={state.fields?.startTime}>
                    <Input
                      id={`${id}-start-time`}
                      name="startTime"
                      type="time"
                      required
                      defaultValue={v?.startTime ?? event?.startTime ?? '10:00'}
                    />
                  </Field>
                  <Field label="End time (optional)" htmlFor={`${id}-end-time`} error={state.fields?.endTime}>
                    <Input id={`${id}-end-time`} name="endTime" type="time" defaultValue={v?.endTime ?? event?.endTime ?? ''} />
                  </Field>
                </>
              )}
            </div>
            <Field label="Details (optional)" htmlFor={`${id}-description`} error={state.fields?.description}>
              <Textarea
                id={`${id}-description`}
                name="description"
                rows={3}
                maxLength={2000}
                defaultValue={v?.description ?? event?.description ?? ''}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton pendingLabel="Saving…">{event ? 'Save changes' : 'Add event'}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
