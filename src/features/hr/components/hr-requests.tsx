'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Paperclip, Plus } from 'lucide-react'
import { UserAvatar } from '@/components/common/user-avatar'
import { RelativeTime } from '@/components/common/relative-time'
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
import { cn } from '@/lib/utils'
import {
  assignHrRequestAction,
  commentHrRequestAction,
  createHrRequestAction,
  transitionHrRequestAction,
} from '@/server/actions/hr'
import { ReasonDialog } from './action-form'

const FILE_ACCEPT = '.pdf,.png,.jpg,.jpeg,.docx'

export function NewRequestButton({ categories }: { categories: Record<string, string> }) {
  const [open, setOpen] = React.useState(false)
  const router = useRouter()
  const [state, action] = useFormAction(createHrRequestAction, {
    onSuccess: (result) => {
      if (result.data?.id) router.push(`/requests/${result.data.id}`)
      else setOpen(false)
    },
  })
  const v = state.values
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden /> New request
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New HR request</DialogTitle>
            <DialogDescription>Only you and the HR team can see this request.</DialogDescription>
          </DialogHeader>
          <form action={action} className="grid gap-4">
            <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
            <Field label="Category" htmlFor="req-category" error={state.fields?.category}>
              <select
                id="req-category"
                name="category"
                required
                className={inputClassName}
                defaultValue={v?.category ?? 'OTHER'}
              >
                {Object.entries(categories).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Subject" htmlFor="req-subject" error={state.fields?.subject}>
              <Input id="req-subject" name="subject" required minLength={3} maxLength={200} defaultValue={v?.subject} />
            </Field>
            <Field label="Details" htmlFor="req-description" error={state.fields?.description}>
              <Textarea
                id="req-description"
                name="description"
                required
                maxLength={5000}
                rows={5}
                defaultValue={v?.description}
              />
            </Field>
            <Field label="Attachments (optional, up to 3)" htmlFor="req-files" error={state.fields?.files}>
              <Input id="req-files" name="files" type="file" multiple accept={FILE_ACCEPT} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton pendingLabel="Sending…">Send to HR</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

interface Comment {
  id: string
  body: string
  created_at: Date
  authorName: string
  fromRequester: boolean
  author: { first_name: string; last_name: string; display_name: string | null; avatar_url: string | null }
}

/** Conversation on a request: messages in order, and a reply box (with files) while it's open. */
export function RequestThread({
  requestId,
  comments,
  canComment,
}: {
  requestId: string
  comments: Comment[]
  canComment: boolean
}) {
  const formRef = React.useRef<HTMLFormElement>(null)
  const [state, action] = useFormAction(commentHrRequestAction, { onSuccess: () => formRef.current?.reset() })
  return (
    <div className="space-y-4">
      {comments.length === 0 ? (
        <p className="text-small text-muted-foreground">No replies yet.</p>
      ) : (
        <ol className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className={cn('flex gap-3', !c.fromRequester && 'flex-row-reverse text-right')}>
              <UserAvatar person={c.author} className="size-8" />
              <div
                className={cn(
                  'max-w-[85%] rounded-xl border p-3 text-left',
                  c.fromRequester ? 'bg-card' : 'bg-primary/5',
                )}
              >
                <p className="text-caption text-muted-foreground">
                  <span className="font-medium text-foreground">{c.authorName}</span>
                  {!c.fromRequester && ' · HR'} · <RelativeTime date={c.created_at} />
                </p>
                <p className="mt-1 whitespace-pre-line text-small">{c.body}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {canComment && (
        <form ref={formRef} action={action} className="grid gap-3 rounded-xl border bg-card p-4">
          <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
          <input type="hidden" name="requestId" value={requestId} />
          <Field label="Reply" htmlFor="reply-body" error={state.fields?.body}>
            <Textarea id="reply-body" name="body" required maxLength={5000} rows={3} />
          </Field>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="flex items-center gap-2 text-caption text-muted-foreground">
              <Paperclip className="size-4" aria-hidden />
              <span className="sr-only">Attach files</span>
              <input name="files" type="file" multiple accept={FILE_ACCEPT} className="max-w-56 text-caption" />
            </label>
            <SubmitButton pendingLabel="Sending…">Send reply</SubmitButton>
          </div>
        </form>
      )}
    </div>
  )
}

/** HR controls (status with note, assignee) and the requester's cancel. */
export function RequestControls({
  requestId,
  targets,
  statusLabels,
  handlers,
  assigneeId,
  canManage,
  canCancel,
}: {
  requestId: string
  targets: string[]
  statusLabels: Record<string, string>
  handlers: { id: string; name: string }[]
  assigneeId: string | null
  canManage: boolean
  canCancel: boolean
}) {
  const [target, setTarget] = React.useState<string | null>(null)
  const [, assign] = useFormAction(assignHrRequestAction)
  const needsNote = target === 'REJECTED' || target === 'WAITING_FOR_USER'
  return (
    <div className="space-y-4">
      {canManage && targets.length > 0 && (
        <div className="space-y-2">
          <p className="text-label">Move to</p>
          <div className="flex flex-wrap gap-2">
            {targets.map((t) => (
              <Button
                key={t}
                size="sm"
                variant={t === 'REJECTED' ? 'outline' : 'secondary'}
                onClick={() => setTarget(t)}
              >
                {t === 'WAITING_FOR_USER' ? 'Ask for information' : statusLabels[t]}
              </Button>
            ))}
          </div>
        </div>
      )}
      {canManage && (
        <form action={assign} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="requestId" value={requestId} />
          <Field label="Assigned to" htmlFor="req-assignee">
            <select
              id="req-assignee"
              name="assigneeId"
              defaultValue={assigneeId ?? ''}
              className={cn(inputClassName, 'w-52')}
            >
              <option value="">Unassigned</option>
              {handlers.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </Field>
          <SubmitButton size="sm" variant="outline">
            Save
          </SubmitButton>
        </form>
      )}
      {canCancel && (
        <Button variant="outline" onClick={() => setTarget('CANCELLED')}>
          Cancel request
        </Button>
      )}
      {target && (
        <ReasonDialog
          open
          onOpenChange={(open) => !open && setTarget(null)}
          title={
            target === 'CANCELLED'
              ? 'Cancel this request?'
              : target === 'WAITING_FOR_USER'
                ? 'Ask for more information'
                : `Mark as ${statusLabels[target]?.toLowerCase()}`
          }
          description={
            needsNote ? 'The requester sees this note and is notified.' : 'Optionally add a note for the requester.'
          }
          action={transitionHrRequestAction}
          fields={{ requestId, to: target }}
          reasonName="note"
          reasonLabel="Note"
          required={needsNote}
          confirmLabel={target === 'CANCELLED' ? 'Cancel request' : 'Confirm'}
          destructive={target === 'REJECTED' || target === 'CANCELLED'}
        />
      )}
    </div>
  )
}
