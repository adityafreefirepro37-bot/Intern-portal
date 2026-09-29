'use client'

import * as React from 'react'
import type { SubmissionStatus, TaskStatus } from '@prisma/client'
import { CheckCircle2, Download, FileText, RotateCcw, Send } from 'lucide-react'
import { UserAvatar } from '@/components/common/user-avatar'
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
import { formatDate, fullName } from '@/lib/utils'
import { reviewTaskAction, submitTaskAction } from '@/server/actions/work'
import { SubmissionBadge } from './work-badges'

type Person = {
  id: string
  first_name: string
  last_name: string
  display_name: string | null
  avatar_url: string | null
}

export interface SubmissionView {
  id: string
  status: SubmissionStatus
  versions: {
    id: string
    version_number: number
    description: string | null
    status: SubmissionStatus
    submitted_at: Date
    reviewed_at: Date | null
    review_comment: string | null
    creator: Person | null
    reviewer: Person | null
    attachments: { id: string; file_name: string; file_size: number }[]
  }[]
}

/**
 * Submit → review → changes requested → resubmit → approve. Every version is
 * kept (message, files, reviewer, decision); the newest is shown first.
 */
export function SubmissionPanel({
  taskId,
  taskStatus,
  submissions,
  canSubmit,
  canReview,
  timeZone,
}: {
  taskId: string
  taskStatus: TaskStatus
  submissions: SubmissionView[]
  canSubmit: boolean
  canReview: boolean
  timeZone: string
}) {
  const versions = submissions.flatMap((s) => s.versions)
  const latest = submissions[0]
  const submittable = canSubmit && (taskStatus === 'IN_PROGRESS' || taskStatus === 'CHANGES_REQUESTED')
  const reviewable =
    canReview &&
    taskStatus === 'IN_REVIEW' &&
    latest &&
    ['SUBMITTED', 'RESUBMITTED', 'UNDER_REVIEW'].includes(latest.status)

  return (
    <div className="space-y-4">
      {(submittable || reviewable) && (
        <div className="flex flex-wrap gap-2">
          {submittable && <SubmitDialog taskId={taskId} resubmission={versions.length > 0} />}
          {reviewable && <ReviewDialog taskId={taskId} version={versions[0]?.version_number ?? 1} />}
        </div>
      )}
      {canSubmit && taskStatus === 'ASSIGNED' && (
        <p className="text-small text-muted-foreground">Start the task to submit work for review.</p>
      )}
      {versions.length === 0 ? (
        <p className="text-small text-muted-foreground">No work submitted yet.</p>
      ) : (
        <ol className="space-y-3">
          {versions.map((version) => (
            <li key={version.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-label">Version {version.version_number}</span>
                <SubmissionBadge status={version.status} />
                <span className="text-caption text-muted-foreground">
                  {version.creator ? fullName(version.creator) : 'Unknown'} ·{' '}
                  {formatDate(version.submitted_at, timeZone)}
                </span>
              </div>
              {version.description && <p className="mt-2 whitespace-pre-line text-small">{version.description}</p>}
              {version.attachments.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {version.attachments.map((file) => (
                    <li key={file.id}>
                      <a
                        href={`/api/tasks/attachments/${file.id}`}
                        className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-caption hover:bg-muted"
                      >
                        <FileText className="size-3.5" aria-hidden /> {file.file_name}
                        <Download className="size-3.5 text-muted-foreground" aria-hidden />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {version.reviewed_at && version.reviewer && (
                <div className="mt-3 flex gap-2 rounded-md bg-muted/60 p-2.5">
                  <UserAvatar person={version.reviewer} className="size-6" />
                  <div className="min-w-0 text-small">
                    <p className="font-medium">
                      {version.status === 'APPROVED' ? (
                        <span className="inline-flex items-center gap-1 text-success">
                          <CheckCircle2 className="size-4" aria-hidden /> Approved
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-warning">
                          <RotateCcw className="size-4" aria-hidden /> Changes requested
                        </span>
                      )}{' '}
                      <span className="font-normal text-muted-foreground">
                        by {fullName(version.reviewer)} · {formatDate(version.reviewed_at, timeZone)}
                      </span>
                    </p>
                    {version.review_comment && <p className="mt-1 whitespace-pre-line">{version.review_comment}</p>}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function SubmitDialog({ taskId, resubmission }: { taskId: string; resubmission: boolean }) {
  const [open, setOpen] = React.useState(false)
  const [state, action] = useFormAction(submitTaskAction, { onSuccess: () => setOpen(false) })
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Send aria-hidden /> {resubmission ? 'Resubmit work' : 'Submit for review'}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{resubmission ? 'Resubmit work' : 'Submit for review'}</DialogTitle>
            <DialogDescription>Your reviewer is notified. Earlier versions stay in the history.</DialogDescription>
          </DialogHeader>
          <form action={action} className="grid gap-4">
            <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
            <input type="hidden" name="taskId" value={taskId} />
            <Field label="What are you submitting?" htmlFor="submit-message" error={state.fields?.message}>
              <Textarea
                id="submit-message"
                name="message"
                rows={5}
                maxLength={5000}
                required
                placeholder={
                  resubmission
                    ? 'What changed since the last version?'
                    : 'Links, notes, anything the reviewer should know'
                }
              />
            </Field>
            <Field
              label="Files (optional, up to 5)"
              htmlFor="submit-files"
              error={state.fields?.files ?? state.fields?.file}
            >
              <Input id="submit-files" name="files" type="file" multiple />
            </Field>
            <DialogFooter>
              <SubmitButton pendingLabel="Submitting…">{resubmission ? 'Resubmit' : 'Submit'}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ReviewDialog({ taskId, version }: { taskId: string; version: number }) {
  const [open, setOpen] = React.useState(false)
  const [decision, setDecision] = React.useState<'APPROVE' | 'REQUEST_CHANGES'>('APPROVE')
  const [state, action] = useFormAction(reviewTaskAction, { onSuccess: () => setOpen(false) })
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <CheckCircle2 aria-hidden /> Review version {version}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review version {version}</DialogTitle>
            <DialogDescription>
              Approving completes the task. Requesting changes sends it back to the assignee.
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="grid gap-4">
            <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
            <input type="hidden" name="taskId" value={taskId} />
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-label">Decision</legend>
              <label className="flex items-center gap-2 text-small">
                <input
                  type="radio"
                  name="decision"
                  value="APPROVE"
                  checked={decision === 'APPROVE'}
                  onChange={() => setDecision('APPROVE')}
                  className="size-4 accent-primary"
                />
                Approve
              </label>
              <label className="flex items-center gap-2 text-small">
                <input
                  type="radio"
                  name="decision"
                  value="REQUEST_CHANGES"
                  checked={decision === 'REQUEST_CHANGES'}
                  onChange={() => setDecision('REQUEST_CHANGES')}
                  className="size-4 accent-primary"
                />
                Request changes
              </label>
            </fieldset>
            <Field
              label={decision === 'REQUEST_CHANGES' ? 'What needs to change?' : 'Comment (optional)'}
              htmlFor="review-comment"
              error={state.fields?.comment}
            >
              <Textarea
                id="review-comment"
                name="comment"
                rows={4}
                maxLength={5000}
                required={decision === 'REQUEST_CHANGES'}
              />
            </Field>
            <DialogFooter>
              <SubmitButton pendingLabel="Saving…" variant={decision === 'APPROVE' ? 'default' : 'outline'}>
                {decision === 'APPROVE' ? 'Approve' : 'Request changes'}
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
