'use client'

import { RelativeTime } from '@/components/common/relative-time'
import * as React from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, Download, Eye, Link2, Paperclip, Trash2, X } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { Button } from '@/components/ui/button'
import { Input, inputClassName } from '@/components/ui/input'
import { Progress } from '@/components/ui/misc'
import { FormMessage, SubmitButton } from '@/features/auth/components/form-bits'
import { useFormAction } from '@/features/interns/components/use-form-action'
import { cn, fullName } from '@/lib/utils'
import type { FormState } from '@/server/actions/form-state'
import {
  addChecklistItemAction,
  addDependencyAction,
  logTimeAction,
  removeDependencyAction,
  removeTaskAttachmentAction,
  removeTimeEntryAction,
  updateChecklistItemAction,
  uploadTaskAttachmentAction,
} from '@/server/actions/work'

type Person = {
  id: string
  first_name: string
  last_name: string
  display_name: string | null
  avatar_url: string | null
}

/** Runs a small action with FormData built from an object (for icon buttons and checkboxes). */
function useQuickAction(action: (previous: FormState, formData: FormData) => Promise<FormState>) {
  const [state, dispatch, pending] = useFormAction(action, { toast: false })
  const run = (fields: Record<string, string>) => {
    const formData = new FormData()
    for (const [key, value] of Object.entries(fields)) formData.set(key, value)
    React.startTransition(() => dispatch(formData))
  }
  return { state, run, pending }
}

// ── Checklist ───────────────────────────────────────────────────────────────

export function ChecklistPanel({
  taskId,
  items,
  canEdit,
}: {
  taskId: string
  items: { id: string; title: string; is_completed: boolean; completer: Person | null; completed_at: Date | null }[]
  canEdit: boolean
}) {
  const [addState, add] = useFormAction(addChecklistItemAction, { toast: false })
  const update = useQuickAction(updateChecklistItemAction)
  const [editing, setEditing] = React.useState<string | null>(null)
  const done = items.filter((i) => i.is_completed).length
  const formRef = React.useRef<HTMLFormElement>(null)

  return (
    <div className="space-y-3">
      {items.length > 0 && (
        <div className="flex items-center gap-3">
          <Progress
            value={items.length ? (done / items.length) * 100 : 0}
            label={`${done} of ${items.length} checklist items done`}
          />
          <span className="tabular shrink-0 text-caption text-muted-foreground">
            {done}/{items.length}
          </span>
        </div>
      )}
      {items.length === 0 && !canEdit && <p className="text-small text-muted-foreground">No checklist items.</p>}
      <ul className="space-y-1">
        {items.map((item, index) => (
          <li key={item.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50">
            <input
              type="checkbox"
              checked={item.is_completed}
              disabled={!canEdit || update.pending}
              onChange={(event) => update.run({ itemId: item.id, completed: String(event.target.checked) })}
              aria-label={`${item.title}${item.is_completed ? ' (done)' : ''}`}
              className="size-4 shrink-0 accent-primary"
            />
            {editing === item.id ? (
              <form
                className="flex flex-1 gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  const title = new FormData(event.currentTarget).get('title')
                  if (typeof title === 'string' && title.trim()) update.run({ itemId: item.id, title })
                  setEditing(null)
                }}
              >
                <Input
                  name="title"
                  defaultValue={item.title}
                  maxLength={200}
                  autoFocus
                  aria-label="Item title"
                  className="h-8"
                />
                <Button type="submit" size="sm">
                  Save
                </Button>
              </form>
            ) : (
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => setEditing(item.id)}
                className={cn(
                  'flex-1 text-left text-small disabled:cursor-default',
                  item.is_completed && 'text-muted-foreground line-through',
                )}
                title={item.completer && item.completed_at ? `Done by ${fullName(item.completer)}` : undefined}
              >
                {item.title}
              </button>
            )}
            {canEdit && editing !== item.id && (
              <span className="flex opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7"
                  aria-label={`Move ${item.title} up`}
                  disabled={index === 0}
                  onClick={() => update.run({ itemId: item.id, move: 'up' })}
                >
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7"
                  aria-label={`Move ${item.title} down`}
                  disabled={index === items.length - 1}
                  onClick={() => update.run({ itemId: item.id, move: 'down' })}
                >
                  <ArrowDown aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7"
                  aria-label={`Delete ${item.title}`}
                  onClick={() => update.run({ itemId: item.id, remove: 'true' })}
                >
                  <X aria-hidden />
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          ref={formRef}
          action={async (formData) => {
            add(formData)
            formRef.current?.reset()
          }}
          className="flex gap-2"
        >
          <input type="hidden" name="taskId" value={taskId} />
          <Input
            name="title"
            placeholder="Add a checklist item"
            maxLength={200}
            required
            aria-label="New checklist item"
          />
          <SubmitButton variant="outline" pendingLabel="Adding…">
            Add
          </SubmitButton>
        </form>
      )}
      <FormMessage status={addState.status === 'error' ? 'error' : 'idle'} message={addState.message} />
      <FormMessage status={update.state.status === 'error' ? 'error' : 'idle'} message={update.state.message} />
    </div>
  )
}

// ── Dependencies ───────────────────────────────────────────────────────────

export function DependenciesPanel({
  taskId,
  dependencies,
  dependents,
  candidates,
  canEdit,
}: {
  taskId: string
  dependencies: { id: string; depends_on: { id: string; title: string; status: string; deleted_at: Date | null } }[]
  dependents: { id: string; task: { id: string; title: string; status: string; deleted_at: Date | null } }[]
  candidates: { id: string; title: string }[]
  canEdit: boolean
}) {
  const [addState, add] = useFormAction(addDependencyAction, { toast: false })
  const remove = useQuickAction(removeDependencyAction)
  const live = dependencies.filter((d) => !d.depends_on.deleted_at)
  const blocking = dependents.filter((d) => !d.task.deleted_at)
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-caption font-medium text-muted-foreground">Waiting on</h3>
        {live.length === 0 ? (
          <p className="text-small text-muted-foreground">Nothing — this task can start any time.</p>
        ) : (
          <ul className="space-y-1.5">
            {live.map((dep) => (
              <li key={dep.id} className="flex items-center gap-2 text-small">
                <Link2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <Link href={`/tasks/${dep.depends_on.id}`} className="min-w-0 flex-1 truncate hover:underline">
                  {dep.depends_on.title}
                </Link>
                <StatusBadge status={dep.depends_on.status} />
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-7"
                    aria-label={`Remove dependency on ${dep.depends_on.title}`}
                    onClick={() => remove.run({ dependencyId: dep.id })}
                  >
                    <X aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {blocking.length > 0 && (
        <div>
          <h3 className="mb-2 text-caption font-medium text-muted-foreground">Blocks</h3>
          <ul className="space-y-1.5">
            {blocking.map((dep) => (
              <li key={dep.id} className="flex items-center gap-2 text-small">
                <Link href={`/tasks/${dep.task.id}`} className="min-w-0 flex-1 truncate hover:underline">
                  {dep.task.title}
                </Link>
                <StatusBadge status={dep.task.status} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {canEdit && candidates.length > 0 && (
        <form action={add} className="flex flex-col gap-2 sm:flex-row">
          <input type="hidden" name="taskId" value={taskId} />
          <select
            name="dependsOnTaskId"
            required
            aria-label="Task this one waits on"
            className={inputClassName}
            defaultValue=""
          >
            <option value="" disabled>
              Add a task this one waits on…
            </option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <SubmitButton variant="outline" pendingLabel="Adding…">
            Add
          </SubmitButton>
        </form>
      )}
      <FormMessage status={addState.status === 'error' ? 'error' : 'idle'} message={addState.message} />
      <FormMessage status={remove.state.status === 'error' ? 'error' : 'idle'} message={remove.state.message} />
    </div>
  )
}

// ── Attachments ────────────────────────────────────────────────────────────

const PREVIEWABLE = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function AttachmentsPanel({
  taskId,
  attachments,
  canUpload,
  canRemove,
  viewerId,
}: {
  taskId: string
  attachments: {
    id: string
    file_name: string
    mime_type: string
    file_size: number
    created_at: Date
    submission_version_id: string | null
    uploader: Person | null
  }[]
  canUpload: boolean
  canRemove: boolean
  viewerId: string
}) {
  const [state, upload] = useFormAction(uploadTaskAttachmentAction)
  const remove = useQuickAction(removeTaskAttachmentAction)
  const formRef = React.useRef<HTMLFormElement>(null)
  const files = attachments.filter((a) => !a.submission_version_id)
  return (
    <div className="space-y-3">
      {files.length === 0 ? (
        <p className="text-small text-muted-foreground">
          No files attached. Files submitted for review are listed with each submission.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-2 px-3 py-2">
              <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-small">{file.file_name}</p>
                <p className="text-caption text-muted-foreground">
                  {size(file.file_size)} · {file.uploader ? fullName(file.uploader) : 'Unknown'} ·{' '}
                  <RelativeTime date={file.created_at} />
                </p>
              </div>
              {PREVIEWABLE.has(file.mime_type) && (
                <a
                  href={`/api/tasks/attachments/${file.id}?inline=1`}
                  target="_blank"
                  rel="noopener"
                  aria-label={`View ${file.file_name}`}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Eye className="size-4" aria-hidden />
                </a>
              )}
              <a
                href={`/api/tasks/attachments/${file.id}`}
                aria-label={`Download ${file.file_name}`}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Download className="size-4" aria-hidden />
              </a>
              {(canRemove || file.uploader?.id === viewerId) && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7"
                  aria-label={`Remove ${file.file_name}`}
                  onClick={() => remove.run({ attachmentId: file.id })}
                >
                  <Trash2 aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <form
          ref={formRef}
          action={async (formData) => {
            upload(formData)
            formRef.current?.reset()
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <input type="hidden" name="taskId" value={taskId} />
          <Input name="file" type="file" required aria-label="File to attach" />
          <SubmitButton variant="outline" pendingLabel="Uploading…">
            Attach
          </SubmitButton>
        </form>
      )}
      <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
      <FormMessage status={remove.state.status === 'error' ? 'error' : 'idle'} message={remove.state.message} />
    </div>
  )
}

// ── Time log ───────────────────────────────────────────────────────────────

export function TimePanel({
  taskId,
  entries,
  canLog,
  viewerId,
  estimatedHours,
  actualHours,
}: {
  taskId: string
  entries: { id: string; duration_minutes: number; description: string | null; created_at: Date; user: Person }[]
  canLog: boolean
  viewerId: string
  estimatedHours: number | null
  actualHours: number | null
}) {
  const [state, log] = useFormAction(logTimeAction)
  const remove = useQuickAction(removeTimeEntryAction)
  return (
    <div className="space-y-3">
      <p className="text-small">
        <span className="font-medium">{actualHours ?? 0}h</span> logged
        {estimatedHours !== null && <span className="text-muted-foreground"> of {estimatedHours}h estimated</span>}
      </p>
      {entries.length > 0 && (
        <ul className="space-y-1.5 text-small">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2">
              <span className="tabular w-14 shrink-0 font-medium">
                {Math.floor(entry.duration_minutes / 60)}h {entry.duration_minutes % 60}m
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {fullName(entry.user)} · <RelativeTime date={entry.created_at} />
                {entry.description && ` — ${entry.description}`}
              </span>
              {entry.user.id === viewerId && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-7"
                  aria-label="Remove time entry"
                  onClick={() => remove.run({ entryId: entry.id })}
                >
                  <X aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canLog && (
        <form action={log} className="grid grid-cols-2 gap-2">
          <input type="hidden" name="taskId" value={taskId} />
          <Input name="hours" type="number" min={0} max={24} placeholder="h" aria-label="Hours" />
          <Input name="minutes" type="number" min={0} max={59} placeholder="min" aria-label="Minutes" />
          <Input
            name="description"
            placeholder="What did you work on? (optional)"
            maxLength={500}
            aria-label="Description"
            className="col-span-2"
          />
          <SubmitButton variant="outline" pendingLabel="Logging…" className="col-span-2">
            Log time
          </SubmitButton>
        </form>
      )}
      <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
    </div>
  )
}
