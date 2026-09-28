import type { Metadata } from 'next'
import { ClipboardList, Plus } from 'lucide-react'
import { PhaseBadge, PriorityBadge, StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { AvatarGroup } from '@/components/common/user-avatar'
import { DataTable } from '@/components/tables/data-table'
import { FilterBar } from '@/components/tables/filter-bar'
import { Pagination } from '@/components/tables/pagination'
import { Button } from '@/components/ui/button'
import { cn, describeDue, formatDate, humanizeEnum } from '@/lib/utils'
import { readListParams } from '@/lib/validation/list-params'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { taskService, type TaskListItem } from '@/server/services/task.service'

export const metadata: Metadata = { title: 'Tasks' }

const STATUSES = [
  'BACKLOG',
  'ASSIGNED',
  'IN_PROGRESS',
  'BLOCKED',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'COMPLETED',
  'CANCELLED',
] as const

export default async function TasksPage({ searchParams }: PageProps<'/tasks'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'task.read')) return <AccessDenied what="tasks" />

  const { pagination, status, highlight, raw } = readListParams(await searchParams, { statuses: STATUSES })
  const page = await taskService.list(ctx, pagination, { status })
  const now = new Date()

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Everything in flight across projects. Creating, assigning and reviewing tasks arrives in Phase 04."
        actions={
          authorizationService.can(ctx, 'task.create') && (
            <Button disabled aria-describedby="new-task-phase">
              <Plus aria-hidden /> New task
              <PhaseBadge phase="04" className="border-primary-foreground/40 text-primary-foreground" />
              <span id="new-task-phase" className="sr-only">
                Available in Phase 04
              </span>
            </Button>
          )
        }
      />

      <FilterBar
        label="Filter tasks by status"
        param="status"
        pathname="/tasks"
        params={raw}
        options={STATUSES.map((value) => ({ value, label: humanizeEnum(value) }))}
      />

      <DataTable<TaskListItem>
        caption="Tasks"
        rows={page.items}
        getRowId={(task) => task.id}
        highlightId={highlight}
        empty={
          <EmptyState
            icon={ClipboardList}
            title={status ? `No ${humanizeEnum(status).toLowerCase()} tasks` : 'No tasks yet'}
            description="Tasks appear here once they’re created in a project."
          />
        }
        columns={[
          {
            key: 'title',
            header: 'Task',
            cell: (task) => (
              <div className="min-w-48">
                <p className="font-medium">{task.title}</p>
                {task.project && <p className="text-caption text-muted-foreground">{task.project.name}</p>}
              </div>
            ),
          },
          { key: 'status', header: 'Status', cell: (task) => <StatusBadge status={task.status} /> },
          {
            key: 'priority',
            header: 'Priority',
            hideBelow: 'sm',
            cell: (task) => <PriorityBadge priority={task.priority} />,
          },
          {
            key: 'due',
            header: 'Due',
            hideBelow: 'md',
            cell: (task) => {
              if (!task.due_date) return <span className="text-muted-foreground">—</span>
              const due = describeDue(task.due_date, now)
              const open = task.status !== 'COMPLETED' && task.status !== 'CANCELLED'
              return (
                <div className="whitespace-nowrap">
                  <p>{formatDate(task.due_date, ctx.organization.timezone)}</p>
                  {open && (
                    <p
                      className={cn(
                        'text-caption',
                        due.tone === 'overdue' ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {due.label}
                    </p>
                  )}
                </div>
              )
            },
          },
          {
            key: 'assignees',
            header: 'Assignees',
            hideBelow: 'lg',
            cell: (task) => <AvatarGroup people={task.assignees.map((assignee) => assignee.user)} max={3} />,
          },
        ]}
      />

      <Pagination
        pathname="/tasks"
        params={raw}
        page={page.page}
        totalPages={page.totalPages}
        total={page.total}
        pageSize={page.pageSize}
      />
    </>
  )
}
