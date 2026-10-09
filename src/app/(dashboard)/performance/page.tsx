import type { Metadata } from 'next'
import Link from 'next/link'
import { CalendarCheck, ClipboardList, Gauge, MessageSquareHeart, Target } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { StatCard } from '@/components/common/stat-card'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/misc'
import { CountBars } from '@/features/learning/components/learning-ui'
import { FEEDBACK_TYPE_LABELS, GOAL_STATUS_LABELS, REVIEW_STATUS_LABELS } from '@/lib/performance/rules'
import { formatDay, fullName, pluralize } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { performanceDashboardService } from '@/server/services/performance-dashboard.service'

export const metadata: Metadata = { title: 'Performance' }

export default async function PerformancePage() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'performance.read')) return <AccessDenied what="performance records" />
  const data = await performanceDashboardService.overview(ctx)
  const manage = {
    cycles: authorizationService.scopeOf(ctx, 'performance_cycle.manage') === 'ORGANIZATION',
    templates: authorizationService.scopeOf(ctx, 'performance_template.manage') === 'ORGANIZATION',
  }

  return (
    <>
      <PageHeader
        title="Performance"
        description="Goals, weekly check-ins, feedback and reviews. Everything here is written by people and links to the work behind it — nobody is ranked or scored automatically."
        actions={
          <>
            {manage.templates && (
              <Link href="/performance/templates" className={buttonVariants({ variant: 'outline' })}>
                Templates
              </Link>
            )}
            {manage.cycles && (
              <Link href="/performance/cycles" className={buttonVariants({ variant: 'outline' })}>
                Review cycles
              </Link>
            )}
            {data.hr && (
              <Link href="/performance/analytics" className={buttonVariants()}>
                Analytics
              </Link>
            )}
          </>
        }
      />

      {data.intern && (
        <div className="space-y-6">
          <section aria-label="This week" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="This week’s check-in"
              value={data.intern.checkin.status ? data.intern.checkin.status.charAt(0) + data.intern.checkin.status.slice(1).toLowerCase() : 'Not started'}
              icon={CalendarCheck}
              href="/performance/checkins"
              tone={data.intern.checkin.status && data.intern.checkin.status !== 'DRAFT' ? 'default' : 'attention'}
            />
            <StatCard label="Active goals" value={data.intern.goals.length} icon={Target} href="/performance/goals" />
            <StatCard
              label="Reviews waiting for you"
              value={data.intern.reviews.filter((r) => r.myTurn).length}
              icon={ClipboardList}
              href="/performance/reviews"
            />
            <StatCard
              label="Open feedback requests"
              value={data.intern.openRequests}
              icon={MessageSquareHeart}
              href="/performance/feedback?view=requests"
            />
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-h3">Your goals</h2>
                <Link href="/performance/goals" className="text-small text-primary hover:underline">
                  All goals
                </Link>
              </div>
              {data.intern.goals.length === 0 ? (
                <EmptyState compact icon={Target} title="No active goals" description="Set a goal with your manager or mentor." />
              ) : (
                <ul className="space-y-3">
                  {data.intern.goals.map((g) => (
                    <li key={g.id} className="space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-small">
                        <Link href={`/performance/goals/${g.id}`} className="font-medium hover:underline">
                          {g.title}
                        </Link>
                        <StatusBadge status={g.status} label={GOAL_STATUS_LABELS[g.status]} />
                      </div>
                      <Progress value={g.progress} label={`${g.title} progress`} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-h3">Recent feedback</h2>
                <Link href="/performance/feedback" className="text-small text-primary hover:underline">
                  All feedback
                </Link>
              </div>
              {data.intern.feedback.length === 0 ? (
                <p className="text-small text-muted-foreground">No feedback shared with you yet.</p>
              ) : (
                <ul className="space-y-3">
                  {data.intern.feedback.map((f) => (
                    <li key={f.id} className="text-small">
                      <p className="line-clamp-3">{f.body}</p>
                      <p className="mt-1 text-caption text-muted-foreground">
                        {FEEDBACK_TYPE_LABELS[f.feedback_type]} · {fullName(f.from_user)} · {formatDay(f.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card className="p-5">
              <h2 className="mb-3 text-h3">Your reviews</h2>
              {data.intern.reviews.length === 0 ? (
                <p className="text-small text-muted-foreground">No reviews yet.</p>
              ) : (
                <ul className="divide-y text-small">
                  {data.intern.reviews.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <Link href={`/performance/reviews/${r.id}`} className="font-medium hover:underline">
                        {r.cycle?.name ?? 'Performance review'}
                      </Link>
                      <span className="flex items-center gap-2">
                        {r.myTurn && <span className="text-caption font-medium text-primary">Your self-review is open</span>}
                        <StatusBadge status={r.status} label={REVIEW_STATUS_LABELS[r.status]} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card className="p-5">
              <h2 className="mb-3 text-h3">Development plans</h2>
              {data.intern.plans.length === 0 ? (
                <p className="text-small text-muted-foreground">No development plans yet.</p>
              ) : (
                <ul className="space-y-3">
                  {data.intern.plans.map((p) => (
                    <li key={p.id} className="space-y-1.5 text-small">
                      <Link href={`/performance/development/${p.id}`} className="font-medium hover:underline">
                        {p.title}
                      </Link>
                      <Progress value={p.total ? (p.done / p.total) * 100 : 0} label={`${p.title} progress`} />
                      <p className="text-caption text-muted-foreground">
                        {p.done} of {pluralize(p.total, 'item')} done
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
          <div>
            <Link href={`/interns/${data.intern.internId}?tab=performance`} className="text-small text-primary hover:underline">
              See your full performance record and timeline →
            </Link>
          </div>
        </div>
      )}

      {data.team && (
        <div className="space-y-6">
          <h2 className="text-h2">{data.hr ? 'Needs attention' : 'Your interns'}</h2>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {data.team.metrics.map((m) => (
              <StatCard key={m.label} label={m.label} value={m.value} href={m.href ?? undefined} tone={m.value ? 'attention' : 'default'} />
            ))}
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="mb-3 text-h3">Reviews waiting for you</h3>
              {data.team.myTurnReviews.length === 0 ? (
                <p className="text-small text-muted-foreground">Nothing waiting for you.</p>
              ) : (
                <ul className="divide-y text-small">
                  {data.team.myTurnReviews.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <Link href={`/performance/reviews/${r.id}`} className="font-medium hover:underline">
                        {fullName(r.intern.user)} · {r.cycle?.name ?? 'Review'}
                      </Link>
                      <span className="flex items-center gap-2">
                        {r.overdue && <StatusBadge status="OVERDUE" label="Overdue" />}
                        <StatusBadge status={r.status} label={REVIEW_STATUS_LABELS[r.status]} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {data.team.weekStatus && (
              <Card className="p-5">
                <h3 className="mb-1 text-h3">Check-ins this week</h3>
                <p className="mb-3 text-caption text-muted-foreground">Week of {formatDay(data.team.weekStatus.weekStart)}</p>
                <CountBars
                  label="Check-in status this week"
                  items={[
                    { label: 'Submitted', value: data.team.weekStatus.submitted, href: '/performance/checkins?status=SUBMITTED' },
                    { label: 'Reviewed', value: data.team.weekStatus.reviewed, href: '/performance/checkins?status=REVIEWED' },
                    { label: 'Not yet submitted', value: data.team.weekStatus.missing },
                  ]}
                />
              </Card>
            )}
          </div>
        </div>
      )}

      {data.hr && (
        <div className="mt-8 space-y-6">
          <h2 className="text-h2">Organization</h2>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Interns in the programme" value={data.hr.trackedInterns} icon={Gauge} />
            <StatCard
              label="Overdue reviews"
              value={data.hr.overdueReviews}
              icon={ClipboardList}
              href="/performance/reviews?status=OVERDUE"
              tone={data.hr.overdueReviews ? 'attention' : 'default'}
            />
            <StatCard label="Active development plans" value={data.hr.plansActive} icon={Target} />
            <StatCard
              label="Feedback (last 30 days)"
              value={data.hr.feedbackLast30.reduce((s, f) => s + f.value, 0)}
              icon={MessageSquareHeart}
            />
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="mb-3 text-h3">Review cycles</h3>
              {data.hr.cycles.length === 0 ? (
                <p className="text-small text-muted-foreground">No open cycles.</p>
              ) : (
                <ul className="space-y-3">
                  {data.hr.cycles.map((c) => (
                    <li key={c.id} className="space-y-1.5 text-small">
                      <div className="flex flex-wrap justify-between gap-2">
                        <Link href={`/performance/cycles/${c.id}`} className="font-medium hover:underline">
                          {c.name}
                        </Link>
                        <span className="text-caption text-muted-foreground">
                          {c.completed}/{c.total} completed · due {formatDay(c.due_date)}
                        </span>
                      </div>
                      <Progress value={c.total ? (c.completed / c.total) * 100 : 0} label={`${c.name} completion`} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card className="p-5">
              <h3 className="mb-3 text-h3">Reviews by stage</h3>
              <CountBars label="Reviews by stage" items={data.hr.reviewsByStatus} />
            </Card>
          </div>
        </div>
      )}
    </>
  )
}
