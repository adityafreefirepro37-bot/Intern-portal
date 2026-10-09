import type { Metadata } from 'next'
import { Download } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { StatCard } from '@/components/common/stat-card'
import { AccessDenied } from '@/components/common/states'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { inputClassName } from '@/components/ui/input'
import { CountBars } from '@/features/learning/components/learning-ui'
import { FEEDBACK_TYPE_LABELS } from '@/lib/performance/rules'
import { cn, formatDay } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { performanceDashboardService } from '@/server/services/performance-dashboard.service'

export const metadata: Metadata = { title: 'Performance analytics' }

export default async function PerformanceAnalyticsPage({ searchParams }: PageProps<'/performance/analytics'>) {
  const ctx = await requirePageContext()
  if (authorizationService.scopeOf(ctx, 'performance.read') !== 'ORGANIZATION') return <AccessDenied what="performance analytics" />
  const raw = await searchParams
  const query = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : (v ?? '')]))
  const data = await performanceDashboardService.hrSummary(ctx, query)
  const exportHref = `/api/performance/export?${new URLSearchParams(Object.entries(query).filter(([, v]) => v) as [string, string][]).toString()}`
  const totalReviews = data.reviewsByStatus.reduce((s, r) => s + r.value, 0)
  const completed = data.reviewsByStatus.find((r) => r.status === 'COMPLETED')?.value ?? 0

  return (
    <>
      <PageHeader
        title="Performance analytics"
        breadcrumbs={[{ label: 'Performance', href: '/performance' }, { label: 'Analytics' }]}
        description="Workflow and activity counts. No scores, rankings or comparisons between people."
        actions={
          data.can.export ? (
            <a href={exportHref} className={buttonVariants({ variant: 'outline' })}>
              <Download aria-hidden /> Export reviews (CSV)
            </a>
          ) : undefined
        }
      />
      <form className="mb-6 flex flex-wrap gap-2" aria-label="Filters">
        <select name="departmentId" defaultValue={data.filters.departmentId ?? ''} className={cn(inputClassName, 'w-56')} aria-label="Department">
          <option value="">All departments</option>
          {data.options.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select name="cycleId" defaultValue={data.filters.cycleId ?? ''} className={cn(inputClassName, 'w-56')} aria-label="Cycle">
          <option value="">All cycles</option>
          {data.options.cycles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="submit" className={buttonVariants({ variant: 'outline' })}>
          Apply
        </button>
      </form>
      <section className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Interns in the programme" value={data.trackedInterns} />
        <StatCard label="Reviews" value={totalReviews} hint={`${completed} completed`} href="/performance/reviews" />
        <StatCard
          label="Overdue reviews"
          value={data.overdueReviews}
          tone={data.overdueReviews ? 'attention' : 'default'}
          href="/performance/reviews?status=OVERDUE"
        />
        <StatCard label="Active development plans" value={data.plansActive} />
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-h3">Reviews by stage</h2>
          <CountBars label="Reviews by stage" items={data.reviewsByStatus} />
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 text-h3">Goals by status</h2>
          <CountBars label="Goals by status" items={data.goalsByStatus} />
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 text-h3">Check-ins submitted per week</h2>
          <CountBars
            label="Check-ins per week"
            items={data.checkinsByWeek.map((w) => ({ label: `Week of ${formatDay(w.week)}`, value: w.submitted }))}
          />
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 text-h3">Feedback in the last 30 days</h2>
          <CountBars
            label="Feedback by type"
            items={data.feedbackLast30.map((f) => ({ label: FEEDBACK_TYPE_LABELS[f.type], value: f.value }))}
          />
        </Card>
      </div>
    </>
  )
}
