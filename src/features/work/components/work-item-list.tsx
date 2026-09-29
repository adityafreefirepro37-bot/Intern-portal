import Link from 'next/link'
import { PriorityBadge, StatusBadge } from '@/components/common/badges'
import { AvatarGroup } from '@/components/common/user-avatar'
import type { WorkItem } from '@/server/services/work.service'
import { DeadlineLabel, SubmissionBadge } from './work-badges'

/** Compact task rows for My Work and dashboards. */
export function WorkItemList({
  items,
  empty,
  showAssignees = false,
}: {
  items: WorkItem[]
  empty: string
  showAssignees?: boolean
}) {
  if (items.length === 0) return <p className="py-3 text-small text-muted-foreground">{empty}</p>
  return (
    <ul className="divide-y">
      {items.map((task) => (
        <li key={task.id} className="flex flex-col gap-1.5 py-2.5">
          <div className="min-w-0 flex-1">
            <Link href={`/tasks/${task.id}`} className="block truncate text-small font-medium hover:underline">
              {task.title}
            </Link>
            <p className="flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
              {task.project && <span className="truncate">{task.project.name}</span>}
              <DeadlineLabel deadline={task.deadline} />
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-caption">
            {!['IN_REVIEW', 'CHANGES_REQUESTED'].includes(task.status) && (
              <SubmissionBadge status={task.submissionStatus} />
            )}
            <PriorityBadge priority={task.priority} />
            <StatusBadge status={task.status} />
            {showAssignees && task.assignees.length > 0 && (
              <AvatarGroup people={task.assignees.map((a) => a.user)} max={2} />
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
