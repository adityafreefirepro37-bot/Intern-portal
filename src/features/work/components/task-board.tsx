'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { TaskStatus } from '@prisma/client'
import { CheckSquare, Loader2, MessageSquare, MoreHorizontal, Paperclip } from 'lucide-react'
import { PriorityBadge } from '@/components/common/badges'
import { AvatarGroup } from '@/components/common/user-avatar'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { findTransition, TASK_STATUS_LABELS } from '@/lib/work/tasks'
import { taskStatusAction } from '@/server/actions/work'
import type { TaskBoard as TaskBoardData, TaskRowView } from '@/server/services/task.service'
import { DeadlineLabel, SubmissionBadge } from './work-badges'

type Move = { task: TaskRowView; to: TaskStatus }

/**
 * Kanban board. Cards can be dragged only to columns the server would allow
 * for this viewer (a hint computed server-side), and every card has a
 * "Move to…" menu as the keyboard/touch alternative. Each move is sent to
 * taskLifecycleService; nothing changes on the client until it succeeds.
 */
export function TaskBoard({ columns }: { columns: TaskBoardData['columns'] }) {
  const router = useRouter()
  const { toast } = useToast()
  const [dragging, setDragging] = React.useState<TaskRowView | null>(null)
  const [over, setOver] = React.useState<TaskStatus | null>(null)
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const [askReason, setAskReason] = React.useState<Move | null>(null)

  async function move({ task, to }: Move, reason?: string) {
    if (task.status === to) return
    setPendingId(task.id)
    const formData = new FormData()
    formData.set('taskId', task.id)
    formData.set('to', to)
    if (reason) formData.set('reason', reason)
    const result = await taskStatusAction({ status: 'idle' }, formData)
    setPendingId(null)
    toast({
      title: result.message ?? (result.status === 'error' ? 'Couldn’t move the task' : 'Moved'),
      variant: result.status === 'error' ? 'error' : 'success',
    })
    if (result.status === 'success') router.refresh()
  }

  function request(task: TaskRowView, to: TaskStatus) {
    if (findTransition(task.status, to)?.reason) setAskReason({ task, to })
    else void move({ task, to })
  }

  return (
    <>
      <p className="sr-only">Use each card’s “Move to” menu to change its status without dragging.</p>
      <div
        className="-mx-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0"
        role="region"
        aria-label="Task board"
        tabIndex={0}
      >
        <div className="flex w-max gap-3">
          {columns.map((column) => {
            const droppable = dragging?.targets.includes(column.status) ?? false
            return (
              <section
                key={column.status}
                aria-label={`${TASK_STATUS_LABELS[column.status]}, ${column.count} tasks`}
                onDragOver={(event) => {
                  if (!droppable) return
                  event.preventDefault()
                  setOver(column.status)
                }}
                onDragLeave={() => setOver((current) => (current === column.status ? null : current))}
                onDrop={(event) => {
                  event.preventDefault()
                  setOver(null)
                  if (dragging && droppable) request(dragging, column.status)
                  setDragging(null)
                }}
                className={cn(
                  'flex w-[17rem] shrink-0 flex-col rounded-xl border bg-muted/40 transition-colors',
                  dragging && !droppable && dragging.status !== column.status && 'opacity-60',
                  droppable && 'border-dashed border-primary/60',
                  over === column.status && 'bg-accent',
                )}
              >
                <header className="flex items-center justify-between px-3 py-2.5">
                  <h2 className="text-label">{TASK_STATUS_LABELS[column.status]}</h2>
                  <span className="tabular rounded-full bg-card px-2 text-caption text-muted-foreground">
                    {column.count}
                  </span>
                </header>
                <ol className="flex min-h-24 flex-col gap-2 px-2 pb-2">
                  {column.tasks.length === 0 && (
                    <li className="rounded-lg border border-dashed p-3 text-center text-caption text-muted-foreground">
                      No tasks
                    </li>
                  )}
                  {column.tasks.map((task) => (
                    <BoardCard
                      key={task.id}
                      task={task}
                      pending={pendingId === task.id}
                      onDragStart={() => setDragging(task)}
                      onDragEnd={() => {
                        setDragging(null)
                        setOver(null)
                      }}
                      onMove={(to) => request(task, to)}
                    />
                  ))}
                  {column.count > column.tasks.length && (
                    <li className="px-1 text-caption text-muted-foreground">
                      +{column.count - column.tasks.length} more — narrow the filters or use the list view
                    </li>
                  )}
                </ol>
              </section>
            )
          })}
        </div>
      </div>
      {askReason && (
        <ReasonDialog
          move={askReason}
          onCancel={() => setAskReason(null)}
          onConfirm={async (reason) => {
            const current = askReason
            setAskReason(null)
            await move(current, reason)
          }}
        />
      )}
    </>
  )
}

function BoardCard({
  task,
  pending,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  task: TaskRowView
  pending: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onMove: (to: TaskStatus) => void
}) {
  const movable = task.targets.length > 0 && !pending
  return (
    <li
      draggable={movable}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', task.id)
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      aria-busy={pending}
      className={cn(
        'relative rounded-lg border bg-card p-3 text-small shadow-xs transition-shadow hover:shadow-sm',
        movable && 'cursor-grab active:cursor-grabbing',
        pending && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-2">
        <Link href={`/tasks/${task.id}`} className="min-w-0 flex-1 text-small font-medium leading-snug hover:underline">
          {task.title}
        </Link>
        {pending ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Moving" />
        ) : (
          task.targets.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="-mr-1 -mt-1 size-7"
                  aria-label={`Move “${task.title}” to…`}
                >
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Move to</DropdownMenuLabel>
                {task.targets.map((to) => (
                  <DropdownMenuItem key={to} onSelect={() => onMove(to)}>
                    {TASK_STATUS_LABELS[to]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        )}
      </div>
      {task.project && <p className="mt-1 truncate text-caption text-muted-foreground">{task.project.name}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={task.priority} />
        <SubmissionBadge status={task.submissionStatus} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-caption text-muted-foreground">
          <DeadlineLabel deadline={task.deadline} />
          {task.checklistTotal > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <CheckSquare className="size-3" aria-hidden /> {task.checklistDone}/{task.checklistTotal}
            </span>
          )}
          {task.commentCount > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <MessageSquare className="size-3" aria-hidden /> {task.commentCount}
            </span>
          )}
          {task.attachmentCount > 0 && <Paperclip className="size-3" aria-label="Has attachments" />}
        </div>
        {task.assignees.length > 0 && <AvatarGroup people={task.assignees.map((a) => a.user)} max={2} />}
      </div>
    </li>
  )
}

function ReasonDialog({
  move,
  onCancel,
  onConfirm,
}: {
  move: Move
  onCancel: () => void
  onConfirm: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const label = move.to === 'BLOCKED' ? 'What’s blocking this task?' : 'Reason'
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to {TASK_STATUS_LABELS[move.to]}</DialogTitle>
          <DialogDescription>“{move.task.title}”</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!reason.trim()) return
            setBusy(true)
            await onConfirm(reason.trim())
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="board-reason">{label}</Label>
            <Textarea
              id="board-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              required
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !reason.trim()}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              Move
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
