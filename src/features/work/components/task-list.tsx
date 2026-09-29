'use client'

import { RelativeTime } from '@/components/common/relative-time'
import * as React from 'react'
import Link from 'next/link'
import { CheckSquare, GitBranch, MessageSquare, Paperclip } from 'lucide-react'
import { PriorityBadge, StatusBadge } from '@/components/common/badges'
import { EmptyState } from '@/components/common/states'
import { AvatarGroup } from '@/components/common/user-avatar'
import { ConfirmDialog } from '@/components/feedback/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { inputClassName } from '@/components/ui/input'
import { Progress } from '@/components/ui/misc'
import { FormMessage } from '@/features/auth/components/form-bits'
import { useFormAction } from '@/features/interns/components/use-form-action'
import { cn, formatDay } from '@/lib/utils'
import { TASK_STATUS_LABELS } from '@/lib/work/tasks'
import { bulkTaskAction } from '@/server/actions/work'
import type { TaskRowView } from '@/server/services/task.service'
import { DeadlineLabel, SubmissionBadge } from './work-badges'

interface Option {
  value: string
  label: string
}

function TaskMeta({ task }: { task: TaskRowView }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted-foreground">
      {task.project && <span className="truncate">{task.project.name}</span>}
      {task.milestone && <span className="truncate">· {task.milestone.name}</span>}
      {task.parent_task_id && (
        <span className="inline-flex items-center gap-0.5">
          <GitBranch className="size-3" aria-hidden /> Subtask
        </span>
      )}
      {task.checklistTotal > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <CheckSquare className="size-3" aria-hidden /> {task.checklistDone}/{task.checklistTotal}
        </span>
      )}
      {task.commentCount > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <MessageSquare className="size-3" aria-hidden /> {task.commentCount}
          <span className="sr-only"> comments</span>
        </span>
      )}
      {task.attachmentCount > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <Paperclip className="size-3" aria-hidden /> {task.attachmentCount}
          <span className="sr-only"> attachments</span>
        </span>
      )}
    </span>
  )
}

/**
 * Task table (cards on phones) with optional bulk selection. Bulk actions go
 * to the server, which checks every task individually.
 */
export function TaskList({
  tasks,
  bulk,
  empty,
}: {
  tasks: TaskRowView[]
  bulk?: { people: Option[]; projects: Option[]; canAssign: boolean }
  empty: { title: string; description: string }
}) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const allSelected = tasks.length > 0 && tasks.every((t) => selected.has(t.id))

  if (tasks.length === 0) return <EmptyState icon={CheckSquare} title={empty.title} description={empty.description} />

  return (
    <div className="space-y-3">
      {bulk && selected.size > 0 && (
        <BulkBar ids={[...selected]} options={bulk} onDone={() => setSelected(new Set())} />
      )}

      {/* Phones: cards */}
      <ul className="grid grid-cols-1 gap-3 md:hidden" aria-label="Tasks">
        {tasks.map((task) => (
          <li key={task.id}>
            <Card className={cn('relative p-4', selected.has(task.id) && 'ring-2 ring-ring')}>
              <div className="flex items-start gap-3">
                {bulk && (
                  <input
                    type="checkbox"
                    checked={selected.has(task.id)}
                    onChange={() => toggle(task.id)}
                    aria-label={`Select ${task.title}`}
                    className="relative z-10 mt-1 size-4 accent-primary"
                  />
                )}
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Link href={`/tasks/${task.id}`} className="block font-medium after:absolute after:inset-0">
                    {task.title}
                  </Link>
                  <TaskMeta task={task} />
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={task.status} />
                    <PriorityBadge priority={task.priority} />
                    <SubmissionBadge status={task.submissionStatus} />
                    <DeadlineLabel deadline={task.deadline} />
                  </div>
                </div>
                {task.assignees.length > 0 && <AvatarGroup people={task.assignees.map((a) => a.user)} max={2} />}
              </div>
            </Card>
          </li>
        ))}
      </ul>

      {/* Desktop: table */}
      <div
        role="region"
        aria-label="Tasks"
        tabIndex={0}
        className="hidden overflow-x-auto rounded-xl border bg-card md:block"
      >
        <table className="w-full border-collapse text-small">
          <caption className="sr-only">Tasks</caption>
          <thead>
            <tr className="border-b bg-muted/50 text-left text-caption text-muted-foreground">
              {bulk && (
                <th scope="col" className="w-10 px-4">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(tasks.map((t) => t.id)))}
                    aria-label="Select all tasks on this page"
                    className="size-4 accent-primary"
                  />
                </th>
              )}
              <th scope="col" className="h-10 px-4 font-medium">
                Task
              </th>
              <th scope="col" className="px-4 font-medium">
                Assignee
              </th>
              <th scope="col" className="px-4 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 font-medium">
                Priority
              </th>
              <th scope="col" className="px-4 font-medium">
                Due
              </th>
              <th scope="col" className="hidden px-4 font-medium lg:table-cell">
                Progress
              </th>
              <th scope="col" className="hidden px-4 font-medium xl:table-cell">
                Submission
              </th>
              <th scope="col" className="hidden px-4 font-medium xl:table-cell">
                Updated
              </th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr
                key={task.id}
                className={cn('border-b last:border-b-0 hover:bg-muted/40', selected.has(task.id) && 'bg-accent/60')}
              >
                {bulk && (
                  <td className="px-4">
                    <input
                      type="checkbox"
                      checked={selected.has(task.id)}
                      onChange={() => toggle(task.id)}
                      aria-label={`Select ${task.title}`}
                      className="size-4 accent-primary"
                    />
                  </td>
                )}
                <td className="max-w-[26rem] px-4 py-2.5">
                  <Link href={`/tasks/${task.id}`} className="block truncate font-medium hover:underline">
                    {task.title}
                  </Link>
                  <TaskMeta task={task} />
                </td>
                <td className="px-4">
                  {task.assignees.length > 0 ? (
                    <AvatarGroup people={task.assignees.map((a) => a.user)} max={3} />
                  ) : (
                    <span className="text-caption text-muted-foreground">Unassigned</span>
                  )}
                </td>
                <td className="px-4">
                  <StatusBadge status={task.status} />
                </td>
                <td className="px-4">
                  <PriorityBadge priority={task.priority} />
                </td>
                <td className="px-4">
                  <div className="grid">
                    <span className="whitespace-nowrap">{task.due_date ? formatDay(task.due_date) : '—'}</span>
                    <DeadlineLabel deadline={task.deadline} />
                  </div>
                </td>
                <td className="hidden w-32 px-4 lg:table-cell">
                  <Progress value={task.progress} label={`${task.title}: ${task.progress}% done`} />
                </td>
                <td className="hidden px-4 xl:table-cell">
                  <SubmissionBadge status={task.submissionStatus} />
                </td>
                <td className="hidden whitespace-nowrap px-4 text-caption text-muted-foreground xl:table-cell">
                  <RelativeTime date={task.updated_at} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function BulkBar({
  ids,
  options,
  onDone,
}: {
  ids: string[]
  options: { people: Option[]; projects: Option[]; canAssign: boolean }
  onDone: () => void
}) {
  const [action, setAction] = React.useState<'assign' | 'priority' | 'status' | 'move' | 'archive'>('priority')
  const [confirmArchive, setConfirmArchive] = React.useState(false)
  const formRef = React.useRef<HTMLFormElement>(null)
  const [state, submit, pending] = useFormAction(bulkTaskAction, { onSuccess: onDone })
  const needsReason = action === 'status'

  const valueControl = {
    assign: (
      <select name="value" required aria-label="Assign to" className={cn(inputClassName, 'w-auto')}>
        {options.people.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
    ),
    priority: (
      <select name="value" aria-label="Priority" className={cn(inputClassName, 'w-auto')}>
        {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => (
          <option key={p} value={p}>
            {p.charAt(0) + p.slice(1).toLowerCase()}
          </option>
        ))}
      </select>
    ),
    status: (
      <select name="value" aria-label="Status" className={cn(inputClassName, 'w-auto')}>
        {(['ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'BACKLOG', 'COMPLETED', 'CANCELLED'] as const).map((s) => (
          <option key={s} value={s}>
            {TASK_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
    ),
    move: (
      <select name="value" required aria-label="Move to project" className={cn(inputClassName, 'w-auto')}>
        {options.projects.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
    ),
    archive: null,
  }[action]

  return (
    <form
      ref={formRef}
      action={submit}
      className="flex flex-col gap-2 rounded-xl border bg-accent/50 p-3 sm:flex-row sm:flex-wrap sm:items-center"
      onSubmit={(event) => {
        if (action === 'archive' && !confirmArchive) {
          event.preventDefault()
          setConfirmArchive(true)
        }
      }}
    >
      {ids.map((id) => (
        <input key={id} type="hidden" name="taskIds" value={id} />
      ))}
      <p className="text-small font-medium">{ids.length} selected</p>
      <select
        name="action"
        value={action}
        onChange={(event) => setAction(event.target.value as typeof action)}
        aria-label="Bulk action"
        className={cn(inputClassName, 'w-auto')}
      >
        {options.canAssign && <option value="assign">Assign to…</option>}
        <option value="priority">Change priority</option>
        <option value="status">Change status</option>
        {options.projects.length > 0 && <option value="move">Move to project</option>}
        <option value="archive">Delete</option>
      </select>
      {valueControl}
      {needsReason && (
        <input
          name="reason"
          placeholder="Reason (for blocked/cancelled)"
          aria-label="Reason"
          className={cn(inputClassName, 'sm:w-64')}
        />
      )}
      <Button type="submit" disabled={pending} variant={action === 'archive' ? 'destructive' : 'default'}>
        Apply
      </Button>
      <Button type="button" variant="ghost" onClick={onDone}>
        Clear selection
      </Button>
      <div className="w-full">
        <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
        {state.data?.failed && state.data.failed.length > 0 && (
          <p role="alert" className="text-caption text-destructive">
            {state.data.failed.length} task(s) weren’t changed:{' '}
            {[...new Set(state.data.failed.map((f) => f.error))].join('; ')}
          </p>
        )}
      </div>
      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`Delete ${ids.length} task${ids.length === 1 ? '' : 's'}?`}
        description="They disappear from boards and lists (and their subtasks with them). History stays in the activity log."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          formRef.current?.requestSubmit()
        }}
      />
    </form>
  )
}
