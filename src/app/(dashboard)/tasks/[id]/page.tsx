import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { GitBranch, OctagonAlert } from 'lucide-react'
import { PriorityBadge, StatusBadge } from '@/components/common/badges'
import { AccessDenied } from '@/components/common/states'
import { AvatarGroup, UserAvatar } from '@/components/common/user-avatar'
import { Breadcrumbs } from '@/components/navigation/breadcrumbs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/misc'
import {
  AssigneesButton,
  DeleteTaskButton,
  EditTaskButton,
  TaskStatusControl,
} from '@/features/work/components/task-actions'
import { TaskComments } from '@/features/work/components/task-comments'
import { NewTaskButton } from '@/features/work/components/task-form'
import { AttachmentsPanel, ChecklistPanel, DependenciesPanel, TimePanel } from '@/features/work/components/task-panels'
import { SubmissionPanel } from '@/features/work/components/task-submission-panel'
import { ActivityList } from '@/features/work/components/activity-list'
import { DeadlineLabel } from '@/features/work/components/work-badges'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { formatDateOnly } from '@/lib/interns/dates'
import { formatDate, formatDay, fullName } from '@/lib/utils'
import { idSchema } from '@/lib/validation'
import { minutesToHours } from '@/lib/work/workload'
import { requirePageContext } from '@/server/context'
import { taskService } from '@/server/services/task.service'

export const metadata: Metadata = { title: 'Task' }

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-baseline gap-2 py-1.5 text-small">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  )
}

/**
 * Task detail. Access comes from resolveTaskAccess (404 when out of scope);
 * every action shown is one the viewer may take — the server re-checks it.
 */
export default async function TaskPage({ params }: PageProps<'/tasks/[id]'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  if (!idSchema.safeParse(id).success) notFound()

  let detail: Awaited<ReturnType<typeof taskService.getDetail>>
  try {
    detail = await taskService.getDetail(ctx, id)
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    if (error instanceof ForbiddenError) return <AccessDenied what="tasks" />
    throw error
  }
  const { task, can, deadline, progress, submissions, comments, options, participants, targets, activity } = detail
  const tz = ctx.organization.timezone
  const closed = task.status === 'COMPLETED' || task.status === 'CANCELLED'
  const projectMembers = options.assignees
  const subtaskProjects = task.project
    ? [{ id: task.project.id, name: task.project.name, members: projectMembers, milestones: options.milestones }]
    : []

  return (
    <>
      <Breadcrumbs
        items={[
          ...(task.project
            ? [
                { label: 'Projects', href: '/projects' },
                { label: task.project.name, href: `/projects/${task.project.id}/tasks` },
              ]
            : [{ label: 'Tasks', href: '/tasks' }]),
          ...(task.parent_task ? [{ label: task.parent_task.title, href: `/tasks/${task.parent_task.id}` }] : []),
          { label: task.title },
        ]}
      />
      <header className="mb-6 mt-2 space-y-3">
        <h1 className="text-h1 text-balance">{task.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
          {task.due_date && <span className="text-small text-muted-foreground">Due {formatDay(task.due_date)}</span>}
          <DeadlineLabel deadline={deadline} />
          {task.assignees.length > 0 ? (
            <AvatarGroup people={task.assignees.map((a) => a.user)} max={4} />
          ) : (
            <span className="text-small text-muted-foreground">Unassigned</span>
          )}
        </div>
        {task.status === 'BLOCKED' && task.blocked_reason && (
          <p
            role="status"
            className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-small text-destructive"
          >
            <OctagonAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <span className="font-medium">Blocked:</span> {task.blocked_reason}
            </span>
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <TaskStatusControl taskId={task.id} status={task.status} targets={targets} />
          {can.assign && (
            <AssigneesButton taskId={task.id} current={task.assignees.map((a) => a.user.id)} options={projectMembers} />
          )}
          {can.edit && (
            <EditTaskButton
              task={{
                id: task.id,
                title: task.title,
                description: task.description,
                priority: task.priority,
                startDate: task.start_date ? formatDateOnly(task.start_date) : '',
                dueDate: task.due_date ? formatDateOnly(task.due_date) : '',
                estimatedHours: task.estimated_minutes ? String(minutesToHours(task.estimated_minutes)) : '',
                milestoneId: task.milestone?.id ?? null,
              }}
              milestones={options.milestones}
            />
          )}
          {can.delete && (
            <DeleteTaskButton
              taskId={task.id}
              title={task.title}
              redirectTo={task.project ? `/projects/${task.project.id}/tasks` : '/tasks'}
            />
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <Section title="Description">
            {task.description ? (
              <p className="whitespace-pre-line break-words text-small">{task.description}</p>
            ) : (
              <p className="text-small text-muted-foreground">No description.</p>
            )}
          </Section>

          <Section title="Checklist">
            <ChecklistPanel taskId={task.id} items={task.checklist} canEdit={can.work && !closed} />
          </Section>

          {!task.parent_task_id && (
            <Section
              title="Subtasks"
              action={
                can.createSubtasks && (
                  <NewTaskButton
                    projects={subtaskProjects}
                    canAssign={can.assign}
                    projectId={task.project?.id}
                    parentTaskId={task.id}
                    label="Add subtask"
                    variant="outline"
                    openAfterCreate={false}
                  />
                )
              }
            >
              {task.subtasks.length === 0 ? (
                <p className="text-small text-muted-foreground">No subtasks. Break larger work into smaller steps.</p>
              ) : (
                <ul className="divide-y">
                  {task.subtasks.map((subtask) => (
                    <li key={subtask.id} className="flex items-center gap-3 py-2">
                      <GitBranch className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <Link
                        href={`/tasks/${subtask.id}`}
                        className="min-w-0 flex-1 truncate text-small hover:underline"
                      >
                        {subtask.title}
                      </Link>
                      {subtask.assignees.length > 0 && (
                        <AvatarGroup people={subtask.assignees.map((a) => a.user)} max={2} />
                      )}
                      <StatusBadge status={subtask.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {task.project && (
            <Section title="Dependencies">
              <DependenciesPanel
                taskId={task.id}
                dependencies={task.dependencies}
                dependents={task.dependents}
                candidates={options.dependencyCandidates}
                canEdit={can.manageDependencies}
              />
            </Section>
          )}

          <Section title="Submission & review">
            <SubmissionPanel
              taskId={task.id}
              taskStatus={task.status}
              submissions={submissions}
              canSubmit={can.submit}
              canReview={can.review}
              timeZone={tz}
            />
          </Section>

          <Section title="Attachments">
            <AttachmentsPanel
              taskId={task.id}
              attachments={task.attachments}
              canUpload={can.work && !closed}
              canRemove={can.edit}
              viewerId={ctx.actor.userId}
            />
          </Section>

          <Section title="Comments">
            <TaskComments
              taskId={task.id}
              comments={comments}
              participants={participants}
              viewerId={ctx.actor.userId}
              canComment={can.comment}
              canModerate={ctx.actor.permissions.get('task.update') === 'ORGANIZATION'}
            />
          </Section>

          <Section title="Activity">
            <ActivityList entries={activity} />
          </Section>
        </div>

        <aside className="space-y-6" aria-label="Task details">
          <Card>
            <CardContent className="pt-5">
              <dl>
                <Info label="Project">
                  {task.project && (
                    <Link href={`/projects/${task.project.id}`} className="hover:underline">
                      {task.project.name}
                    </Link>
                  )}
                </Info>
                <Info label="Milestone">{task.milestone?.name}</Info>
                {task.parent_task && (
                  <Info label="Parent task">
                    <Link href={`/tasks/${task.parent_task.id}`} className="hover:underline">
                      {task.parent_task.title}
                    </Link>
                  </Info>
                )}
                <Info label="Assignees">
                  {task.assignees.length > 0 && (
                    <ul className="space-y-1">
                      {task.assignees.map((a) => (
                        <li key={a.user.id} className="flex items-center gap-2">
                          <UserAvatar person={a.user} className="size-5" /> {fullName(a.user)}
                        </li>
                      ))}
                    </ul>
                  )}
                </Info>
                <Info label="Created by">{fullName(task.creator)}</Info>
                <Info label="Start date">{task.start_date && formatDay(task.start_date)}</Info>
                <Info label="Due date">{task.due_date && formatDay(task.due_date)}</Info>
                <Info label="Estimate">
                  {task.estimated_minutes ? `${minutesToHours(task.estimated_minutes)}h` : null}
                </Info>
                <Info label="Actual">{task.actual_minutes ? `${minutesToHours(task.actual_minutes)}h` : null}</Info>
                <Info label="Started">{task.started_at && formatDate(task.started_at, tz)}</Info>
                <Info label="Completed">{task.completed_at && formatDate(task.completed_at, tz)}</Info>
                <Info label="Updated">
                  {formatDate(task.updated_at, tz)}
                  {task.updater && ` by ${fullName(task.updater)}`}
                </Info>
              </dl>
              <div className="mt-3 space-y-1.5">
                <p className="flex justify-between text-caption text-muted-foreground">
                  Progress <span className="tabular">{progress}%</span>
                </p>
                <Progress value={progress} label={`Task progress ${progress}%`} />
              </div>
            </CardContent>
          </Card>
          <Section title="Time">
            <TimePanel
              taskId={task.id}
              entries={task.time_entries}
              canLog={can.logTime}
              viewerId={ctx.actor.userId}
              estimatedHours={minutesToHours(task.estimated_minutes)}
              actualHours={minutesToHours(task.actual_minutes)}
            />
          </Section>
        </aside>
      </div>
    </>
  )
}
