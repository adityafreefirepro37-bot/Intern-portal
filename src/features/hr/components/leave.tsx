'use client'

import * as React from 'react'
import { Check, Palmtree, Paperclip, Plus, X } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { EmptyState } from '@/components/common/states'
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
import { Input, inputClassName, Textarea } from '@/components/ui/input'
import { Field, FormMessage, SubmitButton } from '@/features/auth/components/form-bits'
import { useFormAction } from '@/features/interns/components/use-form-action'
import { cn, formatDay } from '@/lib/utils'
import { cancelLeaveAction, requestLeaveAction, reviewLeaveAction, setLeaveBalanceAction } from '@/server/actions/hr'
import { ActionButton, ReasonDialog } from './action-form'

export interface LeaveTypeOption {
  id: string
  name: string
  requires_attachment: boolean
  remaining: number | null
  unlimited: boolean
}

/** Request leave (or, for HR with leave.manage, record leave on someone's behalf). */
export function LeaveRequestButton({
  types,
  today,
  people,
  label = 'Request leave',
}: {
  types: LeaveTypeOption[]
  today: string
  /** HR only: people who can be chosen; enables the override field. */
  people?: { id: string; name: string }[]
  label?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [state, action] = useFormAction(requestLeaveAction, { onSuccess: () => setOpen(false) })
  const v = state.values
  const [typeId, setTypeId] = React.useState(v?.leaveTypeId ?? types[0]?.id ?? '')
  const type = types.find((t) => t.id === typeId)
  const onBehalf = Boolean(people)
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={types.length === 0}>
        <Plus aria-hidden /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>
              Only working days count — weekends and company holidays in the range are excluded automatically.
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="grid gap-4">
            <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
            {onBehalf && (
              <Field label="Intern" htmlFor="leave-user" error={state.fields?.userId}>
                <select
                  id="leave-user"
                  name="userId"
                  required
                  className={inputClassName}
                  defaultValue={v?.userId ?? ''}
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  {people!.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field
              label="Leave type"
              htmlFor="leave-type"
              error={state.fields?.leaveTypeId}
              hint={
                type && !onBehalf
                  ? type.unlimited
                    ? 'No fixed allowance — tracked only.'
                    : `${type.remaining} day${type.remaining === 1 ? '' : 's'} remaining.`
                  : undefined
              }
            >
              <select
                id="leave-type"
                name="leaveTypeId"
                required
                className={inputClassName}
                value={typeId}
                onChange={(event) => setTypeId(event.target.value)}
              >
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="From" htmlFor="leave-start" error={state.fields?.startDate}>
                <Input id="leave-start" name="startDate" type="date" required defaultValue={v?.startDate ?? today} />
              </Field>
              <Field label="To (inclusive)" htmlFor="leave-end" error={state.fields?.endDate}>
                <Input id="leave-end" name="endDate" type="date" required defaultValue={v?.endDate ?? today} />
              </Field>
            </div>
            <Field label="Reason" htmlFor="leave-reason" error={state.fields?.reason}>
              <Textarea
                id="leave-reason"
                name="reason"
                required
                minLength={3}
                maxLength={1000}
                defaultValue={v?.reason}
              />
            </Field>
            <Field
              label={type?.requires_attachment ? 'Supporting document' : 'Supporting document (optional)'}
              htmlFor="leave-file"
              hint="PDF, PNG, JPEG or DOCX. Visible only to you and the people who review your leave."
              error={state.fields?.attachment}
            >
              <Input
                id="leave-file"
                name="attachment"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.docx"
                required={type?.requires_attachment}
              />
            </Field>
            {onBehalf && (
              <Field
                label="Override reason (only if the dates overlap other leave or exceed the balance)"
                htmlFor="leave-override"
                error={state.fields?.overrideReason}
              >
                <Input id="leave-override" name="overrideReason" maxLength={500} defaultValue={v?.overrideReason} />
              </Field>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton pendingLabel="Sending…">{onBehalf ? 'Record leave' : 'Send request'}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export interface LeaveRow {
  id: string
  start_date: Date
  end_date: Date
  days: number
  reason: string | null
  status: string
  review_comment: string | null
  overlap_override: boolean
  override_reason: string | null
  hasAttachment: boolean
  leave_type: { name: string }
  user: { id: string; first_name: string; last_name: string; display_name: string | null; avatar_url: string | null }
  userName: string
  reviewerName: string | null
  canCancel?: boolean
  canReview?: boolean
}

/** Leave requests as a responsive list (cards on phones, rows on wider screens). */
export function LeaveList({
  rows,
  showPerson,
  canManage = false,
  highlight,
  emptyText = 'No leave requests yet.',
}: {
  rows: LeaveRow[]
  showPerson: boolean
  canManage?: boolean
  highlight?: string
  emptyText?: string
}) {
  const [rejecting, setRejecting] = React.useState<LeaveRow | null>(null)
  const [approving, setApproving] = React.useState<LeaveRow | null>(null)
  const [cancelling, setCancelling] = React.useState<LeaveRow | null>(null)
  if (rows.length === 0) return <EmptyState compact icon={Palmtree} title="Nothing here" description={emptyText} />
  return (
    <>
      <ul className="divide-y rounded-xl border bg-card">
        {rows.map((row) => (
          <li
            key={row.id}
            id={`leave-${row.id}`}
            className={cn(
              'flex flex-col gap-3 p-4 sm:flex-row sm:items-center',
              highlight === row.id && 'bg-primary/5',
            )}
          >
            {showPerson && <UserAvatar person={row.user} className="hidden size-9 sm:flex" />}
            <div className="min-w-0 flex-1 space-y-0.5 text-small">
              <p className="font-medium">
                {showPerson && `${row.userName} · `}
                {row.leave_type.name}
              </p>
              <p>
                {formatDay(row.start_date)}
                {row.end_date.getTime() !== row.start_date.getTime() && ` – ${formatDay(row.end_date)}`} ·{' '}
                <span className="tabular">
                  {row.days} working day{row.days === 1 ? '' : 's'}
                </span>
              </p>
              {row.reason && <p className="text-muted-foreground">“{row.reason}”</p>}
              {row.review_comment && (
                <p className="text-caption text-muted-foreground">
                  {row.reviewerName ? `${row.reviewerName}: ` : ''}
                  {row.review_comment}
                </p>
              )}
              {row.overlap_override && (
                <p className="text-caption text-warning">Overlap approved by HR: {row.override_reason}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={row.status} />
              {row.hasAttachment && (
                <a
                  href={`/api/leave/${row.id}/attachment`}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-caption text-primary hover:underline"
                >
                  <Paperclip className="size-3.5" aria-hidden /> Document
                </a>
              )}
              {row.canReview && (
                <>
                  {canManage ? (
                    <Button
                      size="sm"
                      onClick={() => setApproving(row)}
                      aria-label={`Approve leave for ${row.userName}`}
                    >
                      <Check aria-hidden /> Approve
                    </Button>
                  ) : (
                    <ActionButton
                      action={reviewLeaveAction}
                      fields={{ leaveId: row.id, decision: 'APPROVED' }}
                      size="sm"
                      aria-label={`Approve leave for ${row.userName}`}
                    >
                      <Check aria-hidden /> Approve
                    </ActionButton>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRejecting(row)}
                    aria-label={`Reject leave for ${row.userName}`}
                  >
                    <X aria-hidden /> Reject
                  </Button>
                </>
              )}
              {row.canCancel && (
                <Button size="sm" variant="ghost" onClick={() => setCancelling(row)}>
                  Cancel
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {rejecting && (
        <ReasonDialog
          open
          onOpenChange={(open) => !open && setRejecting(null)}
          title="Reject leave"
          description={`${rejecting.userName} · ${rejecting.leave_type.name}, ${formatDay(rejecting.start_date)} – ${formatDay(rejecting.end_date)}`}
          action={reviewLeaveAction}
          fields={{ leaveId: rejecting.id, decision: 'REJECTED' }}
          confirmLabel="Reject"
          destructive
        />
      )}
      {approving && (
        <ReasonDialog
          open
          onOpenChange={(open) => !open && setApproving(null)}
          title="Approve leave"
          description={`${approving.userName} · ${approving.days} working day${approving.days === 1 ? '' : 's'}`}
          action={reviewLeaveAction}
          fields={{ leaveId: approving.id, decision: 'APPROVED' }}
          reasonLabel="Comment"
          required={false}
          confirmLabel="Approve"
        >
          <Field label="Override reason (only needed if this overlaps approved leave)" htmlFor="approve-override">
            <Input id="approve-override" name="overrideReason" maxLength={500} />
          </Field>
        </ReasonDialog>
      )}
      {cancelling && (
        <ReasonDialog
          open
          onOpenChange={(open) => !open && setCancelling(null)}
          title="Cancel this leave?"
          description={`${cancelling.leave_type.name}, ${formatDay(cancelling.start_date)} – ${formatDay(cancelling.end_date)}. The days return to the balance.`}
          action={cancelLeaveAction}
          fields={{ leaveId: cancelling.id }}
          reasonLabel="Note"
          required={false}
          confirmLabel="Cancel leave"
          destructive
        />
      )}
    </>
  )
}

/** HR: adjust one person's allocation for a leave type (audited with before/after). */
export function BalanceForm({
  userId,
  type,
  allocated,
}: {
  userId: string
  type: { id: string; name: string }
  allocated: number | null
}) {
  const [state, action] = useFormAction(setLeaveBalanceAction)
  const id = `bal-${type.id}`
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="leaveTypeId" value={type.id} />
      <Field label={`${type.name} allowance (days)`} htmlFor={id} error={state.fields?.allocatedDays}>
        <Input
          id={id}
          name="allocatedDays"
          type="number"
          min={0}
          max={366}
          required
          defaultValue={allocated ?? ''}
          className="w-28"
        />
      </Field>
      <Field label="Note" htmlFor={`${id}-note`}>
        <Input id={`${id}-note`} name="notes" maxLength={300} className="w-56" />
      </Field>
      <SubmitButton size="sm" variant="outline">
        Save
      </SubmitButton>
    </form>
  )
}
