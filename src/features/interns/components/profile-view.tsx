import type { ReactNode } from 'react'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { PhaseBadge, PriorityBadge, StatusBadge } from '@/components/common/badges'
import { EmptyState } from '@/components/common/states'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn, formatDate, formatDay, fullName, timeAgo } from '@/lib/utils'

/** Label/value pair for detail grids. */
export function Detail({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-small break-words">{value || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  )
}

export interface ProfileTab {
  key: string
  label: string
}

/** Link-based tabs (`?tab=`) so each tab is linkable and server-rendered. */
export function ProfileTabs({ tabs, active, basePath }: { tabs: ProfileTab[]; active: string; basePath: string }) {
  return (
    <nav aria-label="Profile sections" className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-lg bg-muted p-1 lg:w-auto lg:flex-wrap">
        {tabs.map((tab) => {
          const current = tab.key === active
          return (
            <li key={tab.key}>
              <Link
                href={tab.key === 'overview' ? basePath : `${basePath}?tab=${tab.key}`}
                aria-current={current ? 'page' : undefined}
                scroll={false}
                className={cn(
                  'inline-flex h-8 items-center whitespace-nowrap rounded-md px-3 text-label text-muted-foreground transition-colors hover:text-foreground',
                  current && 'bg-card text-foreground shadow-sm',
                )}
              >
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** A later-phase module shown honestly as not available yet. */
export function ModuleComingSoon({
  icon: Icon,
  title,
  phase,
  description,
}: {
  icon: LucideIcon
  title: string
  phase: string
  description: string
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <span className="flex size-11 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="flex items-center gap-2">
          <h2 className="text-h3">{title}</h2>
          <PhaseBadge phase={phase} />
        </div>
        <p className="max-w-sm text-small text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  )
}

type Person = { first_name: string; last_name: string; display_name: string | null }

export function TasksList({
  tasks,
}: {
  tasks: {
    id: string
    title: string
    status: string
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
    due_date: Date | null
    project: { name: string } | null
  }[]
}) {
  if (tasks.length === 0)
    return <EmptyState title="No tasks" description="Tasks assigned to this intern appear here." compact />
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {tasks.map((task) => (
        <li key={task.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="truncate font-medium">{task.title}</p>
            <p className="text-caption text-muted-foreground">
              {task.project?.name ?? 'No project'}
              {task.due_date && ` · due ${formatDate(task.due_date)}`}
            </p>
          </div>
          <div className="flex gap-2">
            <PriorityBadge priority={task.priority} />
            <StatusBadge status={task.status} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function ProjectsList({
  projects,
}: {
  projects: { id: string; name: string; status: string; target_end_date: Date | null }[]
}) {
  if (projects.length === 0)
    return <EmptyState title="No projects" description="Projects this intern is a member of appear here." compact />
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {projects.map((project) => (
        <li key={project.id} className="flex items-center justify-between gap-2 p-4">
          <div className="min-w-0">
            <p className="truncate font-medium">{project.name}</p>
            <p className="text-caption text-muted-foreground">
              {project.target_end_date ? `Target ${formatDay(project.target_end_date)}` : 'No target date'}
            </p>
          </div>
          <StatusBadge status={project.status} />
        </li>
      ))}
    </ul>
  )
}

export function ActivityTimeline({
  events,
}: {
  events: { id: string; event_type: string; description: string; created_at: Date; actor: Person | null }[]
}) {
  if (events.length === 0) return <EmptyState title="No activity yet" compact />
  const now = new Date()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Timeline</CardTitle>
        <CardDescription>Lifecycle events for this internship, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="relative space-y-5 border-l pl-5">
          {events.map((event) => (
            <li key={event.id} className="relative">
              <span
                className="absolute -left-[1.6rem] top-1.5 size-2.5 rounded-full bg-primary ring-4 ring-card"
                aria-hidden
              />
              <p className="text-small">{event.description}</p>
              <p className="text-caption text-muted-foreground">
                <time dateTime={event.created_at.toISOString()} title={event.created_at.toISOString()}>
                  {timeAgo(event.created_at, now)}
                </time>
                {' · '}
                {event.actor ? fullName(event.actor) : 'System'}
              </p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
