import type { Metadata } from 'next'
import Link from 'next/link'
import { CalendarRange } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { DataTable } from '@/components/tables/data-table'
import { CycleDialog } from '@/features/performance/components/setup-forms'
import { CYCLE_STATUS_LABELS, CYCLE_TYPE_LABELS } from '@/lib/performance/rules'
import { formatDay } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { learningService } from '@/server/services/learning.service'
import { performanceReviewService } from '@/server/services/performance-review.service'

export const metadata: Metadata = { title: 'Review cycles' }

export default async function CyclesPage() {
  const ctx = await requirePageContext()
  if (authorizationService.scopeOf(ctx, 'performance_cycle.manage') !== 'ORGANIZATION') return <AccessDenied what="review cycles" />
  const [cycles, templates, options] = await Promise.all([
    performanceReviewService.cycles(ctx),
    performanceReviewService.activeTemplates(ctx),
    learningService.authoringOptions(ctx).catch(() => null),
  ])

  return (
    <>
      <PageHeader
        title="Review cycles"
        breadcrumbs={[{ label: 'Performance', href: '/performance' }, { label: 'Review cycles' }]}
        description="A cycle creates one review per intern, all using the same template and stages."
        actions={<CycleDialog templates={templates} departments={options?.departments ?? []} />}
      />
      {templates.length === 0 && (
        <p className="mb-4 text-small text-muted-foreground">
          Create a review template with questions first —{' '}
          <Link href="/performance/templates" className="text-primary hover:underline">
            templates
          </Link>
          .
        </p>
      )}
      <DataTable
        caption="Review cycles"
        rows={cycles}
        getRowId={(c) => c.id}
        empty={<EmptyState icon={CalendarRange} title="No review cycles yet" description="Create a mid-point or final review cycle." />}
        columns={[
          {
            key: 'name',
            header: 'Cycle',
            cell: (c) => (
              <Link href={`/performance/cycles/${c.id}`} className="font-medium hover:underline">
                {c.name}
              </Link>
            ),
          },
          { key: 'type', header: 'Type', cell: (c) => CYCLE_TYPE_LABELS[c.cycle_type], hideBelow: 'sm' },
          { key: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.status} label={CYCLE_STATUS_LABELS[c.status]} /> },
          { key: 'progress', header: 'Completed', cell: (c) => `${c.completed}/${c.reviews}`, align: 'right' },
          { key: 'due', header: 'Due', cell: (c) => formatDay(c.due_date), hideBelow: 'sm' },
          { key: 'template', header: 'Template', cell: (c) => c.template.name, hideBelow: 'md' },
        ]}
      />
    </>
  )
}
