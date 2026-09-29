'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { TaskPriority, TaskStatus } from '@prisma/client'
import { Pencil, Trash2, UserPlus } from 'lucide-react'
import { ConfirmDialog } from '@/components/feedback/confirm-dialog'
import { useToast } from '@/components/feedback/toast'
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
import { useUnsavedChanges } from '@/features/interns/components/use-unsaved-changes'
import { fullName } from '@/lib/utils'
import { findTransition, TASK_STATUS_LABELS } from '@/lib/work/tasks'
import { deleteTaskAction, setAssigneesAction, taskStatusAction, updateTaskAction } from '@/server/actions/work'

type Person = { id: string; first_name: string; last_name: string; display_name: string | null }

const TARGET_LABELS: Partial<Record<TaskStatus, string>> = {
  IN_PROGRESS: 'Start work',
  BLOCKED: 'Report blocker',
  ASSIGNED: 'Move to Assigned',
  BACKLOG: 'Move to backlog',
  COMPLETED: 'Mark complete',
  CANCELLED: 'Cancel task',
}

/** Status buttons for the moves this viewer may make (computed on the server). */
export function TaskStatusControl({
  taskId,
  status,
  targets,
}: {
  taskId: string
  status: TaskStatus
  targets: TaskStatus[]
}) {
  const [asking, setAsking] = React.useState<TaskStatus | null>(null)
  const [, dispatch, pending] = useFormAction(taskStatusAction, { onSuccess: () => setAsking(null) })
  if (targets.length === 0) return null
  const label = (to: TaskStatus) =>
    status === 'COMPLETED' && to === 'IN_PROGRESS'
      ? 'Reopen'
      : status === 'BLOCKED' && to === 'IN_PROGRESS'
        ? 'Resume work'
        : status === 'CANCELLED' && to === 'BACKLOG'
          ? 'Restore'
          : (TARGET_LABELS[to] ?? TASK_STATUS_LABELS[to])

  return (
    <div className="flex flex-wrap gap-2">
      {targets.map((to) => {
        const needsReason = Boolean(findTransition(status, to)?.reason)
        const primary = to === 'IN_PROGRESS' || (to === 'COMPLETED' && status === 'IN_PROGRESS')
        if (needsReason) {
          return (
            <Button
              key={to}
              variant={to === 'CANCELLED' ? 'ghost' : 'outline'}
              onClick={() => setAsking(to)}
              disabled={pending}
            >
              {label(to)}
            </Button>
          )
        }
        return (
          <form key={to} action={dispatch}>
            <input type="hidden" name="taskId" value={taskId} />
            <input type="hidden" name="to" value={to} />
            <SubmitButton variant={primary ? 'default' : 'outline'} pendingLabel="Saving…">
              {label(to)}
            </SubmitButton>
          </form>
        )
      })}
      {asking && (
        <Dialog open onOpenChange={(open) => !open && setAsking(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{label(asking)}</DialogTitle>
              <DialogDescription>
                {asking === 'BLOCKED'
                  ? 'Describe what’s blocking you. The task owner and project manager are notified.'
                  : 'A reason is required and recorded in the activity log.'}
              </DialogDescription>
            </DialogHeader>
            <form action={dispatch} className="grid gap-4">
              <input type="hidden" name="taskId" value={taskId} />
              <input type="hidden" name="to" value={asking} />
              <Field label={asking === 'BLOCKED' ? 'What’s blocking this task?' : 'Reason'} htmlFor="status-reason">
                <Textarea id="status-reason" name="reason" rows={3} maxLength={500} required autoFocus />
              </Field>
              <DialogFooter>
                <SubmitButton variant={asking === 'CANCELLED' ? 'destructive' : 'default'} pendingLabel="Saving…">
                  {label(asking)}
                </SubmitButton>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

export interface EditableTask {
  id: string
  title: string
  description: string | null
  priority: TaskPriority
  startDate: string
  dueDate: string
  estimatedHours: string
  milestoneId: string | null
}

export function EditTaskButton({
  task,
  milestones,
}: {
  task: EditableTask
  milestones: { id: string; name: string }[]
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Pencil aria-hidden /> Edit
      </Button>
      {open && <EditTaskDialog task={task} milestones={milestones} onClose={() => setOpen(false)} />}
    </>
  )
}

function EditTaskDialog({
  task,
  milestones,
  onClose,
}: {
  task: EditableTask
  milestones: { id: string; name: string }[]
  onClose: () => void
}) {
  const [dirty, setDirty] = React.useState(false)
  const [state, action] = useFormAction(updateTaskAction, { onSuccess: onClose })
  useUnsavedChanges(dirty)
  const v = state.values
  const f = state.fields ?? {}
  return (
    <Dialog open onOpenChange={(next) => !next && (!dirty || window.confirm('Discard your changes?')) && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
          <DialogDescription>Priority and due-date changes are recorded in the activity log.</DialogDescription>
        </DialogHeader>
        <form
          action={action}
          onChange={() => setDirty(true)}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          noValidate
        >
          <div className="sm:col-span-2">
            <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
          </div>
          <input type="hidden" name="taskId" value={task.id} />
          <div className="sm:col-span-2">
            <Field label="Title" htmlFor="edit-title" error={f.title}>
              <Input id="edit-title" name="title" required maxLength={200} defaultValue={v?.title ?? task.title} />
            </Field>
          </div>
          <Field label="Priority" htmlFor="edit-priority" error={f.priority}>
            <select
              id="edit-priority"
              name="priority"
              defaultValue={v?.priority ?? task.priority}
              className={inputClassName}
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </Field>
          <Field label="Milestone" htmlFor="edit-milestone" error={f.milestoneId}>
            <select
              id="edit-milestone"
              name="milestoneId"
              defaultValue={v?.milestoneId ?? task.milestoneId ?? ''}
              className={inputClassName}
              disabled={milestones.length === 0}
            >
              <option value="">None</option>
              {milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Start date" htmlFor="edit-start" error={f.startDate}>
            <Input id="edit-start" name="startDate" type="date" defaultValue={v?.startDate ?? task.startDate} />
          </Field>
          <Field label="Due date" htmlFor="edit-due" error={f.dueDate}>
            <Input id="edit-due" name="dueDate" type="date" defaultValue={v?.dueDate ?? task.dueDate} />
          </Field>
          <Field label="Estimate (hours)" htmlFor="edit-estimate" error={f.estimatedHours}>
            <Input
              id="edit-estimate"
              name="estimatedHours"
              type="number"
              min={0}
              max={1000}
              step={0.5}
              defaultValue={v?.estimatedHours ?? task.estimatedHours}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description" htmlFor="edit-description" error={f.description}>
              <Textarea
                id="edit-description"
                name="description"
                rows={6}
                maxLength={10_000}
                defaultValue={v?.description ?? task.description ?? ''}
              />
            </Field>
          </div>
          <DialogFooter className="sm:col-span-2">
            <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function AssigneesButton({
  taskId,
  current,
  options,
}: {
  taskId: string
  current: string[]
  options: Person[]
}) {
  const [open, setOpen] = React.useState(false)
  const [state, action] = useFormAction(setAssigneesAction, { onSuccess: () => setOpen(false) })
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <UserPlus aria-hidden /> Assign
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assignees</DialogTitle>
            <DialogDescription>Only project members can be assigned. New assignees are notified.</DialogDescription>
          </DialogHeader>
          <form action={action} className="grid gap-4">
            <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
            <input type="hidden" name="taskId" value={taskId} />
            {options.length === 0 ? (
              <p className="text-small text-muted-foreground">Add people to the project first.</p>
            ) : (
              <fieldset className="grid max-h-72 gap-2 overflow-y-auto">
                <legend className="sr-only">People</legend>
                {options.map((person) => (
                  <label key={person.id} className="flex items-center gap-2 text-small">
                    <input
                      type="checkbox"
                      name="assigneeIds"
                      value={person.id}
                      defaultChecked={current.includes(person.id)}
                      className="size-4 accent-primary"
                    />
                    {fullName(person)}
                  </label>
                ))}
              </fieldset>
            )}
            <DialogFooter>
              <SubmitButton pendingLabel="Saving…">Save assignees</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function DeleteTaskButton({ taskId, title, redirectTo }: { taskId: string; title: string; redirectTo: string }) {
  const [open, setOpen] = React.useState(false)
  const router = useRouter()
  const { toast } = useToast()
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden /> Delete
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete “${title}”?`}
        description="The task and its subtasks disappear from lists and boards. Its history stays in the activity log."
        confirmLabel="Delete task"
        destructive
        onConfirm={async () => {
          const formData = new FormData()
          formData.set('taskId', taskId)
          const result = await deleteTaskAction({ status: 'idle' }, formData)
          toast({ title: result.message ?? 'Done', variant: result.status === 'error' ? 'error' : 'success' })
          if (result.status === 'success') router.push(redirectTo)
        }}
      />
    </>
  )
}
