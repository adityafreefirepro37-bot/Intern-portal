'use client'

import * as React from 'react'
import Link from 'next/link'
import { CheckCircle2, Sparkles, TriangleAlert, XCircle } from 'lucide-react'
import { Select } from '@/components/forms/editor-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FormMessage, SubmitButton } from '@/features/auth/components/form-bits'
import { useFormAction } from '@/features/interns/components/use-form-action'
import { cancelAiActionAction, confirmAiActionAction } from '@/server/actions/ai'
import type { ActionProposal, CreateSubtasksPayload, CreateTaskPayload } from '@/server/ai/actions.service'

const PRIORITIES = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
]

/**
 * The AI's proposal, shown before anything happens. The fields can be edited;
 * Confirm sends them to the server, which validates them and runs the normal
 * task service. Cancel, or doing nothing for 15 minutes, leaves everything as it was.
 */
export function ActionCard({ initial }: { initial: ActionProposal }) {
  const [proposal, setProposal] = React.useState(initial)
  const id = React.useId()
  const [confirmState, confirm] = useFormAction(confirmAiActionAction, {
    toast: false,
    onSuccess: (state) => state.data && setProposal(state.data),
  })
  const [, cancel] = useFormAction(cancelAiActionAction, {
    toast: false,
    onSuccess: (state) => state.data && setProposal(state.data),
  })
  // Display only; the server re-checks expiry on confirm.
  const [openedAt] = React.useState(() => Date.now())
  const expired = proposal.status === 'PROPOSED' && new Date(proposal.expiresAt).getTime() < openedAt

  if (proposal.status === 'EXECUTED') {
    return (
      <div role="status" className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/5 p-3 text-small">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
        <p>
          {proposal.result?.message ?? 'Done.'}{' '}
          {proposal.result?.href && (
            <Link href={proposal.result.href} className="font-medium text-primary underline underline-offset-2">
              Open it
            </Link>
          )}
        </p>
      </div>
    )
  }
  if (proposal.status === 'FAILED') {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-small">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <p>{proposal.error ?? 'The action could not be completed.'} Nothing was created.</p>
      </div>
    )
  }
  if (proposal.status !== 'PROPOSED' || expired) {
    return (
      <div className="flex items-center gap-2 rounded-lg border p-3 text-small text-muted-foreground">
        <XCircle className="size-4 shrink-0" aria-hidden />
        {proposal.status === 'CANCELLED' ? 'Cancelled. Nothing was changed.' : 'This proposal expired. Ask again if you still need it.'}
      </div>
    )
  }

  const isTask = proposal.type === 'create_task'
  const task = proposal.payload as CreateTaskPayload
  const subtasks = proposal.payload as CreateSubtasksPayload

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3" role="group" aria-label="AI proposal, waiting for your confirmation">
      <p className="mb-3 flex items-center gap-1.5 text-caption font-semibold text-primary">
        <Sparkles className="size-3.5" aria-hidden />
        AYAVA AI proposes — nothing happens until you confirm
      </p>
      {proposal.warnings.length > 0 && (
        <ul className="mb-3 space-y-1 text-caption text-warning">
          {proposal.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-1.5">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {warning}
            </li>
          ))}
        </ul>
      )}
      <FormMessage status={confirmState.status === 'error' ? 'error' : 'idle'} message={confirmState.message} />
      <form action={confirm} className="grid gap-3">
        <input type="hidden" name="actionId" value={proposal.id} />
        {isTask ? (
          <>
            <Field label="Task" htmlFor={`${id}-title`} error={confirmState.fields?.title}>
              <Input id={`${id}-title`} name="title" required minLength={2} maxLength={200} defaultValue={task.title} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Due date" htmlFor={`${id}-due`} error={confirmState.fields?.dueDate}>
                <Input id={`${id}-due`} name="dueDate" type="date" defaultValue={task.dueDate ?? ''} />
              </Field>
              <Field label="Priority" htmlFor={`${id}-priority`} error={confirmState.fields?.priority}>
                <Select id={`${id}-priority`} name="priority" defaultValue={task.priority} options={PRIORITIES} />
              </Field>
            </div>
            <Field label="Assignee" htmlFor={`${id}-assignee`} error={confirmState.fields?.assigneeIds}>
              <Select
                id={`${id}-assignee`}
                name="assigneeId"
                defaultValue={task.assigneeIds[0] ?? ''}
                options={proposal.assignees.map((p) => ({ value: p.id, label: p.name }))}
                empty="No assignee"
              />
            </Field>
            {proposal.display.project && <p className="text-caption text-muted-foreground">Project: {proposal.display.project}</p>}
          </>
        ) : (
          <div className="text-small">
            <p className="mb-1 font-medium">Add {subtasks.titles.length} subtasks to “{proposal.display.parentTask}”</p>
            <ol className="list-decimal space-y-0.5 pl-5">
              {subtasks.titles.map((title) => (
                <li key={title}>{title}</li>
              ))}
            </ol>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <SubmitButton pendingLabel="Working…">Confirm</SubmitButton>
          <Button type="submit" variant="ghost" formAction={cancel} formNoValidate>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
