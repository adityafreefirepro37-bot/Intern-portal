import type { TaskStatus } from '@prisma/client'
import { humanizeEnum, percent } from '@/lib/utils'

/**
 * Proportional bar of tasks by workflow stage. Stages are grouped to keep the
 * palette small; the legend lists exact counts so the chart is readable
 * without relying on colour.
 */
const STAGES: { key: string; label: string; statuses: TaskStatus[]; color: string }[] = [
  { key: 'todo', label: 'To do', statuses: ['BACKLOG', 'ASSIGNED'], color: 'bg-chart-6' },
  { key: 'progress', label: 'In progress', statuses: ['IN_PROGRESS'], color: 'bg-chart-1' },
  { key: 'review', label: 'In review', statuses: ['IN_REVIEW', 'CHANGES_REQUESTED'], color: 'bg-chart-2' },
  { key: 'blocked', label: 'Blocked', statuses: ['BLOCKED'], color: 'bg-chart-4' },
  { key: 'done', label: 'Completed', statuses: ['COMPLETED'], color: 'bg-chart-5' },
]

export function TaskStatusBreakdown({ rows }: { rows: { status: TaskStatus; count: number }[] }) {
  const counts = new Map(rows.map((row) => [row.status, row.count]))
  const stages = STAGES.map((stage) => ({
    ...stage,
    count: stage.statuses.reduce((sum, status) => sum + (counts.get(status) ?? 0), 0),
  }))
  const total = stages.reduce((sum, stage) => sum + stage.count, 0)
  const cancelled = counts.get('CANCELLED') ?? 0

  if (total === 0) {
    return <p className="py-6 text-center text-small text-muted-foreground">No tasks yet.</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {stages
          .filter((stage) => stage.count > 0)
          .map((stage) => (
            <div key={stage.key} className={stage.color} style={{ width: `${(stage.count / total) * 100}%` }} />
          ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3" aria-label="Tasks by stage">
        {stages.map((stage) => (
          <li key={stage.key} className="flex items-center gap-2 text-small">
            <span className={`size-2.5 shrink-0 rounded-sm ${stage.color}`} aria-hidden />
            <span className="text-muted-foreground">{stage.label}</span>
            <span className="tabular ml-auto font-medium">{stage.count}</span>
            <span className="sr-only">({percent(stage.count, total)}%)</span>
          </li>
        ))}
      </ul>
      {cancelled > 0 && (
        <p className="text-caption text-muted-foreground">
          {cancelled} {humanizeEnum('CANCELLED').toLowerCase()} not shown.
        </p>
      )}
    </div>
  )
}
