import type { Metadata } from 'next'
import Link from 'next/link'
import { CheckCircle2, CircleDot, ClipboardCheck, ListTodo, OctagonAlert, Timer } from 'lucide-react'
import { StatCard } from '@/components/common/stat-card'
import { EmptyState } from '@/components/common/states'
import { UserAvatar } from '@/components/common/user-avatar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/misc'
import { ActivityList } from '@/features/work/components/activity-list'
import { WorkloadBadge } from '@/features/work/components/work-badges'
import { cn, formatDay, fullName } from '@/lib/utils'
import { MEMBER_ROLE_LABELS, MILESTONE_STATUS_LABELS } from '@/lib/work/projects'
import { requirePageContext } from '@/server/context'
import { projectService } from '@/server/services/project.service'

export const metadata: Metadata = { title: 'Project' }

/** Project dashboard: KPIs, milestone timeline, workload, recent activity, team. */
export default async function ProjectOverviewPage({ params }: PageProps<'/projects/[id]'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  const { project, stats, milestones, activity, workload } = await projectService.getOverview(ctx, id)
  const base = `/projects/${project.id}`

  return (
    <div className="space-y-6">
      <section aria-label="Task totals" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total tasks" value={stats.total} icon={ListTodo} href={`${base}/tasks?closed=1`} />
        <StatCard
          label="Completed"
          value={stats.completed}
          icon={CheckCircle2}
          href={`${base}/tasks?status=COMPLETED`}
        />
        <StatCard label="In progress" value={stats.inProgress} icon={Timer} href={`${base}/tasks?status=IN_PROGRESS`} />
        <StatCard
          label="Blocked"
          value={stats.blocked}
          icon={OctagonAlert}
          href={`${base}/tasks?status=BLOCKED`}
          tone={stats.blocked > 0 ? 'attention' : 'default'}
        />
        <StatCard
          label="Overdue"
          value={stats.overdue}
          icon={CircleDot}
          href={`${base}/tasks?due=overdue`}
          tone={stats.overdue > 0 ? 'attention' : 'default'}
        />
        <StatCard
          label="Pending review"
          value={stats.pendingReview}
          icon={ClipboardCheck}
          href={`${base}/tasks?submission=PENDING`}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div className="space-y-1">
                <CardTitle>Timeline</CardTitle>
                <CardDescription>
                  {formatDay(project.start_date)} → milestones → {formatDay(project.target_end_date)}
                </CardDescription>
              </div>
              <Link
                href={`${base}/milestones`}
                className="shrink-0 text-small font-medium text-primary hover:underline"
              >
                Milestones
              </Link>
            </CardHeader>
            <CardContent>
              {milestones.length === 0 ? (
                <EmptyState
                  compact
                  title="No milestones yet"
                  description="Create milestones to break this project into measurable stages."
                />
              ) : (
                <ol className="relative space-y-4 border-l pl-5">
                  {milestones.map((milestone) => (
                    <li key={milestone.id} className="relative">
                      <span
                        className={cn(
                          'absolute -left-[1.6rem] top-1.5 size-2.5 rounded-full ring-4 ring-card',
                          milestone.displayStatus === 'COMPLETED'
                            ? 'bg-success'
                            : milestone.displayStatus === 'OVERDUE'
                              ? 'bg-destructive'
                              : milestone.displayStatus === 'ACTIVE'
                                ? 'bg-primary'
                                : 'bg-muted-foreground/40',
                        )}
                        aria-hidden
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-small font-medium">{milestone.name}</p>
                        <span className="text-caption text-muted-foreground">
                          {MILESTONE_STATUS_LABELS[milestone.displayStatus]} · due {formatDay(milestone.due_date)}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-3">
                        <Progress
                          value={milestone.progress.percent}
                          label={`${milestone.name}: ${milestone.progress.percent}%`}
                        />
                        <span className="tabular shrink-0 text-caption text-muted-foreground">
                          {milestone.progress.completed}/{milestone.progress.total}
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          {workload && (
            <Card>
              <CardHeader>
                <CardTitle>Workload</CardTitle>
                <CardDescription>
                  Open work per contributor on this project (rules: docs/work-management.md).
                </CardDescription>
              </CardHeader>
              <CardContent>
                {workload.length === 0 ? (
                  <p className="text-small text-muted-foreground">No contributors yet.</p>
                ) : (
                  <div role="region" aria-label="Workload" tabIndex={0} className="overflow-x-auto">
                    <table className="w-full text-small">
                      <thead>
                        <tr className="border-b text-left text-caption text-muted-foreground">
                          <th scope="col" className="py-2 pr-3 font-medium">
                            Person
                          </th>
                          <th scope="col" className="px-3 font-medium">
                            Active
                          </th>
                          <th scope="col" className="px-3 font-medium">
                            Overdue
                          </th>
                          <th scope="col" className="px-3 font-medium">
                            Due this week
                          </th>
                          <th scope="col" className="px-3 font-medium">
                            Est. hours
                          </th>
                          <th scope="col" className="pl-3 font-medium">
                            Load
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {workload.map((row) => (
                          <tr key={row.user.id} className="border-b last:border-b-0">
                            <td className="py-2 pr-3">
                              <span className="flex items-center gap-2">
                                <UserAvatar person={row.user} className="size-6" /> {fullName(row.user)}
                              </span>
                            </td>
                            <td className="tabular px-3">{row.active}</td>
                            <td className={cn('tabular px-3', row.overdue > 0 && 'text-destructive')}>{row.overdue}</td>
                            <td className="tabular px-3">{row.dueThisWeek}</td>
                            <td className="tabular px-3">{row.hoursThisWeek}</td>
                            <td className="pl-3">
                              <WorkloadBadge level={row.level} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {project.description && (
            <Card>
              <CardHeader>
                <CardTitle>About</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-line text-small">{project.description}</p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <CardTitle>Recent activity</CardTitle>
              <Link href={`${base}/activity`} className="shrink-0 text-small font-medium text-primary hover:underline">
                All
              </Link>
            </CardHeader>
            <CardContent>
              <ActivityList entries={activity} compact />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <CardTitle>Team</CardTitle>
              <Link href={`${base}/team`} className="shrink-0 text-small font-medium text-primary hover:underline">
                Manage
              </Link>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2.5">
                {project.members.slice(0, 8).map((member) => (
                  <li key={member.user.id} className="flex items-center gap-2 text-small">
                    <UserAvatar person={member.user} className="size-7" />
                    <span className="min-w-0 flex-1 truncate">{fullName(member.user)}</span>
                    <span className="text-caption text-muted-foreground">{MEMBER_ROLE_LABELS[member.role]}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
