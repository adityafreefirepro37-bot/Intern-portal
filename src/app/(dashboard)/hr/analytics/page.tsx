import type { Metadata } from 'next'
import { Download } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { HrNav } from '@/features/hr/components/hr-nav'
import { hrNavItems } from '@/features/hr/nav'
import { ONBOARDING_BUCKET_LABELS, type OnboardingBucket } from '@/lib/hr/operations'
import { formatDate, humanizeEnum } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { hrDashboardService } from '@/server/services/hr-dashboard.service'

export const metadata: Metadata = { title: 'HR analytics' }

/** CSV download (an API route, not a page). */
const EXPORT_HREF = '/api/hr/export/analytics'

/** Horizontal bars with the value printed as text (never colour-only). */
function Bars({ items, unit = '' }: { items: { label: string; value: number }[]; unit?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  if (items.length === 0) return <p className="text-small text-muted-foreground">No data yet.</p>
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.label} className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-3 text-small">
          <span className="truncate">{item.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span className="block h-full rounded-full bg-primary" style={{ width: `${(item.value / max) * 100}%` }} />
          </span>
          <span className="tabular text-right font-medium">
            {item.value}
            {unit}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Figure({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="tabular text-h2">{value}</dd>
      {hint && <dd className="text-caption text-muted-foreground">{hint}</dd>}
    </div>
  )
}

/** Factual HR metrics: counts and ratios of stored records. No predictions or scores. */
export default async function HrAnalyticsPage() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'analytics.read') || !authorizationService.can(ctx, 'hr_dashboard.read')) {
    return <AccessDenied what="HR analytics" />
  }
  const data = await hrDashboardService.analytics(ctx)
  const show = (v: number | null, unit = '') => (v === null ? '—' : `${v}${unit}`)
  return (
    <>
      <PageHeader
        title="HR analytics"
        description={`Counts and ratios from recorded data, as of ${formatDate(data.generatedAt, ctx.organization.timezone)}.`}
        actions={
          authorizationService.can(ctx, 'analytics.export') && (
            <a href={EXPORT_HREF} download className={buttonVariants({ variant: 'outline' })}>
              <Download aria-hidden /> Export CSV
            </a>
          )
        }
      />
      <HrNav items={hrNavItems(ctx)} active="/hr/analytics" />
      <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure
          label="Attendance rate (30 days)"
          value={show(data.attendance.averageRate, '%')}
          hint={`Average across ${data.attendance.measured} interns`}
        />
        <Figure label="Late arrivals (30 days)" value={data.attendance.lateArrivals30d} />
        <Figure
          label="Required documents verified"
          value={show(data.documents.averageCompletion, '%')}
          hint={`${data.documents.fullyComplete} of ${data.documents.tracked} interns complete`}
        />
        <Figure
          label="HR request resolution"
          value={show(data.requests.averageResolutionDays, ' days')}
          hint="Average, resolved requests"
        />
      </dl>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Interns by status</CardTitle>
          </CardHeader>
          <CardContent>
            <Bars items={data.interns.byStatus.map((i) => ({ ...i, label: humanizeEnum(i.label) }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Current interns by department</CardTitle>
          </CardHeader>
          <CardContent>
            <Bars items={data.interns.byDepartment} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Joiners by month</CardTitle>
            <CardDescription>Last six months</CardDescription>
          </CardHeader>
          <CardContent>
            <Bars items={data.interns.joinersByMonth} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Onboarding progress</CardTitle>
            <CardDescription>
              Average time to complete: {show(data.onboarding.averageDaysToComplete, ' days')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Bars
              items={data.onboarding.buckets.map((b) => ({
                label: ONBOARDING_BUCKET_LABELS[b.label as OnboardingBucket],
                value: b.value,
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Approved leave this year</CardTitle>
            <CardDescription>Working days by type</CardDescription>
          </CardHeader>
          <CardContent>
            <Bars items={data.leave.approvedDaysByType} unit=" d" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Leave requests this year</CardTitle>
          </CardHeader>
          <CardContent>
            <Bars items={data.leave.byStatus.map((i) => ({ ...i, label: humanizeEnum(i.label) }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Documents by status</CardTitle>
            <CardDescription>Current versions only</CardDescription>
          </CardHeader>
          <CardContent>
            <Bars items={data.documents.byStatus.map((i) => ({ ...i, label: humanizeEnum(i.label) }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>HR requests by category</CardTitle>
          </CardHeader>
          <CardContent>
            <Bars items={data.requests.byCategory} />
          </CardContent>
        </Card>
      </div>
    </>
  )
}
