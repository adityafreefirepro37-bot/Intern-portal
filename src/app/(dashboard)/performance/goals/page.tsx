import type { Metadata } from 'next'
import { Target } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { FilterBar } from '@/components/tables/filter-bar'
import { inputClassName } from '@/components/ui/input'
import { buttonVariants } from '@/components/ui/button'
import { GoalDialog } from '@/features/performance/components/performance-forms'
import { GoalCards } from '@/features/performance/components/performance-views'
import { GOAL_CATEGORY_LABELS, GOAL_STATUS_LABELS } from '@/lib/performance/rules'
import { fullName } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { goalService } from '@/server/services/goal.service'

export const metadata: Metadata = { title: 'Goals' }

export default async function GoalsPage({ searchParams }: PageProps<'/performance/goals'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'goal.read')) return <AccessDenied what="goals" />
  const raw = await searchParams
  const params = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]))
  const data = await goalService.list(ctx, params)
  const staff = data.interns.length > 0
  const internOptions = data.interns.map((i) => ({ id: i.id, name: fullName(i.user) }))

  return (
    <>
      <PageHeader
        title="Goals"
        breadcrumbs={[{ label: 'Performance', href: '/performance' }, { label: 'Goals' }]}
        description="Development goals with progress set in 25% steps and linked evidence."
        actions={data.can.create ? <GoalDialog interns={staff ? internOptions : undefined} /> : undefined}
      />
      <FilterBar
        label="Goal status"
        param="status"
        pathname="/performance/goals"
        params={params}
        options={Object.entries(GOAL_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
      />
      <form className="mb-4 flex flex-wrap gap-2" aria-label="More filters">
        {params.status && <input type="hidden" name="status" value={params.status} />}
        <select name="category" defaultValue={params.category ?? ''} className={`${inputClassName} w-48`} aria-label="Category">
          <option value="">All categories</option>
          {Object.entries(GOAL_CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {staff && (
          <select name="internId" defaultValue={params.internId ?? ''} className={`${inputClassName} w-56`} aria-label="Intern">
            <option value="">All interns</option>
            {internOptions.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        )}
        <input name="q" defaultValue={params.q ?? ''} placeholder="Search goals" className={`${inputClassName} w-56`} aria-label="Search goals" />
        <button type="submit" className={buttonVariants({ variant: 'outline' })}>
          Apply
        </button>
      </form>
      {data.goals.length === 0 ? (
        <EmptyState icon={Target} title="No goals found" description="Goals set for you or your interns appear here." />
      ) : (
        <GoalCards goals={data.goals} showIntern={staff} />
      )}
    </>
  )
}
