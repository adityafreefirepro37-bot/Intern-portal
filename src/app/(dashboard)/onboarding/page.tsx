import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Ban, CheckCircle2, ClipboardList, LayoutTemplate, OctagonAlert, Timer } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { StatCard } from '@/components/common/stat-card'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { UserAvatar } from '@/components/common/user-avatar'
import { DataTable } from '@/components/tables/data-table'
import { buttonVariants } from '@/components/ui/button'
import { Progress } from '@/components/ui/misc'
import { formatDay, fullName } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { internService } from '@/server/services/intern.service'
import { onboardingService } from '@/server/services/onboarding.service'

export const metadata: Metadata = { title: 'Onboarding' }

const STATES = ['IN_PROGRESS', 'OVERDUE', 'BLOCKED', 'COMPLETED'] as const
const STATE_LABELS: Record<(typeof STATES)[number], string> = {
  IN_PROGRESS: 'In progress',
  OVERDUE: 'Overdue',
  BLOCKED: 'Blocked',
  COMPLETED: 'Completed',
}

/** HR onboarding dashboard. Interns are sent to their own checklist. */
export default async function OnboardingPage({ searchParams }: PageProps<'/onboarding'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'onboarding.manage')) {
    const internId = await internService.myInternId(ctx)
    if (internId) redirect(`/interns/${internId}/onboarding`)
    return <AccessDenied what="onboarding" />
  }

  const { stats, rows, truncated } = await onboardingService.dashboard(ctx)
  const requested = (await searchParams).state
  const state = STATES.find((s) => s === requested)
  const visible = state ? rows.filter((row) => row.state === state) : rows.filter((row) => row.state !== 'COMPLETED')
  type Row = (typeof rows)[number]

  return (
    <>
      <PageHeader
        title="Onboarding"
        description="Checklists for new interns. Completing onboarding doesn’t activate an intern — you confirm that from their profile."
        actions={
          <Link href="/onboarding/templates" className={buttonVariants({ variant: 'outline' })}>
            <LayoutTemplate aria-hidden /> Templates
          </Link>
        }
      />
      <section aria-label="Onboarding totals" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          label="Total onboarding"
          value={stats.total}
          icon={ClipboardList}
          hint={`${stats.completionRate}% completed`}
          className="col-span-2 lg:col-span-1"
        />
        <StatCard label="In progress" value={stats.inProgress} icon={Timer} href="/onboarding" />
        <StatCard
          label="Overdue"
          value={stats.overdue}
          icon={OctagonAlert}
          href="/onboarding?state=OVERDUE"
          tone={stats.overdue > 0 ? 'attention' : 'default'}
        />
        <StatCard label="Blocked" value={stats.blocked} icon={Ban} href="/onboarding?state=BLOCKED" tone={stats.blocked > 0 ? 'attention' : 'default'} />
        <StatCard label="Completed" value={stats.completed} icon={CheckCircle2} href="/onboarding?state=COMPLETED" />
      </section>

      <nav aria-label="Filter onboarding" className="mb-4 flex flex-wrap gap-2">
        <Link href="/onboarding" aria-current={!state ? 'page' : undefined} className={buttonVariants({ variant: !state ? 'default' : 'outline', size: 'sm' })}>
          Open
        </Link>
        {STATES.map((s) => (
          <Link
            key={s}
            href={`/onboarding?state=${s}`}
            aria-current={state === s ? 'page' : undefined}
            className={buttonVariants({ variant: state === s ? 'default' : 'outline', size: 'sm' })}
          >
            {STATE_LABELS[s]}
          </Link>
        ))}
      </nav>

      <DataTable<Row>
        caption="Onboarding checklists"
        rows={visible}
        getRowId={(row) => row.id}
        empty={
          <EmptyState
            icon={ClipboardList}
            title={state ? `Nothing ${STATE_LABELS[state].toLowerCase()}` : 'No onboarding in progress'}
            description="Checklists appear when an intern moves to Onboarding."
          />
        }
        columns={[
          {
            key: 'intern',
            header: 'Intern',
            cell: (row) => {
              const intern = row.internship.intern
              return (
                <div className="flex min-w-48 items-center gap-3">
                  <UserAvatar person={intern.user} className="size-8" />
                  <div className="min-w-0">
                    <Link href={`/interns/${intern.id}/onboarding`} className="block truncate font-medium hover:underline">
                      {fullName(intern.user)}
                    </Link>
                    <p className="text-caption text-muted-foreground">{intern.employee_code}</p>
                  </div>
                </div>
              )
            },
          },
          {
            key: 'progress',
            header: 'Required items',
            cell: (row) => (
              <div className="min-w-36 space-y-1">
                <Progress value={row.progress.percent} label={`${row.progress.percent}% of required items done`} />
                <p className="text-caption text-muted-foreground">
                  {row.progress.requiredDone}/{row.progress.requiredTotal}
                  {row.progress.overdue > 0 && <span className="text-destructive"> · {row.progress.overdue} overdue</span>}
                </p>
              </div>
            ),
          },
          { key: 'state', header: 'State', cell: (row) => <StatusBadge status={row.state === 'OVERDUE' ? 'LATE' : row.state} /> },
          { key: 'template', header: 'Template', hideBelow: 'md', cell: (row) => row.template_name ?? '—' },
          { key: 'intern-status', header: 'Intern status', hideBelow: 'lg', cell: (row) => <StatusBadge status={row.internship.intern.status} /> },
          { key: 'start', header: 'Start date', hideBelow: 'lg', cell: (row) => formatDay(row.internship.start_date) },
          { key: 'due', header: 'Due date', hideBelow: 'md', cell: (row) => (row.lastDue ? formatDay(row.lastDue) : '—') },
          {
            key: 'completed',
            header: 'Completed',
            hideBelow: 'lg',
            cell: (row) => (row.completed_at ? formatDay(row.completed_at) : <span className="text-muted-foreground">Not yet</span>),
          },
        ]}
      />
      {truncated && (
        <p className="mt-3 text-caption text-muted-foreground">
          Showing the {rows.length} most recent checklists. The totals above include all of them.
        </p>
      )}
    </>
  )
}
