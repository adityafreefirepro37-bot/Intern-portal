import type { Metadata } from 'next'
import Link from 'next/link'
import {
  CalendarClock,
  ClipboardList,
  LayoutTemplate,
  OctagonAlert,
  UserPlus,
  UserRoundCheck,
  UserRoundX,
  UsersRound,
} from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { StatCard } from '@/components/common/stat-card'
import { AccessDenied } from '@/components/common/states'
import { UserAvatar } from '@/components/common/user-avatar'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDay, fullName } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { internService } from '@/server/services/intern.service'
import { onboardingService } from '@/server/services/onboarding.service'

export const metadata: Metadata = { title: 'HR Dashboard' }

type Row = Awaited<ReturnType<typeof internService.hrOverview>>['recent'][number]

function InternList({ rows, empty, meta }: { rows: Row[]; empty: string; meta: (row: Row) => string }) {
  if (rows.length === 0) return <p className="py-4 text-center text-small text-muted-foreground">{empty}</p>
  return (
    <ul className="divide-y">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center gap-3 py-2.5">
          <UserAvatar person={row.user} className="size-8" />
          <div className="min-w-0 flex-1">
            <Link href={`/interns/${row.id}`} className="block truncate text-small font-medium hover:underline">
              {fullName(row.user)}
            </Link>
            <p className="truncate text-caption text-muted-foreground">{meta(row)}</p>
          </div>
          <StatusBadge status={row.status} />
        </li>
      ))}
    </ul>
  )
}

export default async function HrDashboardPage() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'intern.create')) return <AccessDenied what="the HR dashboard" />
  const canOnboarding = authorizationService.can(ctx, 'onboarding.manage')
  const [overview, onboarding] = await Promise.all([
    internService.hrOverview(ctx),
    canOnboarding ? onboardingService.dashboard(ctx) : Promise.resolve(null),
  ])
  const count = (status: string) => overview.byStatus[status as keyof typeof overview.byStatus] ?? 0
  const attention = onboarding?.rows.filter((row) => row.state === 'OVERDUE' || row.state === 'BLOCKED').slice(0, 6) ?? []

  return (
    <>
      <PageHeader
        title="HR Dashboard"
        description="The internship programme at a glance."
        actions={
          <>
            <Link href="/interns/new" className={buttonVariants()}>
              <UserPlus aria-hidden /> Add intern
            </Link>
            {canOnboarding && (
              <Link href="/onboarding/templates" className={buttonVariants({ variant: 'outline' })}>
                <LayoutTemplate aria-hidden /> Templates
              </Link>
            )}
          </>
        }
      />

      <section aria-label="Programme totals" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Active" value={count('ACTIVE')} icon={UserRoundCheck} href="/interns?status=ACTIVE" />
        <StatCard label="Onboarding" value={count('ONBOARDING')} icon={ClipboardList} href="/interns?status=ONBOARDING" />
        <StatCard label="Selected" value={count('SELECTED')} icon={UsersRound} href="/interns?status=SELECTED" hint="Not yet onboarding" />
        <StatCard
          label="Ending soon"
          value={count('ENDING_SOON')}
          icon={CalendarClock}
          href="/interns?status=ENDING_SOON"
          tone={count('ENDING_SOON') > 0 ? 'attention' : 'default'}
        />
        <StatCard
          label="Missing manager/mentor"
          value={overview.unassigned}
          icon={UserRoundX}
          tone={overview.unassigned > 0 ? 'attention' : 'default'}
          className="col-span-2 lg:col-span-1"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {onboarding && (
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <OctagonAlert className="size-4 text-warning" aria-hidden /> Onboarding needing attention
                </CardTitle>
                <CardDescription>
                  {onboarding.stats.inProgress} in progress · {onboarding.stats.overdue} overdue · {onboarding.stats.blocked} blocked
                </CardDescription>
              </div>
              <Link href="/onboarding" className="shrink-0 text-small font-medium text-primary hover:underline">
                All
              </Link>
            </CardHeader>
            <CardContent>
              {attention.length === 0 ? (
                <p className="py-4 text-center text-small text-muted-foreground">Nothing overdue or blocked.</p>
              ) : (
                <ul className="divide-y">
                  {attention.map((row) => (
                    <li key={row.id} className="flex items-center gap-3 py-2.5">
                      <UserAvatar person={row.internship.intern.user} className="size-8" />
                      <div className="min-w-0 flex-1">
                        <Link href={`/interns/${row.internship.intern.id}/onboarding`} className="block truncate text-small font-medium hover:underline">
                          {fullName(row.internship.intern.user)}
                        </Link>
                        <p className="text-caption text-muted-foreground">
                          {row.progress.requiredDone}/{row.progress.requiredTotal} required
                          {row.progress.overdue > 0 && ` · ${row.progress.overdue} overdue`}
                          {row.progress.blocked > 0 && ` · ${row.progress.blocked} blocked`}
                        </p>
                      </div>
                      <StatusBadge status={row.state === 'OVERDUE' ? 'LATE' : row.state} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Ending soon</CardTitle>
            <CardDescription>Plan completion letters and certificates.</CardDescription>
          </CardHeader>
          <CardContent>
            <InternList rows={overview.endingSoon} empty="No internships ending soon." meta={(row) => `Ends ${formatDay(row.expected_end_date)}`} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming joiners</CardTitle>
          </CardHeader>
          <CardContent>
            <InternList
              rows={overview.joining}
              empty="No upcoming start dates."
              meta={(row) => `Joins ${formatDay(row.joining_date)} · ${row.position?.title ?? 'Intern'}`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <CardTitle>Recently added</CardTitle>
            <Link href="/interns?sort=created&dir=desc" className="text-small font-medium text-primary hover:underline">
              Directory
            </Link>
          </CardHeader>
          <CardContent>
            <InternList
              rows={overview.recent}
              empty="No interns yet."
              meta={(row) => `${row.employee_code} · ${row.department?.name ?? 'No department'}`}
            />
          </CardContent>
        </Card>
      </div>
    </>
  )
}
