import type { Metadata } from 'next'
import Link from 'next/link'
import { AlertTriangle, BookOpen, CheckCircle2, ClipboardCheck, Download, Users } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { StatCard } from '@/components/common/stat-card'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { DataTable } from '@/components/tables/data-table'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { inputClassName } from '@/components/ui/input'
import { EnrollmentStatusBadge } from '@/features/learning/components/learning-ui'
import { ENROLLMENT_STATUS_LABELS, ENROLLMENT_TYPE_LABELS } from '@/lib/learning/rules'
import { formatDay, fullName } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { learningAnalyticsService } from '@/server/services/learning-analytics.service'

export const metadata: Metadata = { title: 'Learning analytics' }

export default async function LearningAnalyticsPage({ searchParams }: PageProps<'/learning/analytics'>) {
  const ctx = await requirePageContext()
  const scope = authorizationService.scopeOf(ctx, 'learning.read')
  if (!scope || scope === 'OWN') return <AccessDenied what="learning analytics" />
  const raw = await searchParams
  const query = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : (v ?? '')]))
  const [data, rows] = await Promise.all([
    learningAnalyticsService.overview(ctx, query),
    learningAnalyticsService.enrollments(ctx, query),
  ])
  const { totals } = data
  const exportHref = `/api/learning/export?${new URLSearchParams(Object.entries(query).filter(([, v]) => v) as [string, string][]).toString()}`

  return (
    <>
      <PageHeader
        title={data.orgWide ? 'Learning analytics' : 'Team learning'}
        breadcrumbs={[{ label: 'Learning Hub', href: '/learning' }, { label: 'Analytics' }]}
        description="Counts of enrollments, completions, quiz attempts and reviews. Nobody is ranked or scored here."
        actions={
          data.can.export ? (
            <a href={exportHref} className={buttonVariants({ variant: 'outline' })}>
              <Download aria-hidden /> Export CSV
            </a>
          ) : undefined
        }
      />
      <form className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_10rem_10rem_auto]" aria-label="Filters">
        <select name="courseId" defaultValue={data.filters.courseId ?? ''} className={inputClassName} aria-label="Course">
          <option value="">All courses</option>
          {data.options.courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <select name="departmentId" defaultValue={data.filters.departmentId ?? ''} className={inputClassName} aria-label="Department">
          <option value="">All departments</option>
          {data.options.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={data.filters.status ?? ''} className={inputClassName} aria-label="Status">
          <option value="">Any status</option>
          {(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'CANCELLED'] as const).map((s) => (
            <option key={s} value={s}>
              {ENROLLMENT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <input type="date" name="from" defaultValue={data.filters.from ?? ''} className={inputClassName} aria-label="Assigned from" />
        <input type="date" name="to" defaultValue={data.filters.to ?? ''} className={inputClassName} aria-label="Assigned to" />
        <button type="submit" className={buttonVariants({ variant: 'outline' })}>
          Apply
        </button>
      </form>

      <section aria-label="Totals" className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Enrollments" value={totals.enrollments} hint={`${totals.publishedCourses} published courses`} icon={Users} />
        <StatCard label="Completed" value={totals.completed} hint={`${totals.completionRate}% of enrollments`} icon={CheckCircle2} />
        <StatCard
          label="Overdue"
          value={totals.overdue}
          icon={AlertTriangle}
          tone={totals.overdue ? 'attention' : 'default'}
          href="/learning/analytics?status=OVERDUE"
        />
        <StatCard
          label="Quiz attempts"
          value={totals.quizAttempts}
          hint={`${totals.quizPassRate}% passed`}
          icon={BookOpen}
        />
        <StatCard label="Assignments to review" value={totals.pendingReviews} icon={ClipboardCheck} href="/learning/reviews" />
      </section>

      <section className="mb-8 space-y-3">
        <h2 className="text-h2">By course</h2>
        <DataTable
          caption="Learning by course"
          rows={data.courses}
          getRowId={(c) => c.courseId}
          empty={<EmptyState compact title="No enrollments yet" />}
          columns={[
            {
              key: 'course',
              header: 'Course',
              cell: (c) => (
                <Link href={`/learning/analytics?courseId=${c.courseId}`} className="font-medium hover:underline">
                  {c.title}
                </Link>
              ),
            },
            { key: 'enrolled', header: 'Enrolled', cell: (c) => c.enrolled, align: 'right' },
            { key: 'completed', header: 'Completed', cell: (c) => `${c.completed} (${c.completionRate}%)`, align: 'right' },
            { key: 'progress', header: 'Avg. progress', cell: (c) => `${c.averageProgress}%`, align: 'right', hideBelow: 'sm' },
            { key: 'overdue', header: 'Overdue', cell: (c) => c.overdue, align: 'right' },
          ]}
        />
      </section>

      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-h3">Overdue</h2>
          {data.overdueList.length === 0 ? (
            <p className="text-small text-muted-foreground">Nothing is overdue.</p>
          ) : (
            <ul className="divide-y text-small">
              {data.overdueList.map((e) => (
                <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    {fullName(e.user)} · {e.course.title}
                  </span>
                  <span className="text-caption text-destructive">Due {e.due_date ? formatDay(e.due_date) : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 text-h3">Recent completions</h2>
          {data.recentCompletions.length === 0 ? (
            <p className="text-small text-muted-foreground">No completions yet.</p>
          ) : (
            <ul className="divide-y text-small">
              {data.recentCompletions.map((e) => (
                <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    {fullName(e.user)} · {e.course.title}
                  </span>
                  <span className="text-caption text-muted-foreground">{e.completed_at ? formatDay(e.completed_at) : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="text-h2">Enrollments</h2>
        <DataTable
          caption="Enrollments"
          rows={rows}
          getRowId={(r) => r.id}
          empty={<EmptyState compact title="No enrollments match these filters" />}
          columns={[
            { key: 'person', header: 'Person', cell: (r) => fullName(r.user) },
            { key: 'course', header: 'Course', cell: (r) => r.course.title },
            { key: 'type', header: 'Type', cell: (r) => ENROLLMENT_TYPE_LABELS[r.enrollment_type], hideBelow: 'md' },
            { key: 'status', header: 'Status', cell: (r) => <EnrollmentStatusBadge status={r.effectiveStatus} /> },
            { key: 'progress', header: 'Progress', cell: (r) => `${r.progress_percentage}%`, align: 'right' },
            { key: 'due', header: 'Due', cell: (r) => (r.due_date ? formatDay(r.due_date) : '—'), hideBelow: 'sm' },
          ]}
        />
        {rows.length === 200 && <p className="text-caption text-muted-foreground">Showing the first 200 — narrow the filters or export the CSV.</p>}
      </section>
    </>
  )
}
