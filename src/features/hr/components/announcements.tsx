'use client'

import * as React from 'react'
import { Pencil, Plus } from 'lucide-react'
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
import { ANNOUNCEMENT_AUDIENCE_LABELS, ANNOUNCEMENT_CATEGORY_LABELS, TARGETED_AUDIENCES } from '@/lib/hr/announcements'
import { announcementStatusAction, saveAnnouncementAction } from '@/server/actions/hr'
import { ActionButton } from './action-form'

export interface AudienceOptions {
  departments: { id: string; name: string }[]
  teams: { id: string; name: string }[]
  people: { id: string; name: string }[]
}

export interface EditableAnnouncement {
  id: string
  title: string
  body: string
  category: string
  priority: string
  audience: string
  audience_ids: string[]
  status: string
  published_at: Date | null
  expires_at: Date | null
}

/** "YYYY-MM-DDTHH:MM" in the organization timezone, for datetime-local inputs. */
function localValue(date: Date | null, timeZone: string) {
  if (!date) return ''
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(date))
      .map((p) => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

export function AnnouncementEditor({
  announcement,
  options,
  timeZone,
}: {
  announcement?: EditableAnnouncement
  options: AudienceOptions
  timeZone: string
}) {
  const [open, setOpen] = React.useState(false)
  const [state, action] = useFormAction(saveAnnouncementAction, { onSuccess: () => setOpen(false) })
  const [audience, setAudience] = React.useState(announcement?.audience ?? 'EVERYONE')
  const [intent, setIntent] = React.useState<'DRAFT' | 'PUBLISH' | 'SCHEDULE'>(
    announcement?.status === 'SCHEDULED' ? 'SCHEDULE' : announcement?.status === 'PUBLISHED' ? 'PUBLISH' : 'PUBLISH',
  )
  const published = announcement?.status === 'PUBLISHED'
  const targets =
    audience === 'DEPARTMENT'
      ? options.departments
      : audience === 'TEAM'
        ? options.teams
        : audience === 'SPECIFIC'
          ? options.people
          : []
  return (
    <>
      {announcement ? (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Edit ${announcement.title}`}>
          <Pencil aria-hidden /> Edit
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus aria-hidden /> New announcement
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{announcement ? 'Edit announcement' : 'New announcement'}</DialogTitle>
            <DialogDescription>
              Only the chosen audience sees it and gets notified when it’s published.
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="grid gap-4">
            <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
            {announcement && <input type="hidden" name="announcementId" value={announcement.id} />}
            <Field label="Title" htmlFor="an-title" error={state.fields?.title}>
              <Input
                id="an-title"
                name="title"
                required
                minLength={3}
                maxLength={160}
                defaultValue={announcement?.title}
              />
            </Field>
            <Field label="Message" htmlFor="an-body" error={state.fields?.body}>
              <Textarea
                id="an-body"
                name="body"
                required
                rows={6}
                maxLength={10000}
                defaultValue={announcement?.body}
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Category" htmlFor="an-category">
                <select
                  id="an-category"
                  name="category"
                  defaultValue={announcement?.category ?? 'COMPANY'}
                  className={inputClassName}
                >
                  {Object.entries(ANNOUNCEMENT_CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Priority" htmlFor="an-priority">
                <select
                  id="an-priority"
                  name="priority"
                  defaultValue={announcement?.priority ?? 'NORMAL'}
                  className={inputClassName}
                >
                  <option value="LOW">Low</option>
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">Important</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </Field>
              <Field label="Audience" htmlFor="an-audience">
                <select
                  id="an-audience"
                  name="audience"
                  value={audience}
                  onChange={(event) => setAudience(event.target.value)}
                  className={inputClassName}
                >
                  {Object.entries(ANNOUNCEMENT_AUDIENCE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {(TARGETED_AUDIENCES as readonly string[]).includes(audience) && (
              <Field
                label={audience === 'SPECIFIC' ? 'People' : audience === 'TEAM' ? 'Teams' : 'Departments'}
                htmlFor="an-targets"
                hint="Hold Ctrl (or ⌘) to choose several"
                error={state.fields?.audienceIds}
              >
                <select
                  id="an-targets"
                  name="audienceIds"
                  multiple
                  required
                  defaultValue={announcement?.audience === audience ? announcement.audience_ids : []}
                  className={`${inputClassName} h-36`}
                >
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-label">When</legend>
              <div className="flex flex-wrap gap-4 text-small">
                {(published ? (['PUBLISH'] as const) : (['PUBLISH', 'SCHEDULE', 'DRAFT'] as const)).map((value) => (
                  <label key={value} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="intent"
                      value={value}
                      checked={intent === value}
                      onChange={() => setIntent(value)}
                    />
                    {value === 'PUBLISH'
                      ? published
                        ? 'Keep published'
                        : 'Publish now'
                      : value === 'SCHEDULE'
                        ? 'Schedule'
                        : 'Save as draft'}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {intent === 'SCHEDULE' && (
                <Field label="Publish at" htmlFor="an-publish" error={state.fields?.publishAt}>
                  <Input
                    id="an-publish"
                    name="publishAt"
                    type="datetime-local"
                    required
                    defaultValue={localValue(announcement?.published_at ?? null, timeZone)}
                  />
                </Field>
              )}
              <Field label="Expires (optional)" htmlFor="an-expires" error={state.fields?.expiresAt}>
                <Input
                  id="an-expires"
                  name="expiresAt"
                  type="datetime-local"
                  defaultValue={localValue(announcement?.expires_at ?? null, timeZone)}
                />
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton>
                {intent === 'PUBLISH' && !published ? 'Publish' : intent === 'SCHEDULE' ? 'Schedule' : 'Save'}
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function AnnouncementStatusButton({
  id,
  action,
  label,
}: {
  id: string
  action: 'PUBLISH' | 'ARCHIVE' | 'UNARCHIVE'
  label: string
}) {
  return (
    <ActionButton action={announcementStatusAction} fields={{ announcementId: id, action }} size="sm" variant="outline">
      {label}
    </ActionButton>
  )
}
