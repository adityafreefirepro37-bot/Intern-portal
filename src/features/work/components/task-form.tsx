'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
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
import { createTaskAction } from '@/server/actions/work'

type Person = { id: string; first_name: string; last_name: string; display_name: string | null }

export interface TaskFormProject {
  id: string
  name: string
  members: Person[]
  milestones: { id: string; name: string }[]
}

/**
 * New task / new subtask. Assignee choices are the selected project's
 * members; the server re-validates membership, scope and permissions.
 */
export function NewTaskButton({
  projects,
  canAssign,
  projectId,
  parentTaskId,
  label = 'New task',
  variant,
  openAfterCreate = true,
}: {
  projects: TaskFormProject[]
  canAssign: boolean
  projectId?: string
  parentTaskId?: string
  label?: string
  variant?: ButtonProps['variant']
  openAfterCreate?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus aria-hidden /> {label}
      </Button>
      {open && (
        <TaskDialog
          projects={projects}
          canAssign={canAssign}
          projectId={projectId}
          parentTaskId={parentTaskId}
          openAfterCreate={openAfterCreate}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function TaskDialog({
  projects,
  canAssign,
  projectId,
  parentTaskId,
  openAfterCreate,
  onClose,
}: {
  projects: TaskFormProject[]
  canAssign: boolean
  projectId?: string
  parentTaskId?: string
  openAfterCreate: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [dirty, setDirty] = React.useState(false)
  const [selectedProject, setSelectedProject] = React.useState(projectId ?? '')
  const [state, action] = useFormAction(createTaskAction, {
    onSuccess: (result) => {
      setDirty(false)
      // Navigate while this component (which owns the action) is still mounted;
      // the navigation itself closes the dialog. Unmounting first drops the push.
      if (openAfterCreate && result.data) router.push(`/tasks/${result.data.id}`)
      else onClose()
    },
  })
  useUnsavedChanges(dirty)
  const project = projects.find((p) => p.id === selectedProject)
  const v = state.values
  const f = state.fields ?? {}

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && (!dirty || window.confirm('Discard this task?'))) onClose()
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{parentTaskId ? 'New subtask' : 'New task'}</DialogTitle>
          <DialogDescription>
            {canAssign
              ? 'Tasks with assignees start as Assigned; others go to the backlog.'
              : 'The task starts in the backlog.'}
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
          {parentTaskId && <input type="hidden" name="parentTaskId" value={parentTaskId} />}
          <div className="sm:col-span-2">
            <Field label="Title" htmlFor="task-title" error={f.title}>
              <Input id="task-title" name="title" required maxLength={200} defaultValue={v?.title} autoFocus />
            </Field>
          </div>
          {!parentTaskId && (
            <Field label="Project" htmlFor="task-project" error={f.projectId}>
              <select
                id="task-project"
                name="projectId"
                value={selectedProject}
                onChange={(event) => setSelectedProject(event.target.value)}
                disabled={Boolean(projectId)}
                className={inputClassName}
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {projectId && <input type="hidden" name="projectId" value={projectId} />}
            </Field>
          )}
          {!parentTaskId && project && project.milestones.length > 0 && (
            <Field label="Milestone" htmlFor="task-milestone" error={f.milestoneId}>
              <select
                id="task-milestone"
                name="milestoneId"
                defaultValue={v?.milestoneId ?? ''}
                className={inputClassName}
              >
                <option value="">None</option>
                {project.milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Priority" htmlFor="task-priority" error={f.priority}>
            <select
              id="task-priority"
              name="priority"
              defaultValue={v?.priority ?? 'MEDIUM'}
              className={inputClassName}
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </Field>
          <Field label="Estimate (hours)" htmlFor="task-estimate" error={f.estimatedHours}>
            <Input
              id="task-estimate"
              name="estimatedHours"
              type="number"
              min={0}
              max={1000}
              step={0.5}
              defaultValue={v?.estimatedHours}
            />
          </Field>
          <Field label="Start date" htmlFor="task-start" error={f.startDate}>
            <Input id="task-start" name="startDate" type="date" defaultValue={v?.startDate} />
          </Field>
          <Field label="Due date" htmlFor="task-due" error={f.dueDate}>
            <Input id="task-due" name="dueDate" type="date" defaultValue={v?.dueDate} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description" htmlFor="task-description" error={f.description}>
              <Textarea
                id="task-description"
                name="description"
                rows={4}
                maxLength={10_000}
                defaultValue={v?.description}
              />
            </Field>
          </div>
          {canAssign && (project || parentTaskId) && (
            <fieldset className="grid gap-2 sm:col-span-2">
              <legend className="mb-1 text-label">Assignees</legend>
              {f.assigneeIds && (
                <p role="alert" className="text-caption font-medium text-destructive">
                  {f.assigneeIds}
                </p>
              )}
              {(project?.members ?? []).length === 0 ? (
                <p className="text-small text-muted-foreground">Add people to the project to assign them.</p>
              ) : (
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {project!.members.map((person) => (
                    <label key={person.id} className="flex items-center gap-2 text-small">
                      <input type="checkbox" name="assigneeIds" value={person.id} className="size-4 accent-primary" />
                      {fullName(person)}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          )}
          <DialogFooter className="sm:col-span-2">
            <SubmitButton pendingLabel="Creating…">{parentTaskId ? 'Add subtask' : 'Create task'}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
