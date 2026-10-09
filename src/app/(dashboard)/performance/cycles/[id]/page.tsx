import type { Metadata } from 'next'
import Link from 'next/link'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { DataTable } from '@/components/tables/data-table'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/misc'
import { ConfirmActionButton } from '@/features/learning/components/confirm-action'
import { CycleDialog } from '@/features/performance/components/setup-forms'
import { formatDateOnly } from '@/lib/interns/dates'
import { CYCLE_STATUS_LABELS, CYCLE_TYPE_LABELS, REVIEW_STATUS_LABELS } from '@/lib/performance/rules'
import { formatDay, fullName } from '@/lib/utils'
import { cycleStatusAction, openCycleAction } from '@/server/actions/performance'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { learningService } from '@/server/services/learning.service'
import { performanceReviewService } from '@/server/services/performance-review.service'

export const metadata: Metadata = { title: 'Review cycle' }

export default async function CyclePage({ params }: PageProps<'/performance/cycles/[id]'>) {
  const ctx = await requirePageContext()
  if (authorizationService.scopeOf(ctx, 'performance_cycle.manage') !== 'ORGANIZATION') return <AccessDenied what="review cycles" />
  const { id } = await params
  const { cycle, reviews } = await performanceReviewService.cycle(ctx, id)
  const completed = reviews.filter((r) => r.status === 'COMPLETED').length
  const editing =
    cycle.status === 'DRAFT'
      ? await Promise.all([performanceReviewService.activeTemplates(ctx), learningService.authoringOptions(ctx).catch(() => null)])
      : null

  return (
    <>
      <PageHeader
        title={cycle.name}
        breadcrumbs={[
          { label: 'Performance', href: '/performance' },
          { label: 'Review cycles', href: '/performance/cycles' },
          { label: cycle.name },
        ]}
        description={`${CYCLE_TYPE_LABELS[cycle.cycle_type]} · ${formatDay(cycle.start_date)} – ${formatDay(cycle.due_date)} · ${cycle.template.name}${
          cycle.department ? ` · ${cycle.department.name}` : ''
        }`}
        actions={
          <>
            <StatusBadge status={cycle.status} label={CYCLE_STATUS_LABELS[cycle.status]} />
            {editing && (
              <CycleDialog
                cycle={{ ...cycle, start_date: formatDateOnly(cycle.start_date), due_date: formatDateOnly(cycle.due_date) }}
                templates={editing[0]}
                departments={editing[1]?.departments ?? []}
              />
            )}
            {cycle.status === 'DRAFT' && (
              <ConfirmActionButton
                action={openCycleAction}
                fields={{ cycleId: cycle.id }}
                title="Open this cycle?"
                description="A review is created for every intern in the programme who has a manager, and the first stage is notified. Settings can’t be changed afterwards."
                confirmLabel="Open cycle"
              >
                Open cycle
              </ConfirmActionButton>
            )}
            {cycle.status === 'OPEN' && (
              <ConfirmActionButton
                action={cycleStatusAction}
                fields={{ cycleId: cycle.id, status: 'IN_REVIEW' }}
                title="Move to in review?"
                description="Marks the cycle as being finalized. Reviews continue as before."
                variant="outline"
              >
                Mark in review
              </ConfirmActionButton>
            )}
            {(cycle.status === 'OPEN' || cycle.status === 'IN_REVIEW') && (
              <ConfirmActionButton
                action={cycleStatusAction}
                fields={{ cycleId: cycle.id, status: 'COMPLETED' }}
                title="Close this cycle?"
                description="Only possible when every review in it is completed."
                variant="outline"
              >
                Close cycle
              </ConfirmActionButton>
            )}
            {cycle.status === 'COMPLETED' && (
              <ConfirmActionButton
                action={cycleStatusAction}
                fields={{ cycleId: cycle.id, status: 'ARCHIVED' }}
                title="Archive this cycle?"
                description="The reviews stay available on each intern’s record."
                variant="outline"
              >
                Archive
              </ConfirmActionButton>
            )}
          </>
        }
      />
      {cycle.status !== 'DRAFT' && (
        <Card className="mb-6 space-y-2 p-5">
          <div className="flex justify-between text-small">
            <span>Completed reviews</span>
            <span className="tabular font-medium">
              {completed} of {reviews.length}
            </span>
          </div>
          <Progress value={reviews.length ? (completed / reviews.length) * 100 : 0} label="Cycle completion" />
        </Card>
      )}
      <DataTable
        caption="Reviews in this cycle"
        rows={reviews}
        getRowId={(r) => r.id}
        empty={
          <EmptyState
            compact
            title={cycle.status === 'DRAFT' ? 'Not opened yet' : 'No reviews'}
            description={cycle.status === 'DRAFT' ? 'Reviews are created when you open the cycle.' : 'No interns matched this cycle.'}
          />
        }
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
          {
            key: 'stage',
            header: 'Stage',
            cell: (r) => (
              <span className="flex flex-wrap gap-1.5">
                <StatusBadge status={r.status} label={REVIEW_STATUS_LABELS[r.status]} />
                {r.overdue && <StatusBadge status="OVERDUE" label="Overdue" />}
              </span>
            ),
          },
          { key: 'manager', header: 'Manager', cell: (r) => fullName(r.reviewer), hideBelow: 'sm' },
          { key: 'mentor', header: 'Mentor', cell: (r) => (r.mentor ? fullName(r.mentor) : '—'), hideBelow: 'md' },
          { key: 'done', header: 'Completed', cell: (r) => (r.completed_at ? formatDay(r.completed_at) : '—'), hideBelow: 'sm' },
        ]}
      />
    </>
  )
}
