'use client'

import * as React from 'react'
import { Check, ClipboardEdit, PencilLine, X } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { EmptyState } from '@/components/common/states'
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
import { cn, formatDay } from '@/lib/utils'
import {
  cancelCorrectionAction,
  requestCorrectionAction,
  reviewCorrectionAction,
  updateAttendanceAction,
} from '@/server/actions/hr'
import { ActionButton, ReasonDialog } from './action-form'

export interface CorrectionItem {
  id: string
  date: Date
  category: string
  reason: string
  status: string
  requestedCheckIn: string | null
  requestedCheckOut: string | null
  originalCheckIn: string | null
  originalCheckOut: string | null
  reviewComment: string | null
  userName: string
  reviewer: string | null
}

/** Intern: ask HR/manager to fix a day's check-in or check-out. */
export function CorrectionRequestButton({
  categories,
  today,
  minDate,
}: {
  categories: Record<string, string>
  today: string
  minDate: string
}) {
  const [open, setOpen] = React.useState(false)
  const [state, action] = useFormAction(requestCorrectionAction, { onSuccess: () => setOpen(false) })
  const v = state.values
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <ClipboardEdit aria-hidden /> Request correction
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request an attendance correction</DialogTitle>
            <DialogDescription>
              Your original times are kept alongside the correction. Your manager or HR reviews it.
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="grid gap-4">
            <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Date" htmlFor="corr-date" error={state.fields?.date}>
                <Input
                  id="corr-date"
                  name="date"
                  type="date"
                  required
                  max={today}
                  min={minDate}
                  defaultValue={v?.date ?? today}
                />
              </Field>
              <Field label="What happened" htmlFor="corr-category" error={state.fields?.category}>
                <select
                  id="corr-category"
                  name="category"
                  className={inputClassName}
                  defaultValue={v?.category ?? 'FORGOT_CHECK_OUT'}
                >
                  {Object.entries(categories).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Correct check-in"
                htmlFor="corr-in"
                hint="Leave empty to keep it"
                error={state.fields?.checkIn}
              >
                <Input id="corr-in" name="checkIn" type="time" defaultValue={v?.checkIn} />
              </Field>
              <Field
                label="Correct check-out"
                htmlFor="corr-out"
                hint="Leave empty to keep it"
                error={state.fields?.checkOut}
              >
                <Input id="corr-out" name="checkOut" type="time" defaultValue={v?.checkOut} />
              </Field>
            </div>
            <Field label="Reason" htmlFor="corr-reason" error={state.fields?.reason}>
              <Textarea
                id="corr-reason"
                name="reason"
                required
                minLength={3}
                maxLength={1000}
                defaultValue={v?.reason}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton pendingLabel="Sending…">Send request</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Times({ from, to }: { from: [string | null, string | null]; to: [string | null, string | null] }) {
  const show = (value: string | null) => value ?? '—'
  return (
    <span className="tabular">
      <span className="text-muted-foreground line-through decoration-muted-foreground/60">
        {show(from[0])}–{show(from[1])}
      </span>{' '}
      <span aria-hidden>→</span>
      <span className="sr-only">changed to</span> {to[0] ?? show(from[0])}–{to[1] ?? show(from[1])}
    </span>
  )
}

/** Corrections list — reviewers get approve/reject; requesters can withdraw pending ones. */
export function CorrectionList({
  items,
  categories,
  mode,
  highlight,
}: {
  items: CorrectionItem[]
  categories: Record<string, string>
  mode: 'review' | 'own'
  highlight?: string
}) {
  const [rejecting, setRejecting] = React.useState<CorrectionItem | null>(null)
  if (items.length === 0) {
    return (
      <EmptyState
        compact
        icon={ClipboardEdit}
        title={mode === 'review' ? 'No corrections waiting' : 'No correction requests'}
        description={mode === 'review' ? 'Requests from interns you can review appear here.' : undefined}
      />
    )
  }
  return (
    <>
      <ul className="divide-y rounded-xl border bg-card">
        {items.map((item) => (
          <li
            key={item.id}
            id={`correction-${item.id}`}
            className={cn(
              'flex flex-col gap-3 p-4 sm:flex-row sm:items-start',
              highlight === item.id && 'bg-primary/5',
            )}
          >
            <div className="min-w-0 flex-1 space-y-1 text-small">
              <p className="font-medium">
                {mode === 'review' && `${item.userName} · `}
                {formatDay(item.date)} · {categories[item.category] ?? item.category}
              </p>
              <p>
                <Times
                  from={[item.originalCheckIn, item.originalCheckOut]}
                  to={[item.requestedCheckIn, item.requestedCheckOut]}
                />
              </p>
              <p className="text-muted-foreground">“{item.reason}”</p>
              {item.reviewComment && (
                <p className="text-caption text-muted-foreground">
                  {item.reviewer ? `${item.reviewer}: ` : ''}
                  {item.reviewComment}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={item.status} />
              {mode === 'review' && item.status === 'PENDING' && (
                <>
                  <ActionButton
                    action={reviewCorrectionAction}
                    fields={{ correctionId: item.id, decision: 'APPROVED' }}
                    size="sm"
                    aria-label={`Approve correction for ${item.userName} on ${formatDay(item.date)}`}
                  >
                    <Check aria-hidden /> Approve
                  </ActionButton>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRejecting(item)}
                    aria-label={`Reject correction for ${item.userName} on ${formatDay(item.date)}`}
                  >
                    <X aria-hidden /> Reject
                  </Button>
                </>
              )}
              {mode === 'own' && item.status === 'PENDING' && (
                <ActionButton
                  action={cancelCorrectionAction}
                  fields={{ correctionId: item.id }}
                  size="sm"
                  variant="ghost"
                >
                  Withdraw
                </ActionButton>
              )}
            </div>
          </li>
        ))}
      </ul>
      {rejecting && (
        <ReasonDialog
          open
          onOpenChange={(open) => !open && setRejecting(null)}
          title="Reject correction"
          description={`${rejecting.userName} · ${formatDay(rejecting.date)}. The original times stay as they are.`}
          action={reviewCorrectionAction}
          fields={{ correctionId: rejecting.id, decision: 'REJECTED' }}
          confirmLabel="Reject"
          destructive
        />
      )}
    </>
  )
}

/** HR: set or fix a person's attendance for a day (requires a reason; audited). */
export function AttendanceEditButton({
  people,
  today,
  statuses,
  defaultUserId,
}: {
  people: { id: string; name: string }[]
  today: string
  statuses: Record<string, string>
  defaultUserId?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [state, action] = useFormAction(updateAttendanceAction, { onSuccess: () => setOpen(false) })
  const v = state.values
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <PencilLine aria-hidden /> Edit attendance
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit attendance</DialogTitle>
            <DialogDescription>
              Enter times to recalculate the status from the rules, or choose a status directly. The previous values and
              your reason are kept in the audit log.
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="grid gap-4">
            <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Intern" htmlFor="edit-user" error={state.fields?.userId}>
                <select
                  id="edit-user"
                  name="userId"
                  required
                  className={inputClassName}
                  defaultValue={v?.userId ?? defaultUserId ?? ''}
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Date" htmlFor="edit-date" error={state.fields?.date}>
                <Input id="edit-date" name="date" type="date" required max={today} defaultValue={v?.date ?? today} />
              </Field>
              <Field label="Check-in" htmlFor="edit-in" error={state.fields?.checkIn}>
                <Input id="edit-in" name="checkIn" type="time" defaultValue={v?.checkIn} />
              </Field>
              <Field label="Check-out" htmlFor="edit-out" error={state.fields?.checkOut}>
                <Input id="edit-out" name="checkOut" type="time" defaultValue={v?.checkOut} />
              </Field>
            </div>
            <Field label="Status (optional override)" htmlFor="edit-status" error={state.fields?.status}>
              <select id="edit-status" name="status" className={inputClassName} defaultValue={v?.status ?? ''}>
                <option value="">Calculate from times</option>
                {Object.entries(statuses).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reason" htmlFor="edit-reason" error={state.fields?.reason}>
              <Textarea
                id="edit-reason"
                name="reason"
                required
                minLength={3}
                maxLength={1000}
                defaultValue={v?.reason}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton>Save</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
