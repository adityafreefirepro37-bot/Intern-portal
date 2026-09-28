import Link from 'next/link'
import { CalendarClock } from 'lucide-react'
import { PriorityBadge } from '@/components/common/badges'
import { EmptyState } from '@/components/common/states'
import { AvatarGroup } from '@/components/common/user-avatar'
import { cn, describeDue } from '@/lib/utils'
import type { DashboardOverview } from '@/server/services/dashboard.service'

type Task = NonNullable<DashboardOverview['upcomingTasks']>[number]

const toneClass = { overdue: 'text-destructive', soon: 'text-warning', later: 'text-muted-foreground' } as const

export function UpcomingTasks({ tasks, now }: { tasks: Task[]; now: Date }) {
  if (tasks.length === 0) {
    return (
      <EmptyState
        compact
        icon={CalendarClock}
        title="No deadlines this week"
        description="Open tasks due in the next 7 days will appear here."
      />
    )
  }
  return (
    <ul className="-mx-2 divide-y">
      {tasks.map((task) => {
        const due = task.due_date ? describeDue(task.due_date, now) : null
        return (
          <li key={task.id} className="flex items-center gap-3 px-2 py-3">
            <div className="min-w-0 flex-1">
              <Link
                href={`/tasks?highlight=${task.id}`}
                className="block truncate text-small font-medium hover:underline"
              >
                {task.title}
              </Link>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
                {task.project && <span className="truncate">{task.project.name}</span>}
                {due && <span className={cn('font-medium', toneClass[due.tone])}>{due.label}</span>}
              </p>
            </div>
            <PriorityBadge priority={task.priority} className="hidden sm:inline-flex" />
            <AvatarGroup people={task.assignees.map((assignee) => assignee.user)} max={3} />
          </li>
        )
      })}
    </ul>
  )
}
