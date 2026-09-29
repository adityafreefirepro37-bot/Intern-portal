'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ProjectMemberRole, ProjectStatus, TaskPriority } from '@prisma/client'
import {
  ArrowDown,
  ArrowUp,
  Download,
  Eye,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  UserMinus,
} from 'lucide-react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input, inputClassName, Textarea } from '@/components/ui/input'
import { Field, FormMessage, SubmitButton } from '@/features/auth/components/form-bits'
import { useFormAction } from '@/features/interns/components/use-form-action'
import { useUnsavedChanges } from '@/features/interns/components/use-unsaved-changes'
import { cn, formatDate, fullName } from '@/lib/utils'
import {
  MEMBER_ROLE_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_TRANSITIONS,
  projectTransitionNeedsReason,
} from '@/lib/work/projects'
import type { FormState } from '@/server/actions/form-state'
import {
  createProjectAction,
  deleteProjectFileAction,
  milestoneCommandAction,
  projectStatusAction,
  removeProjectMemberAction,
  saveMilestoneAction,
  setProjectMemberAction,
  updateProjectAction,
  uploadProjectFileAction,
} from '@/server/actions/work'

type Option = { id: string; name: string }

function runForm(dispatch: (formData: FormData) => void, fields: Record<string, string>) {
  const formData = new FormData()
  for (const [key, value] of Object.entries(fields)) formData.set(key, value)
  React.startTransition(() => dispatch(formData))
}

// ── Project create / edit ──────────────────────────────────────────────────

export interface EditableProject {
  id: string
  name: string
  description: string | null
  priority: TaskPriority
  managerId: string | null
  startDate: string
  targetEndDate: string
}

function ProjectFields({
  project,
  managers,
  state,
}: {
  project?: EditableProject
  managers: Option[]
  state: FormState<unknown>
}) {
  const v = state.values
  const f = state.fields ?? {}
  return (
    <>
      <div className="sm:col-span-2">
        <Field label="Project name" htmlFor="project-name" error={f.name}>
          <Input
            id="project-name"
            name="name"
            required
            maxLength={120}
            defaultValue={v?.name ?? project?.name}
            autoFocus
          />
        </Field>
      </div>
      <Field label="Project manager" htmlFor="project-manager" error={f.managerId} hint="Defaults to you.">
        <select
          id="project-manager"
          name="managerId"
          defaultValue={v?.managerId ?? project?.managerId ?? ''}
          className={inputClassName}
        >
          <option value="">{project ? 'No manager' : 'Me'}</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Priority" htmlFor="project-priority" error={f.priority}>
        <select
          id="project-priority"
          name="priority"
          defaultValue={v?.priority ?? project?.priority ?? 'MEDIUM'}
          className={inputClassName}
        >
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </select>
      </Field>
      <Field label="Start date" htmlFor="project-start" error={f.startDate}>
        <Input id="project-start" name="startDate" type="date" defaultValue={v?.startDate ?? project?.startDate} />
      </Field>
      <Field label="Target end date" htmlFor="project-end" error={f.targetEndDate}>
        <Input
          id="project-end"
          name="targetEndDate"
          type="date"
          defaultValue={v?.targetEndDate ?? project?.targetEndDate}
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Description" htmlFor="project-description" error={f.description}>
          <Textarea
            id="project-description"
            name="description"
            rows={4}
            maxLength={5000}
            defaultValue={v?.description ?? project?.description ?? ''}
          />
        </Field>
      </div>
    </>
  )
}

export function NewProjectButton({ managers }: { managers: Option[] }) {
  const [open, setOpen] = React.useState(false)
  const [dirty, setDirty] = React.useState(false)
  const router = useRouter()
  const [state, action] = useFormAction(createProjectAction, {
    onSuccess: (result) => {
      setDirty(false)
      setOpen(false)
      if (result.data) router.push(`/projects/${result.data.id}`)
    },
  })
  useUnsavedChanges(open && dirty)
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden /> New project
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => (next || !dirty || window.confirm('Discard this project?')) && setOpen(next)}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              You’ll be the owner. It starts in Planning; add members and milestones next.
            </DialogDescription>
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
            <ProjectFields managers={managers} state={state} />
            <DialogFooter className="sm:col-span-2">
              <SubmitButton pendingLabel="Creating…">Create project</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function EditProjectForm({ project, managers }: { project: EditableProject; managers: Option[] }) {
  const [dirty, setDirty] = React.useState(false)
  const [state, action] = useFormAction(updateProjectAction, { onSuccess: () => setDirty(false) })
  useUnsavedChanges(dirty)
  return (
    <form action={action} onChange={() => setDirty(true)} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2">
        <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
      </div>
      <input type="hidden" name="projectId" value={project.id} />
      <ProjectFields project={project} managers={managers} state={state} />
      <div>
        <SubmitButton pendingLabel="Saving…" disabled={!dirty}>
          Save changes
        </SubmitButton>
      </div>
    </form>
  )
}

// ── Project status ─────────────────────────────────────────────────────────

export function ProjectStatusControl({ projectId, status }: { projectId: string; status: ProjectStatus }) {
  const [target, setTarget] = React.useState<ProjectStatus | null>(null)
  const [state, action] = useFormAction(projectStatusAction, { onSuccess: () => setTarget(null) })
  const targets = PROJECT_TRANSITIONS[status]
  if (targets.length === 0) return <p className="text-small text-muted-foreground">Archived projects are read-only.</p>
  const needsReason = target ? projectTransitionNeedsReason(status, target) : false
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {targets.map((to) => (
          <Button
            key={to}
            variant={to === 'ACTIVE' || to === 'COMPLETED' ? 'default' : 'outline'}
            onClick={() => setTarget(to)}
          >
            {status === 'COMPLETED' && to === 'ACTIVE' ? 'Reopen' : `Move to ${PROJECT_STATUS_LABELS[to]}`}
          </Button>
        ))}
      </div>
      {target && (
        <Dialog open onOpenChange={(open) => !open && setTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Move to {PROJECT_STATUS_LABELS[target]}?</DialogTitle>
              <DialogDescription>
                {target === 'COMPLETED'
                  ? 'All tasks must be completed or cancelled first. Members are notified.'
                  : target === 'ARCHIVED'
                    ? 'Archived projects are hidden from lists and become read-only.'
                    : 'Members are notified of the change.'}
              </DialogDescription>
            </DialogHeader>
            <form action={action} className="grid gap-4">
              <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="to" value={target} />
              {needsReason && (
                <Field label="Reason" htmlFor="project-status-reason" error={state.fields?.reason}>
                  <Textarea id="project-status-reason" name="reason" rows={3} maxLength={500} required />
                </Field>
              )}
              <DialogFooter>
                <SubmitButton variant={target === 'CANCELLED' ? 'destructive' : 'default'} pendingLabel="Saving…">
                  Move to {PROJECT_STATUS_LABELS[target]}
                </SubmitButton>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// ── Members ────────────────────────────────────────────────────────────────

export function AddMemberForm({
  projectId,
  candidates,
}: {
  projectId: string
  candidates: { id: string; name: string; isIntern: boolean; roles: string }[]
}) {
  const [person, setPerson] = React.useState('')
  const [state, action] = useFormAction(setProjectMemberAction, { onSuccess: () => setPerson('') })
  const isIntern = candidates.find((c) => c.id === person)?.isIntern ?? false
  const roles: ProjectMemberRole[] = isIntern
    ? ['CONTRIBUTOR', 'VIEWER']
    : ['MANAGER', 'MENTOR', 'CONTRIBUTOR', 'VIEWER']
  return (
    <form action={action} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_12rem_auto]">
      <input type="hidden" name="projectId" value={projectId} />
      <select
        name="userId"
        required
        value={person}
        onChange={(e) => setPerson(e.target.value)}
        aria-label="Person"
        className={inputClassName}
      >
        <option value="" disabled>
          Add a person…
        </option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} {c.isIntern ? '(Intern)' : c.roles && `(${c.roles})`}
          </option>
        ))}
      </select>
      <select
        name="role"
        aria-label="Project role"
        className={inputClassName}
        defaultValue="CONTRIBUTOR"
        key={isIntern ? 'intern' : 'staff'}
      >
        {roles.map((role) => (
          <option key={role} value={role}>
            {MEMBER_ROLE_LABELS[role]}
          </option>
        ))}
      </select>
      <SubmitButton pendingLabel="Adding…">Add member</SubmitButton>
      <div className="sm:col-span-3">
        <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
      </div>
    </form>
  )
}

export function MemberMenu({
  projectId,
  member,
}: {
  projectId: string
  member: { id: string; name: string; role: ProjectMemberRole; isIntern: boolean; isOwner: boolean }
}) {
  const { toast } = useToast()
  const router = useRouter()
  const [removing, setRemoving] = React.useState(false)
  const [, setRole] = useFormAction(setProjectMemberAction)
  const roles: ProjectMemberRole[] = member.isIntern
    ? ['CONTRIBUTOR', 'VIEWER']
    : ['MANAGER', 'MENTOR', 'CONTRIBUTOR', 'VIEWER']
  if (member.isOwner) return null
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${member.name}`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {roles
            .filter((role) => role !== member.role)
            .map((role) => (
              <DropdownMenuItem key={role} onSelect={() => runForm(setRole, { projectId, userId: member.id, role })}>
                Make {MEMBER_ROLE_LABELS[role].toLowerCase()}
              </DropdownMenuItem>
            ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onSelect={() => setRemoving(true)}>
            <UserMinus aria-hidden /> Remove from project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${member.name}?`}
        description="They lose access to this project, and their open task assignments here are released."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          const formData = new FormData()
          formData.set('projectId', projectId)
          formData.set('userId', member.id)
          const result = await removeProjectMemberAction({ status: 'idle' }, formData)
          toast({ title: result.message ?? 'Done', variant: result.status === 'error' ? 'error' : 'success' })
          router.refresh()
        }}
      />
    </>
  )
}

// ── Milestones ─────────────────────────────────────────────────────────────

export interface EditableMilestone {
  id: string
  name: string
  description: string | null
  startDate: string
  dueDate: string
}

export function MilestoneDialogButton({ projectId, milestone }: { projectId: string; milestone?: EditableMilestone }) {
  const [open, setOpen] = React.useState(false)
  const [state, action] = useFormAction(saveMilestoneAction, { onSuccess: () => setOpen(false) })
  const f = state.fields ?? {}
  const v = state.values
  return (
    <>
      {milestone ? (
        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${milestone.name}`} onClick={() => setOpen(true)}>
          <Pencil aria-hidden />
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus aria-hidden /> New milestone
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{milestone ? 'Edit milestone' : 'New milestone'}</DialogTitle>
            <DialogDescription>Progress is calculated from the milestone’s tasks.</DialogDescription>
          </DialogHeader>
          <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
            <div className="sm:col-span-2">
              <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
            </div>
            <input type="hidden" name="projectId" value={projectId} />
            {milestone && <input type="hidden" name="milestoneId" value={milestone.id} />}
            <div className="sm:col-span-2">
              <Field label="Name" htmlFor="milestone-name" error={f.name}>
                <Input
                  id="milestone-name"
                  name="name"
                  required
                  maxLength={120}
                  defaultValue={v?.name ?? milestone?.name}
                  autoFocus
                />
              </Field>
            </div>
            <Field label="Start date" htmlFor="milestone-start" error={f.startDate}>
              <Input
                id="milestone-start"
                name="startDate"
                type="date"
                defaultValue={v?.startDate ?? milestone?.startDate}
              />
            </Field>
            <Field label="Due date" htmlFor="milestone-due" error={f.dueDate}>
              <Input id="milestone-due" name="dueDate" type="date" defaultValue={v?.dueDate ?? milestone?.dueDate} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description" htmlFor="milestone-description" error={f.description}>
                <Textarea
                  id="milestone-description"
                  name="description"
                  rows={3}
                  maxLength={2000}
                  defaultValue={v?.description ?? milestone?.description ?? ''}
                />
              </Field>
            </div>
            <DialogFooter className="sm:col-span-2">
              <SubmitButton pendingLabel="Saving…">{milestone ? 'Save milestone' : 'Create milestone'}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function MilestoneMenu({
  milestoneId,
  name,
  status,
  first,
  last,
}: {
  milestoneId: string
  name: string
  status: string
  first: boolean
  last: boolean
}) {
  const [state, dispatch] = useFormAction(milestoneCommandAction)
  const [deleting, setDeleting] = React.useState(false)
  const command = (value: string) => runForm(dispatch, { milestoneId, command: value })
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Move ${name} up`}
        disabled={first}
        onClick={() => command('up')}
      >
        <ArrowUp aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Move ${name} down`}
        disabled={last}
        onClick={() => command('down')}
      >
        <ArrowDown aria-hidden />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${name}`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {status !== 'COMPLETED' && (
            <DropdownMenuItem onSelect={() => command('complete')}>Mark complete</DropdownMenuItem>
          )}
          {(status === 'COMPLETED' || status === 'CANCELLED') && (
            <DropdownMenuItem onSelect={() => command('reopen')}>Reopen</DropdownMenuItem>
          )}
          {status !== 'CANCELLED' && status !== 'COMPLETED' && (
            <DropdownMenuItem onSelect={() => command('cancel')}>Cancel milestone</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onSelect={() => setDeleting(true)}>
            <Trash2 aria-hidden /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {state.status === 'error' && (
        <p role="alert" className="basis-full text-caption text-destructive">
          {state.message}
        </p>
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete “${name}”?`}
        description="Its tasks are kept; they just no longer belong to a milestone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => command('delete')}
      />
    </>
  )
}

// ── Files ──────────────────────────────────────────────────────────────────

const PREVIEWABLE = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function ProjectFiles({
  projectId,
  files,
  canUpload,
  timeZone,
}: {
  projectId: string
  files: {
    id: string
    file_name: string
    mime_type: string
    file_size: number
    description: string | null
    created_at: Date
    uploader: { first_name: string; last_name: string; display_name: string | null } | null
    canDelete: boolean
  }[]
  canUpload: boolean
  timeZone: string
}) {
  const [state, upload] = useFormAction(uploadProjectFileAction)
  const [, remove] = useFormAction(deleteProjectFileAction)
  const [deleting, setDeleting] = React.useState<{ id: string; name: string } | null>(null)
  const formRef = React.useRef<HTMLFormElement>(null)
  return (
    <div className="space-y-4">
      {canUpload && (
        <form
          ref={formRef}
          action={async (formData) => {
            upload(formData)
            formRef.current?.reset()
          }}
          className="grid grid-cols-1 gap-2 rounded-xl border bg-card p-4 sm:grid-cols-[1fr_1fr_auto]"
        >
          <input type="hidden" name="projectId" value={projectId} />
          <Input name="file" type="file" required aria-label="File" />
          <Input
            name="description"
            placeholder="What is it? (brief, brand assets, deliverable…)"
            maxLength={300}
            aria-label="Description"
          />
          <SubmitButton pendingLabel="Uploading…">Upload</SubmitButton>
          <div className="sm:col-span-3">
            <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
          </div>
        </form>
      )}
      {files.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-small text-muted-foreground">
          No files yet. Share briefs, brand assets, requirements and deliverables here.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-3 px-4 py-3">
              <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{file.file_name}</p>
                <p className={cn('truncate text-caption text-muted-foreground')}>
                  {file.description && `${file.description} · `}
                  {size(file.file_size)} · {file.uploader ? fullName(file.uploader) : 'Unknown'} ·{' '}
                  {formatDate(file.created_at, timeZone)}
                </p>
              </div>
              {PREVIEWABLE.has(file.mime_type) && (
                <a
                  href={`/api/projects/files/${file.id}?inline=1`}
                  target="_blank"
                  rel="noopener"
                  aria-label={`View ${file.file_name}`}
                  className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Eye className="size-4" aria-hidden />
                </a>
              )}
              <a
                href={`/api/projects/files/${file.id}`}
                aria-label={`Download ${file.file_name}`}
                className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Download className="size-4" aria-hidden />
              </a>
              {file.canDelete && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${file.file_name}`}
                  onClick={() => setDeleting({ id: file.id, name: file.file_name })}
                >
                  <Trash2 aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title={`Delete ${deleting.name}?`}
          description="It disappears for everyone on the project."
          confirmLabel="Delete"
          destructive
          onConfirm={() => runForm(remove, { fileId: deleting.id })}
        />
      )}
    </div>
  )
}
