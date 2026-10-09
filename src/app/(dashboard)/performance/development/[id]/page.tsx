import type { Metadata } from 'next'
import Link from 'next/link'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState } from '@/components/common/states'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/misc'
import { ConfirmActionButton } from '@/features/learning/components/confirm-action'
import { PlanItemDialog, PlanItemStatusDialog } from '@/features/performance/components/setup-forms'
import { formatDateOnly } from '@/lib/interns/dates'
import { DEVELOPMENT_ITEM_STATUS_LABELS, DEVELOPMENT_PLAN_STATUS_LABELS } from '@/lib/performance/rules'
import { formatDay, fullName, pluralize } from '@/lib/utils'
import { developmentPlanStatusAction } from '@/server/actions/performance'
import { requirePageContext } from '@/server/context'
import { developmentPlanService } from '@/server/services/development-plan.service'

export const metadata: Metadata = { title: 'Development plan' }

export default async function DevelopmentPlanPage({ params }: PageProps<'/performance/development/[id]'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  const { plan, relation, options, can } = await developmentPlanService.get(ctx, id)
  const counted = plan.items.filter((i) => i.status !== 'CANCELLED')
  const done = counted.filter((i) => i.status === 'COMPLETED').length
  const owners = options.owners.map((o) => ({ id: o.id, name: fullName(o) }))

  return (
    <>
      <PageHeader
        title={plan.title}
        breadcrumbs={[{ label: 'Performance', href: '/performance' }, { label: 'Development plan' }]}
        description={
          <>
            {relation.isSelf ? 'Your development plan' : `For ${fullName(plan.intern.user)}`}
            {plan.review ? (
              <>
                {' · from '}
                <Link href={`/performance/reviews/${plan.review.id}`} className="underline">
                  {plan.review.cycle?.name ?? 'a performance review'}
                </Link>
              </>
            ) : null}
          </>
        }
        actions={
          <>
            <StatusBadge status={plan.status} label={DEVELOPMENT_PLAN_STATUS_LABELS[plan.status]} />
            {can.edit && plan.status === 'ACTIVE' && <PlanItemDialog planId={plan.id} owners={owners} courses={options.courses} goals={options.goals} />}
            {can.edit && plan.status === 'ACTIVE' && (
              <ConfirmActionButton
                action={developmentPlanStatusAction}
                fields={{ planId: plan.id, status: 'COMPLETED' }}
                title="Mark this plan complete?"
                description="The plan is closed; items can no longer be updated."
                variant="outline"
              >
                Complete plan
              </ConfirmActionButton>
            )}
            {can.edit && plan.status !== 'ACTIVE' && (
              <ConfirmActionButton
                action={developmentPlanStatusAction}
                fields={{ planId: plan.id, status: 'ACTIVE' }}
                title="Reopen this plan?"
                description="Items can be updated again."
                variant="outline"
              >
                Reopen
              </ConfirmActionButton>
            )}
          </>
        }
      />
      <Card className="mb-6 space-y-2 p-5">
        <div className="flex justify-between text-small">
          <span>Progress</span>
          <span className="tabular font-medium">
            {done} of {pluralize(counted.length, 'item')} done
          </span>
        </div>
        <Progress value={counted.length ? (done / counted.length) * 100 : 0} label="Development plan progress" />
      </Card>
      {plan.items.length === 0 ? (
        <EmptyState compact title="No focus areas yet" description={can.edit ? 'Add the first focus area and action.' : 'Your manager or mentor adds the focus areas.'} />
      ) : (
        <ol className="grid gap-3">
          {plan.items.map((item) => (
            <li key={item.id}>
              <Card className="space-y-2 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="min-w-0 flex-1 text-h3">{item.area}</h2>
                  <StatusBadge status={item.status} label={DEVELOPMENT_ITEM_STATUS_LABELS[item.status]} />
                  {item.canUpdate && <PlanItemStatusDialog item={item} allowCancel={can.edit} />}
                  {can.edit && plan.status === 'ACTIVE' && (
                    <PlanItemDialog
                      planId={plan.id}
                      owners={owners}
                      courses={options.courses}
                      goals={options.goals}
                      item={{
                        id: item.id,
                        area: item.area,
                        action: item.action,
                        owner_id: item.owner_id,
                        target_date: item.target_date ? formatDateOnly(item.target_date) : null,
                        course_id: item.course?.id ?? null,
                        goal_id: item.goal?.id ?? null,
                      }}
                    />
                  )}
                </div>
                <p className="whitespace-pre-line text-small">{item.action}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground">
                  {item.owner && <span>Owner: {fullName(item.owner)}</span>}
                  {item.target_date && <span>Target: {formatDay(item.target_date)}</span>}
                  {item.course && (
                    <Link href={`/learning/courses/${item.course.id}`} className="text-primary hover:underline">
                      Course: {item.course.title}
                    </Link>
                  )}
                  {item.goal && (
                    <Link href={`/performance/goals/${item.goal.id}`} className="text-primary hover:underline">
                      Goal: {item.goal.title}
                    </Link>
                  )}
                </div>
                {item.evidence && <p className="rounded-md bg-muted/60 p-2 text-small">Evidence: {item.evidence}</p>}
              </Card>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}
