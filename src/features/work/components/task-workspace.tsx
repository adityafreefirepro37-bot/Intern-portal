import { Pagination } from '@/components/tables/pagination'
import { TASK_PRIORITIES, TASK_STATUS_LABELS, TASK_STATUSES } from '@/lib/work/tasks'
import type { RequestContext } from '@/server/context'
import { taskService } from '@/server/services/task.service'
import { PageSizeSelect, TaskFilters } from './task-filters'
import { TaskBoard } from './task-board'
import { TaskList } from './task-list'

const SORTS = [
  { value: 'due', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'updated', label: 'Last updated' },
  { value: 'created', label: 'Created' },
  { value: 'title', label: 'Title' },
  { value: 'status', label: 'Status' },
]

/**
 * List/board workspace shared by /tasks and project task tabs. Filtering,
 * sorting and pagination are server-side; the board shows up to 50 cards per
 * column with true column counts.
 */
export async function TaskWorkspace({
  ctx,
  searchParams,
  pathname,
  projectId,
  milestones,
}: {
  ctx: RequestContext
  searchParams: Record<string, string | string[] | undefined>
  pathname: string
  projectId?: string
  milestones?: { value: string; label: string }[]
}) {
  const raw = Object.fromEntries(
    Object.entries(searchParams).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])),
  )
  const view = raw.view === 'board' ? 'board' : 'list'
  const fixed = projectId ? { projectId } : {}
  const options = await taskService.filterOptions(ctx)
  const canBulk = ctx.actor.permissions.has('task.update') || ctx.actor.permissions.has('task.assign')

  const filters = (
    <TaskFilters
      statuses={TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] }))}
      priorities={TASK_PRIORITIES.map((p) => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase() }))}
      people={options.people}
      projects={projectId ? undefined : options.projects}
      milestones={milestones}
      sorts={SORTS}
      view={view}
    />
  )

  if (view === 'board') {
    const board = await taskService.board(ctx, raw, fixed)
    return (
      <>
        {filters}
        <TaskBoard columns={board.columns} />
      </>
    )
  }

  const { page } = await taskService.directory(ctx, raw, fixed)
  const filtered = Object.keys(raw).some((key) => !['page', 'pageSize', 'sort', 'dir', 'view'].includes(key))
  const params = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'page'))
  return (
    <>
      {filters}
      <TaskList
        tasks={page.items}
        bulk={
          canBulk
            ? {
                people: options.people,
                projects: options.projects,
                canAssign: ctx.actor.permissions.has('task.assign'),
              }
            : undefined
        }
        empty={
          filtered
            ? { title: 'No tasks match', description: 'Try a different search or clear the filters.' }
            : {
                title: 'No tasks yet',
                description: projectId
                  ? 'Create the first task to start tracking work on this project.'
                  : 'Your assigned work will appear here once a manager or mentor assigns it.',
              }
        }
      />
      <div className="mt-2 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PageSizeSelect value={page.pageSize} />
        <div className="flex-1">
          <Pagination
            pathname={pathname}
            params={params}
            page={page.page}
            totalPages={page.totalPages}
            total={page.total}
            pageSize={page.pageSize}
          />
        </div>
      </div>
    </>
  )
}
