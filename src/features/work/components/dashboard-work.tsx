import Link from 'next/link'
import { Briefcase, Inbox, UsersRound } from 'lucide-react'
import { UserAvatar } from '@/components/common/user-avatar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn, fullName } from '@/lib/utils'
import type { WorkDashboard } from '@/server/services/work.service'
import { WorkloadBadge } from './work-badges'

function Figure({
  label,
  value,
  href,
  alert = false,
}: {
  label: string
  value: number | null
  href?: string
  alert?: boolean
}) {
  if (value === null) return null
  // dt/dd must be direct children of the dl's div wrapper, so the link goes inside the dd.
  return (
    <div className="relative rounded-lg border p-3">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className={cn('tabular text-h3', alert && value > 0 && 'text-destructive')}>
        {href ? (
          <Link href={href} aria-label={`${label}: ${value}`} className="after:absolute after:inset-0 hover:underline">
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}

/**
 * Work summaries shaped by what the viewer does: their own work (anyone with
 * assignments), their team (managers/mentors), the organization (HR/Admin).
 */
export function DashboardWork({ work }: { work: WorkDashboard }) {
  const hasOwnWork = work.mine.open > 0 || work.mine.activeProjects > 0
  return (
    <div className="space-y-6">
      {hasOwnWork && (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Inbox className="size-4 text-primary" aria-hidden /> My tasks
              </CardTitle>
              <CardDescription>
                {work.mine.open} open · {work.mine.activeProjects} active project
                {work.mine.activeProjects === 1 ? '' : 's'}
              </CardDescription>
            </div>
            <Link href="/my-work" className="shrink-0 text-small font-medium text-primary hover:underline">
              My Work
            </Link>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Figure label="Due today" value={work.mine.dueToday} href="/tasks?assignee=me&due=today" alert />
              <Figure label="Overdue" value={work.mine.overdue} href="/tasks?assignee=me&due=overdue" alert />
              <Figure label="In review" value={work.mine.inReview} href="/tasks?assignee=me&status=IN_REVIEW" />
              <Figure label="Blocked" value={work.mine.blocked} href="/tasks?assignee=me&status=BLOCKED" alert />
              <Figure label="Due in 7 days" value={work.mine.upcoming} href="/tasks?assignee=me&due=week" />
            </dl>
          </CardContent>
        </Card>
      )}

      {work.team && (work.team.open ?? 0) + (work.pendingReviews ?? 0) > 0 && (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <UsersRound className="size-4 text-primary" aria-hidden /> Team work
              </CardTitle>
              <CardDescription>Your interns and the projects you lead or mentor</CardDescription>
            </div>
            {work.workload && (
              <Link href="/workload" className="shrink-0 text-small font-medium text-primary hover:underline">
                Workload
              </Link>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Figure label="Open tasks" value={work.team.open} />
              <Figure label="Overdue" value={work.team.overdue} alert />
              <Figure label="Blocked" value={work.team.blocked} alert />
              <Figure label="Pending reviews" value={work.pendingReviews} href="/tasks?submission=PENDING" />
            </dl>
            {work.workload && work.workload.length > 0 && (
              <ul className="divide-y">
                {work.workload.slice(0, 6).map((row) => (
                  <li key={row.user.id} className="flex items-center gap-3 py-2 text-small">
                    <UserAvatar person={row.user} className="size-7" />
                    <span className="min-w-0 flex-1 truncate">{fullName(row.user)}</span>
                    <span className="text-caption text-muted-foreground">
                      {row.active} active{row.overdue > 0 && `, ${row.overdue} overdue`}
                    </span>
                    <WorkloadBadge level={row.level} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {work.organization && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Briefcase className="size-4 text-primary" aria-hidden /> Organization work
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Figure label="Active projects" value={work.organization.activeProjects} href="/projects?status=ACTIVE" />
              <Figure label="Open tasks" value={work.organization.openTasks} href="/tasks" />
              <Figure label="Overdue" value={work.organization.overdue} href="/tasks?due=overdue" alert />
              <Figure label="Blocked" value={work.organization.blocked} href="/tasks?status=BLOCKED" alert />
              <Figure
                label="Pending reviews"
                value={work.organization.pendingReviews}
                href="/tasks?submission=PENDING"
              />
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
