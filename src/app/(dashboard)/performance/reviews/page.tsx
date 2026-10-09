import type { Metadata } from 'next'
import Link from 'next/link'
import { ClipboardList } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { DataTable } from '@/components/tables/data-table'
import { FilterBar } from '@/components/tables/filter-bar'
import { buttonVariants } from '@/components/ui/button'
import { inputClassName } from '@/components/ui/input'
import { StartReviewDialog } from '@/features/performance/components/review-forms'
import { REVIEW_STATUS_LABELS } from '@/lib/performance/rules'
import { cn, formatDay, fullName } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { performanceReviewService } from '@/server/services/performance-review.service'

export const metadata: Metadata = { title: 'Performance reviews' }

export default async function ReviewsPage({ searchParams }: PageProps<'/performance/reviews'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'performance.read')) return <AccessDenied what="performance reviews" />
  const raw = await searchParams
  const params = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]))
  const data = await performanceReviewService.list(ctx, params)
  const start = data.can.start || data.can.manageCycles ? await performanceReviewService.startOptions(ctx) : null

  return (
    <>
      <PageHeader
        title="Performance reviews"
        breadcrumbs={[{ label: 'Performance', href: '/performance' }, { label: 'Reviews' }]}
        description="Structured reviews in stages: self-review, manager, mentor and HR. Each person sees the parts they’re allowed to."
        actions={
          <>
            {data.can.manageCycles && (
              <Link href="/performance/cycles" className={buttonVariants({ variant: 'outline' })}>
                Review cycles
              </Link>
            )}
            {start && (
              <StartReviewDialog
                interns={start.interns.map((i) => ({ id: i.id, name: fullName(i.user) }))}
                templates={start.templates}
              />
            )}
          </>
        }
      />
      <FilterBar
        label="Review stage"
        param="status"
        pathname="/performance/reviews"
        params={params}
        options={[
          { value: 'SELF_REVIEW', label: 'Self-review' },
          { value: 'MANAGER_REVIEW', label: 'Manager review' },
          { value: 'MENTOR_REVIEW', label: 'Mentor review' },
          { value: 'HR_REVIEW', label: 'HR review' },
          { value: 'COMPLETED', label: 'Completed' },
          { value: 'OVERDUE', label: 'Overdue' },
        ]}
      />
      {data.cycles.length > 0 && (
        <form className="mb-4 flex flex-wrap gap-2" aria-label="More filters">
          {params.status && <input type="hidden" name="status" value={params.status} />}
          <select name="cycleId" defaultValue={params.cycleId ?? ''} className={cn(inputClassName, 'w-56')} aria-label="Cycle">
            <option value="">All cycles</option>
            {data.cycles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input name="q" defaultValue={params.q ?? ''} placeholder="Intern or cycle" className={cn(inputClassName, 'w-56')} aria-label="Search reviews" />
          <button type="submit" className={buttonVariants({ variant: 'outline' })}>
            Apply
          </button>
        </form>
      )}
      <DataTable
        caption="Performance reviews"
        rows={data.reviews}
        getRowId={(r) => r.id}
        empty={<EmptyState icon={ClipboardList} title="No reviews" description="Reviews appear here when a cycle opens or a review is started." />}
        columns={[
          {
            key: 'intern',
            header: 'Intern',
            cell: (r) => (
              <Link href={`/performance/reviews/${r.id}`} className="font-medium hover:underline">
                {fullName(r.intern.user)}
              </Link>
            ),
          },
          { key: 'cycle', header: 'Cycle', cell: (r) => r.cycle?.name ?? 'Ad hoc', hideBelow: 'sm' },
          {
            key: 'stage',
            header: 'Stage',
            cell: (r) => (
              <span className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={r.status} label={REVIEW_STATUS_LABELS[r.status]} />
                {r.myTurn && <span className="text-caption font-medium text-primary">Your turn</span>}
                {r.overdue && <StatusBadge status="OVERDUE" label="Overdue" />}
              </span>
            ),
          },
          { key: 'manager', header: 'Manager', cell: (r) => fullName(r.reviewer), hideBelow: 'md' },
          { key: 'due', header: 'Due', cell: (r) => (r.due_date ? formatDay(r.due_date) : '—'), hideBelow: 'sm' },
        ]}
      />
    </>
  )
}
