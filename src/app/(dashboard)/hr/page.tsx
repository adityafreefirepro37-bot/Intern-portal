import type { Metadata } from 'next'
import Link from 'next/link'
import {
  CalendarCheck2,
  CalendarClock,
  CircleCheckBig,
  ClipboardList,
  Clock,
  FileClock,
  Palmtree,
  UserPlus,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { StatCard } from '@/components/common/stat-card'
import { AccessDenied } from '@/components/common/states'
import { UserAvatar } from '@/components/common/user-avatar'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { HrNav } from '@/features/hr/components/hr-nav'
import { hrNavItems } from '@/features/hr/nav'
import { cn, formatDay, fullName } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { hrDashboardService, type HrOverview } from '@/server/services/hr-dashboard.service'

export const metadata: Metadata = { title: 'HR Dashboard' }

type Row = HrOverview['lists']['recent'][number]

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

const TONE_LABEL = { urgent: 'Needs action', attention: 'Check', info: 'FYI' } as const

/** HR home: programme KPIs, the action centre (everything waiting on HR) and today's picture. */
export default async function HrDashboardPage() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'hr_dashboard.read')) return <AccessDenied what="the HR dashboard" />
  const data = await hrDashboardService.overview(ctx)
  const { lists } = data
  const { kpis } = data
  const canCreate = authorizationService.can(ctx, 'intern.create')

  return (
    <>
      <PageHeader
        title="HR Dashboard"
        description="The internship programme at a glance, and everything waiting on HR."
        actions={
          canCreate && (
            <Link href="/interns/new" className={buttonVariants()}>
              <UserPlus aria-hidden /> Add intern
            </Link>
          )
        }
      />
      <HrNav items={hrNavItems(ctx)} active="/hr" />

      <section aria-label="Programme figures" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total interns" value={kpis.total} icon={UsersRound} href="/interns" />
        <StatCard label="Active" value={kpis.active} icon={UserRoundCheck} href="/interns?status=ACTIVE" />
        <StatCard label="Onboarding" value={kpis.onboarding} icon={ClipboardList} href="/onboarding" />
        <StatCard
          label="Ending soon"
          value={kpis.endingSoon}
          hint={`Within ${data.endingDays} days`}
          icon={CalendarClock}
          href="/hr/offboarding"
          tone={kpis.endingSoon ? 'attention' : 'default'}
        />
        <StatCard
          label="Completed this month"
          value={kpis.completedThisMonth}
          icon={CircleCheckBig}
          href="/interns?status=COMPLETED"
        />
        {kpis.pendingDocuments !== null && (
          <StatCard
            label="Documents to verify"
            value={kpis.pendingDocuments}
            icon={FileClock}
            href="/hr/documents?status=PENDING"
            tone={kpis.pendingDocuments ? 'attention' : 'default'}
          />
        )}
        {kpis.pendingLeave !== null && (
          <StatCard
            label="Leave requests pending"
            value={kpis.pendingLeave}
            icon={Palmtree}
            href="/hr/leave"
            tone={kpis.pendingLeave ? 'attention' : 'default'}
          />
        )}
        {kpis.attendanceIssues !== null && (
          <StatCard
            label="Attendance issues"
            value={kpis.attendanceIssues}
            hint="Missing check-outs + corrections"
            icon={Clock}
            href="/hr/attendance?view=corrections"
            tone={kpis.attendanceIssues ? 'attention' : 'default'}
          />
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Requires attention</CardTitle>
            <CardDescription>Everything waiting on HR, most urgent first.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.actions.length === 0 ? (
              <p className="py-6 text-center text-small text-muted-foreground">Nothing needs attention right now.</p>
            ) : (
              <ul className="divide-y">
                {[...data.actions]
                  .sort(
                    (a, b) =>
                      ['urgent', 'attention', 'info'].indexOf(a.tone) - ['urgent', 'attention', 'info'].indexOf(b.tone),
                  )
                  .map((item) => (
                    <li key={item.key}>
                      <Link href={item.href} className="flex items-center gap-3 py-3 hover:bg-muted/40">
                        <span
                          className={cn(
                            'tabular flex h-8 min-w-10 items-center justify-center rounded-md px-2 text-small font-semibold',
                            item.tone === 'urgent'
                              ? 'bg-destructive/10 text-destructive'
                              : item.tone === 'attention'
                                ? 'bg-warning/14 text-warning'
                                : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {item.count}
                        </span>
                        <span className="min-w-0 flex-1 text-small">{item.label}</span>
                        <span className="hidden text-caption text-muted-foreground sm:inline">
                          {TONE_LABEL[item.tone]}
                        </span>
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          {data.today && (
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <CardTitle>Today</CardTitle>
                <Link href="/hr/attendance" className="text-small font-medium text-primary hover:underline">
                  Attendance
                </Link>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-3 text-small">
                  <div>
                    <dt className="text-caption text-muted-foreground">Checked in</dt>
                    <dd className="tabular text-h3">
                      {data.today.checkedIn}/{data.today.expected}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-caption text-muted-foreground">Late</dt>
                    <dd className="tabular text-h3">{data.today.late}</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-muted-foreground">On leave</dt>
                    <dd className="tabular text-h3">{data.today.onLeave}</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-muted-foreground">Not checked in</dt>
                    <dd className="tabular text-h3">{data.today.notCheckedIn}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarCheck2 className="size-4 text-primary" aria-hidden /> Upcoming holidays
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.holidays.length === 0 ? (
                <p className="text-small text-muted-foreground">No holidays scheduled.</p>
              ) : (
                <ul className="space-y-2 text-small">
                  {data.holidays.map((h) => (
                    <li key={h.id} className="flex justify-between gap-3">
                      <span>
                        {h.name}
                        {h.is_optional && <span className="text-muted-foreground"> (optional)</span>}
                      </span>
                      <span className="whitespace-nowrap text-muted-foreground">{formatDay(h.date)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Ending soon</CardTitle>
            <CardDescription>Plan handovers, letters and certificates.</CardDescription>
          </CardHeader>
          <CardContent>
            <InternList
              rows={lists.endingSoon}
              empty="No internships ending soon."
              meta={(row) => `Ends ${formatDay(row.expected_end_date)}`}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Upcoming joiners</CardTitle>
          </CardHeader>
          <CardContent>
            <InternList
              rows={lists.joining}
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
              rows={lists.recent}
              empty="No interns yet."
              meta={(row) => `${row.employee_code} · ${row.department?.name ?? 'No department'}`}
            />
          </CardContent>
        </Card>
      </div>
    </>
  )
}
