import type { Metadata } from 'next'
import Link from 'next/link'
import { Download } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { inputClassName } from '@/components/ui/input'
import { HBars, Stat, TrendChart } from '@/features/analytics/components/charts'
import { PERIOD_OPTIONS } from '@/lib/analytics/series'
import { cn } from '@/lib/utils'
import { firstParam } from '@/lib/validation/list-params'
import { requirePageContext } from '@/server/context'
import { analyticsService } from '@/server/services/analytics.service'
import { authorizationService } from '@/server/services/authorization.service'

export const metadata: Metadata = { title: 'Analytics' }

const pct = (v: number | null) => (v === null ? null : `${v}%`)

/**
 * Programme analytics across interns, work, attendance, learning, performance
 * and communication. Counts and ratios of stored records only — no scores,
 * rankings or predictions. Filters are plain GET parameters (shareable links).
 */
export default async function AnalyticsPage({ searchParams }: PageProps<'/analytics'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'analytics.read')) return <AccessDenied what="analytics" />
  const params = await searchParams
  const filters = analyticsService.parseFilters({
    months: firstParam(params, 'months'),
    departmentId: firstParam(params, 'departmentId'),
    teamId: firstParam(params, 'teamId'),
  })
  const [data, options] = await Promise.all([analyticsService.overview(ctx, filters), analyticsService.filterOptions(ctx)])
  const canExport = authorizationService.can(ctx, 'analytics.export')
  const query = new URLSearchParams({
    months: String(filters.months),
    ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    ...(filters.teamId ? { teamId: filters.teamId } : {}),
  }).toString()
  const can = (key: Parameters<typeof authorizationService.can>[1]) => authorizationService.can(ctx, key)
  const L = data.monthLabels

  return (
    <>
      <PageHeader
        title="Analytics"
        description={
          data.scope === 'ORGANIZATION'
            ? 'How the internship programme is going, month by month. Counts and ratios of recorded activity only.'
            : 'How the interns you manage are doing, month by month. Counts and ratios of recorded activity only.'
        }
        actions={
          canExport && (
            <a href={`/api/analytics/export?${query}`} className={buttonVariants({ variant: 'outline' })} download>
              <Download aria-hidden /> Export CSV
            </a>
          )
        }
      />

      <form className="mb-6 flex flex-wrap items-end gap-2" aria-label="Filters">
        <label className="grid gap-1 text-caption text-muted-foreground">
          Period
          <select name="months" defaultValue={String(filters.months)} className={cn(inputClassName, 'w-40')}>
            {PERIOD_OPTIONS.map((m) => (
              <option key={m} value={m}>
                Last {m} months
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-caption text-muted-foreground">
          Department
          <select name="departmentId" defaultValue={filters.departmentId ?? ''} className={cn(inputClassName, 'w-44')}>
            <option value="">All departments</option>
            {options.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-caption text-muted-foreground">
          Team
          <select name="teamId" defaultValue={filters.teamId ?? ''} className={cn(inputClassName, 'w-44')}>
            <option value="">All teams</option>
            {options.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
          Apply
        </button>
        {(filters.departmentId || filters.teamId || filters.months !== 6) && (
          <Link href="/analytics" className="pb-2 text-caption font-medium text-primary hover:underline">
            Reset
          </Link>
        )}
        <p className="basis-full text-caption text-muted-foreground">
          {data.internCount} intern{data.internCount === 1 ? '' : 's'} in view · {L[0]} – {L[L.length - 1]}
        </p>
      </form>

      <section aria-labelledby="kpis" className="mb-6">
        <h2 id="kpis" className="sr-only">Headline figures</h2>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <Stat label="Interns joined" value={data.pipeline.joined} hint="in the period" />
          <Stat label="Internships completed" value={data.pipeline.completed} hint={data.pipeline.completionRate === null ? 'none ended' : `${data.pipeline.completionRate}% of those ended`} />
          <Stat label="Tasks completed" value={data.work.completed} hint={data.work.onTimeRate === null ? 'no due dates' : `${data.work.onTimeRate}% on time`} />
          <Stat label="Review turnaround" value={data.work.avgReviewHours === null ? null : `${data.work.avgReviewHours} h`} hint="submitted → reviewed, average" />
          <Stat label="Attendance" value={pct(data.attendance.rate)} hint="of working days recorded" />
          <Stat label="Courses completed" value={data.learning.coursesCompleted} hint={data.learning.completionRate === null ? undefined : `${data.learning.completionRate}% of enrolments done`} />
        </dl>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Intern pipeline</CardTitle>
            <CardDescription>
              Average internship length {data.pipeline.avgLengthDays === null ? '—' : `${data.pipeline.avgLengthDays} days`} · {data.pipeline.terminated} ended early in the period
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <TrendChart
              title="Joined and completed"
              description="By joining date and actual end date."
              labels={L}
              series={[
                { name: 'Joined', values: data.pipeline.joinedByMonth, tone: 'viz-1' },
                { name: 'Completed', values: data.pipeline.completedByMonth, tone: 'viz-2' },
              ]}
            />
            <div className="space-y-2">
              <p className="text-small font-medium">Interns by status now</p>
              <HBars items={data.pipeline.byStatus} empty="No interns in view." />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Work</CardTitle>
            <CardDescription>
              Tasks assigned to these interns · {data.work.avgDaysToComplete === null ? '—' : `${data.work.avgDaysToComplete} days`} average from creation to completion
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <TrendChart
              title="Tasks created and completed"
              labels={L}
              series={[
                { name: 'Created', values: data.work.createdByMonth, tone: 'viz-1' },
                { name: 'Completed', values: data.work.completedByMonth, tone: 'viz-2' },
              ]}
            />
            <dl className="grid grid-cols-3 gap-3">
              <Stat label="Submissions reviewed" value={data.work.reviewed} />
              <Stat label="Sent back for changes" value={pct(data.work.sentBackRate)} />
              <Stat label="Overdue now" value={data.work.overdueOpen} />
            </dl>
            <div className="space-y-2">
              <p className="text-small font-medium">Overdue open tasks by project</p>
              <HBars items={data.work.overdueByProject} empty="Nothing overdue." />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Attendance and leave</CardTitle>
            <CardDescription>
              {data.attendance.late} late arrivals · {data.attendance.leaveDays} approved leave days in the period
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <TrendChart
              title="Attendance rate"
              description="Days attended (present, late or half day) of working days recorded."
              labels={L}
              kind="line"
              unit="%"
              series={[{ name: 'Attendance', values: data.attendance.rateByMonth, tone: 'viz-1' }]}
            />
            <TrendChart
              title="Late arrivals"
              labels={L}
              series={[{ name: 'Late arrivals', values: data.attendance.lateByMonth, tone: 'viz-2' }]}
            />
            <div className="space-y-2">
              <p className="text-small font-medium">Approved leave days by type</p>
              <HBars items={data.attendance.leaveByType} unit=" d" empty="No approved leave in the period." />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Learning and performance</CardTitle>
            <CardDescription>Courses, quizzes, goals, check-ins and reviews.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <TrendChart
              title="Courses completed"
              labels={L}
              series={[{ name: 'Courses completed', values: data.learning.completedByMonth, tone: 'viz-1' }]}
            />
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="Overdue courses" value={data.learning.overdue} hint="not finished by the due date" />
              <Stat label="Quiz pass rate" value={pct(data.learning.quizPassRate)} hint={`${data.learning.quizzes} attempts`} />
              <Stat label="Goals completed" value={data.performance.goalsCompleted} hint={`${data.performance.goalsOpen} open · ${data.performance.goalsAtRisk} at risk`} />
              <Stat label="Check-ins submitted" value={data.performance.checkinsSubmitted} hint={data.performance.checkinsReviewedRate === null ? undefined : `${data.performance.checkinsReviewedRate}% reviewed`} />
              <Stat label="Reviews completed" value={data.performance.reviewsCompleted} />
            </dl>
          </CardContent>
        </Card>

        {data.communication && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Communication</CardTitle>
              <CardDescription>Organization-wide: meetings, messages and notification emails.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 lg:grid-cols-[1fr_1fr_16rem]">
              <TrendChart
                title="Meetings held"
                description="Scheduled meetings (not cancelled) by start date."
                labels={L}
                series={[{ name: 'Meetings', values: data.communication.meetingsByMonth, tone: 'viz-1' }]}
              />
              <TrendChart
                title="Messages sent"
                labels={L}
                series={[{ name: 'Messages', values: data.communication.messagesByMonth, tone: 'viz-2' }]}
              />
              <dl className="grid content-start gap-3">
                <Stat label="Invitations accepted" value={pct(data.communication.acceptanceRate)} hint={`${data.communication.noReply} still without a reply`} />
                <Stat label="Meetings cancelled" value={data.communication.cancelled} />
                <Stat
                  label="Emails sent"
                  value={data.communication.emailsSent}
                  hint={`${data.communication.emailsFailed} failed · ${data.communication.emailsSkipped} skipped`}
                />
              </dl>
            </CardContent>
          </Card>
        )}
      </div>

      <nav aria-label="More analytics" className="mt-6 flex flex-wrap gap-2 text-small">
        {can('hr_dashboard.read') && (
          <Link href="/hr/analytics" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            HR analytics →
          </Link>
        )}
        {can('learning.read') && (
          <Link href="/learning/analytics" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Learning analytics →
          </Link>
        )}
        {can('performance.read') && (
          <Link href="/performance/analytics" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Performance analytics →
          </Link>
        )}
      </nav>
    </>
  )
}
