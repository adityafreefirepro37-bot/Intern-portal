import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { CalendarClock, CheckCircle2, ClipboardCheck, Hourglass, OctagonAlert, Timer } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { StatCard } from '@/components/common/stat-card'
import { AccessDenied } from '@/components/common/states'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MilestoneBadge, WorkloadBadge } from '@/features/work/components/work-badges'
import { WorkItemList } from '@/features/work/components/work-item-list'
import { formatDay } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { workService } from '@/server/services/work.service'

export const metadata: Metadata = { title: 'My Work' }

function Section({
  title,
  description,
  children,
  href,
}: {
  title: string
  description?: string
  children: ReactNode
  href?: string
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {href && (
          <Link href={href} className="shrink-0 text-small font-medium text-primary hover:underline">
            View all
          </Link>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/** The personal command centre: what needs doing today, what’s next, what’s waiting. */
export default async function MyWorkPage() {
  const ctx = await requirePageContext()
  const work = await workService.myWork(ctx)
  if (!work) return <AccessDenied what="tasks" />

  return (
    <>
      <PageHeader
        title="My Work"
        description="Everything assigned to you, in order of urgency."
        actions={work.workload && <WorkloadBadge level={work.workload.level} />}
      />

      <section aria-label="Today" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          label="Due today"
          value={work.dueToday.length}
          icon={CalendarClock}
          tone={work.dueToday.length ? 'attention' : 'default'}
          href="/tasks?assignee=me&due=today"
        />
        <StatCard
          label="Overdue"
          value={work.overdue.length}
          icon={OctagonAlert}
          tone={work.overdue.length ? 'attention' : 'default'}
          href="/tasks?assignee=me&due=overdue"
        />
        <StatCard
          label="In progress"
          value={work.inProgress.length}
          icon={Timer}
          href="/tasks?assignee=me&status=IN_PROGRESS"
        />
        <StatCard
          label="Awaiting review"
          value={work.awaitingReview.length}
          icon={Hourglass}
          href="/tasks?assignee=me&status=IN_REVIEW"
        />
        <StatCard
          label="Blocked"
          value={work.blocked.length}
          icon={OctagonAlert}
          tone={work.blocked.length ? 'attention' : 'default'}
          href="/tasks?assignee=me&status=BLOCKED"
          className="col-span-2 lg:col-span-1"
        />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="Today" description="Overdue and due today">
          <WorkItemList items={[...work.overdue, ...work.dueToday]} empty="Nothing due today. Nice." />
        </Section>

        <Section
          title="Waiting for me"
          description="Assigned to you or sent back with changes requested"
          href="/tasks?assignee=me"
        >
          <WorkItemList items={work.waitingForMe} empty="No tasks waiting for you to start." />
        </Section>

        <Section title="In progress">
          <WorkItemList items={work.inProgress} empty="Nothing in progress. Start one of your assigned tasks." />
        </Section>

        <Section title="Waiting for review" description="Work you submitted">
          <WorkItemList items={work.awaitingReview} empty="Nothing waiting for review." />
        </Section>

        {work.toReview.length > 0 && (
          <Section
            title="To review"
            description="Submissions from others waiting for your review"
            href="/tasks?submission=PENDING"
          >
            <WorkItemList items={work.toReview} empty="" showAssignees />
          </Section>
        )}

        <Section title="Blocked">
          <WorkItemList items={work.blocked} empty="Nothing blocked." />
        </Section>

        <Section title="Upcoming" description="Due in the next 7 days">
          <WorkItemList items={work.upcoming} empty="No upcoming deadlines this week." />
          {work.milestones.length > 0 && (
            <div className="mt-4 border-t pt-4">
              <h3 className="mb-2 text-caption font-medium text-muted-foreground">Upcoming milestones</h3>
              <ul className="space-y-2">
                {work.milestones.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2 text-small">
                    <Link href={`/projects/${m.project.id}/milestones`} className="min-w-0 truncate hover:underline">
                      {m.name} <span className="text-muted-foreground">· {m.project.name}</span>
                    </Link>
                    <span className="flex shrink-0 items-center gap-2 text-caption text-muted-foreground">
                      {formatDay(m.due_date)} <MilestoneBadge status={m.displayStatus} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        <Section title="Recently completed" description="Last 14 days">
          <WorkItemList items={work.recentlyCompleted} empty="No completed tasks in the last two weeks." />
        </Section>
      </div>

      {work.workload && (
        <p className="mt-6 flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
          <ClipboardCheck className="size-4" aria-hidden /> Workload: {work.workload.active} active,{' '}
          {work.workload.dueThisWeek} due this week, {work.workload.hoursThisWeek}h estimated this week.
          <CheckCircle2 className="ml-2 size-4" aria-hidden /> {work.recentlyCompleted.length} completed recently.
        </p>
      )}
    </>
  )
}
