import type { Metadata } from 'next'
import Link from 'next/link'
import { CalendarClock, CheckSquare, ClipboardCheck, Megaphone, UsersRound } from 'lucide-react'
import { StatCard } from '@/components/common/stat-card'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ActivityFeed } from '@/features/dashboard/components/activity-feed'
import { ProjectProgress } from '@/features/dashboard/components/project-progress'
import { QuickActions } from '@/features/dashboard/components/quick-actions'
import { TaskStatusBreakdown } from '@/features/dashboard/components/task-status-breakdown'
import { UpcomingTasks } from '@/features/dashboard/components/upcoming-tasks'
import { formatDate, greeting } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { dashboardService, UPCOMING_WINDOW_DAYS } from '@/server/services/dashboard.service'

export const metadata: Metadata = { title: 'Overview' }

export default async function OverviewPage() {
  const ctx = await requirePageContext()
  const now = new Date()
  const overview = await dashboardService.getOverview(ctx, now)
  const { stats } = overview
  const firstName = ctx.actor.displayName.split(' ')[0]
  const timeZone = ctx.organization.timezone

  const statCards = [
    stats.activeInterns !== null && (
      <StatCard
        key="interns"
        label="Active interns"
        value={stats.activeInterns}
        icon={UsersRound}
        href="/interns"
        hint="Active or ending soon"
      />
    ),
    stats.openTasks !== null && (
      <StatCard
        key="tasks"
        label="Open tasks"
        value={stats.openTasks}
        icon={CheckSquare}
        href="/tasks"
        hint="Not completed or cancelled"
      />
    ),
    stats.pendingReviews !== null && (
      <StatCard
        key="reviews"
        label="Pending reviews"
        value={stats.pendingReviews}
        icon={ClipboardCheck}
        href="/tasks?status=IN_REVIEW"
        hint="Submissions awaiting review"
        tone={stats.pendingReviews > 0 ? 'attention' : 'default'}
      />
    ),
    stats.upcomingDeadlines !== null && (
      <StatCard
        key="deadlines"
        label="Upcoming deadlines"
        value={stats.upcomingDeadlines}
        icon={CalendarClock}
        hint={`Open tasks due in ${UPCOMING_WINDOW_DAYS} days`}
      />
    ),
  ].filter(Boolean)

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <p className="text-small text-muted-foreground">
          {new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone }).format(now)}
        </p>
        <h1 className="text-display">
          {greeting(now, timeZone)}, {firstName}
        </h1>
        <p className="text-body text-muted-foreground">Here’s today’s overview for {ctx.organization.name}.</p>
      </header>

      {statCards.length > 0 && (
        <section aria-label="Today’s overview" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {statCards}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {overview.upcomingTasks && (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div className="space-y-1">
                  <CardTitle>Upcoming deadlines</CardTitle>
                  <CardDescription>
                    Open tasks due in the next {UPCOMING_WINDOW_DAYS} days, including overdue
                  </CardDescription>
                </div>
                <Link href="/tasks" className="text-small font-medium text-primary hover:underline">
                  All tasks
                </Link>
              </CardHeader>
              <CardContent>
                <UpcomingTasks tasks={overview.upcomingTasks} now={now} />
              </CardContent>
            </Card>
          )}

          <div className="grid gap-6 md:grid-cols-2">
            {overview.projects && (
              <Card>
                <CardHeader>
                  <CardTitle>Project progress</CardTitle>
                  <CardDescription>Based on completed tasks</CardDescription>
                </CardHeader>
                <CardContent>
                  <ProjectProgress projects={overview.projects} timeZone={timeZone} />
                </CardContent>
              </Card>
            )}
            {overview.taskStatus && (
              <Card>
                <CardHeader>
                  <CardTitle>Work by stage</CardTitle>
                  <CardDescription>All tasks across projects</CardDescription>
                </CardHeader>
                <CardContent>
                  <TaskStatusBreakdown rows={overview.taskStatus} />
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Quick actions</CardTitle>
            </CardHeader>
            <CardContent>
              <QuickActions can={(permission) => ctx.actor.permissions.has(permission)} />
            </CardContent>
          </Card>

          {overview.announcements && overview.announcements.length > 0 && (
            <Card>
              <CardHeader className="flex-row items-center gap-2">
                <Megaphone className="size-4 text-primary" aria-hidden />
                <CardTitle>Announcements</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {overview.announcements.map((announcement) => (
                  <article key={announcement.id} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-small font-medium">{announcement.title}</h3>
                      {(announcement.priority === 'HIGH' || announcement.priority === 'URGENT') && (
                        <Badge variant="warning">{announcement.priority === 'URGENT' ? 'Urgent' : 'Important'}</Badge>
                      )}
                    </div>
                    <p className="line-clamp-3 text-small text-muted-foreground">{announcement.body}</p>
                    {announcement.published_at && (
                      <p className="text-caption text-muted-foreground">
                        {formatDate(announcement.published_at, timeZone)}
                      </p>
                    )}
                  </article>
                ))}
              </CardContent>
            </Card>
          )}

          {overview.activity && (
            <Card>
              <CardHeader>
                <CardTitle>Recent activity</CardTitle>
              </CardHeader>
              <CardContent>
                <ActivityFeed items={overview.activity} now={now} />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
