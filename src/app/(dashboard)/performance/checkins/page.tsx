import type { Metadata } from 'next'
import Link from 'next/link'
import { CalendarCheck } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { DataTable } from '@/components/tables/data-table'
import { FilterBar } from '@/components/tables/filter-bar'
import { Card } from '@/components/ui/card'
import { CheckinForm } from '@/features/performance/components/performance-forms'
import { formatDateOnly } from '@/lib/interns/dates'
import { CHECKIN_QUESTIONS, CHECKIN_STATUS_LABELS } from '@/lib/performance/rules'
import { formatDay, fullName } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { checkinService } from '@/server/services/checkin.service'
import { ownIntern } from '@/server/services/performance-access'

export const metadata: Metadata = { title: 'Weekly check-ins' }

export default async function CheckinsPage({ searchParams }: PageProps<'/performance/checkins'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'checkin.read')) return <AccessDenied what="weekly check-ins" />
  const raw = await searchParams
  const params = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]))
  const isIntern = authorizationService.can(ctx, 'checkin.create') && Boolean(await ownIntern(ctx))

  if (isIntern) return <Mine />
  const data = await checkinService.list(ctx, params)
  return (
    <>
      <PageHeader
        title="Weekly check-ins"
        breadcrumbs={[{ label: 'Performance', href: '/performance' }, { label: 'Check-ins' }]}
        description="Submitted check-ins from your interns. Drafts stay private to the intern."
      />
      <FilterBar
        label="Check-in status"
        param="status"
        pathname="/performance/checkins"
        params={params}
        options={[
          { value: 'SUBMITTED', label: 'Waiting for review' },
          { value: 'REVIEWED', label: 'Reviewed' },
        ]}
      />
      <DataTable
        caption="Weekly check-ins"
        rows={data.checkins}
        getRowId={(c) => c.id}
        empty={<EmptyState icon={CalendarCheck} title="No check-ins yet" description="Interns submit a check-in each week." />}
        columns={[
          {
            key: 'week',
            header: 'Week of',
            cell: (c) => (
              <Link href={`/performance/checkins/${c.id}`} className="font-medium hover:underline">
                {formatDay(c.week_start)}
              </Link>
            ),
          },
          { key: 'intern', header: 'Intern', cell: (c) => fullName(c.intern.user) },
          { key: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.status} label={CHECKIN_STATUS_LABELS[c.status]} /> },
          {
            key: 'blockers',
            header: 'Blockers / support',
            hideBelow: 'md',
            cell: (c) => (
              <span className="line-clamp-1 text-muted-foreground">{[c.blockers, c.support_needed].filter(Boolean).join(' · ') || '—'}</span>
            ),
          },
          { key: 'submitted', header: 'Submitted', cell: (c) => (c.submitted_at ? formatDay(c.submitted_at) : '—'), hideBelow: 'sm' },
        ]}
      />
    </>
  )
}

/** Only the six answers go to the form (nothing else about the record). */
function answers(checkin: Partial<Record<(typeof CHECKIN_QUESTIONS)[number]['key'], string | null>> | null) {
  return Object.fromEntries(CHECKIN_QUESTIONS.map((q) => [q.key, checkin?.[q.key] ?? null]))
}

async function Mine() {
  const ctx = await requirePageContext()
  const data = await checkinService.mine(ctx)
  const thisWeekOpen = !data.thisWeek || data.thisWeek.status === 'DRAFT'
  return (
    <>
      <PageHeader
        title="Weekly check-in"
        breadcrumbs={[{ label: 'Performance', href: '/performance' }, { label: 'Check-ins' }]}
        description="A few minutes each week: what you did, what you learned, and what you need. Your manager and mentor read it once you submit."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {thisWeekOpen ? (
            <Card className="p-5">
              <h2 className="mb-3 text-h3">This week</h2>
              <CheckinForm
                weekStart={formatDateOnly(data.weekStart)}
                weekLabel={formatDay(data.weekStart)}
                values={answers(data.thisWeek)}
              />
            </Card>
          ) : (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
              <p className="text-small">
                This week’s check-in is <StatusBadge status={data.thisWeek!.status} label={CHECKIN_STATUS_LABELS[data.thisWeek!.status]} />
              </p>
              <Link href={`/performance/checkins/${data.thisWeek!.id}`} className="text-small text-primary hover:underline">
                View it
              </Link>
            </Card>
          )}
          {data.catchUpWeek && (
            <Card className="p-5">
              <h2 className="mb-1 text-h3">Last week</h2>
              <p className="mb-3 text-small text-muted-foreground">You didn’t submit last week’s check-in. You can still catch up.</p>
              <CheckinForm
                weekStart={formatDateOnly(data.catchUpWeek)}
                weekLabel={formatDay(data.catchUpWeek)}
                values={answers(data.lastWeekDraft)}
              />
            </Card>
          )}
        </div>
        <aside>
          <Card className="p-5">
            <h2 className="mb-3 text-h3">History</h2>
            {data.history.length === 0 ? (
              <p className="text-small text-muted-foreground">No submitted check-ins yet.</p>
            ) : (
              <ul className="divide-y text-small">
                {data.history.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/performance/checkins/${c.id}`} className="hover:underline">
                      Week of {formatDay(c.week_start)}
                    </Link>
                    <StatusBadge status={c.status} label={CHECKIN_STATUS_LABELS[c.status]} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </>
  )
}
