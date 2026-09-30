import type { Metadata } from 'next'
import Link from 'next/link'
import { Download, UserRoundCheck, Clock, Coffee, Palmtree, UserRoundX, AlarmClock } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { StatCard } from '@/components/common/stat-card'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { UserAvatar } from '@/components/common/user-avatar'
import { DataTable } from '@/components/tables/data-table'
import { Pagination } from '@/components/tables/pagination'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, inputClassName } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AttendanceCalendar, AttendanceDays, AttendanceSummary } from '@/features/hr/components/attendance-calendar'
import { AttendanceEditButton, CorrectionList } from '@/features/hr/components/corrections'
import { HrNav, MonthNav, SubTabs } from '@/features/hr/components/hr-nav'
import { hrNavItems } from '@/features/hr/nav'
import { ATTENDANCE_STATUS_LABELS } from '@/lib/hr/attendance'
import { dayKey, formatDuration, formatMonth, formatTime, monthLabel, shiftMonth } from '@/lib/hr/time'
import { formatDateOnly } from '@/lib/interns/dates'
import { formatDay, fullName } from '@/lib/utils'
import { firstParam } from '@/lib/validation/list-params'
import { requirePageContext } from '@/server/context'
import { attendanceService, CORRECTION_CATEGORY_LABELS } from '@/server/services/attendance.service'
import { authorizationService } from '@/server/services/authorization.service'
import { organizationService } from '@/server/services/content.service'

export const metadata: Metadata = { title: 'Attendance · HR' }

const VIEWS = ['today', 'records', 'corrections', 'person'] as const
type View = (typeof VIEWS)[number]

const STATE_LABELS: Record<string, string> = {
  WORKING: 'Working',
  ON_BREAK: 'On break',
  CHECKED_OUT: 'Checked out',
  NOT_CHECKED_IN: 'Not checked in',
  MISSING: 'Missing check-out',
}

/**
 * Attendance across the interns in the viewer's scope: today's overview,
 * records with filters, corrections to review, and one person's month.
 */
export default async function HrAttendancePage({ searchParams }: PageProps<'/hr/attendance'>) {
  const ctx = await requirePageContext()
  const scope = authorizationService.scopeOf(ctx, 'attendance.read')
  if (!scope || scope === 'OWN') return <AccessDenied what="team attendance" />
  const params = await searchParams
  const view: View = VIEWS.find((v) => v === firstParam(params, 'view')) ?? 'today'
  const tz = ctx.organization.timezone
  const [corrections, people] = await Promise.all([
    attendanceService.pendingCorrections(ctx),
    attendanceService.editablePeople(ctx),
  ])
  const canExport = authorizationService.can(ctx, 'attendance.export')
  const exportQuery = new URLSearchParams(
    Object.entries({
      from: firstParam(params, 'from'),
      to: firstParam(params, 'to'),
      status: firstParam(params, 'status'),
      department: firstParam(params, 'department'),
    }).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ).toString()

  return (
    <>
      <PageHeader
        title={scope === 'ORGANIZATION' ? 'Attendance' : 'Team attendance'}
        description="Check-ins recorded with server time. Absences are only derived for days that have passed."
        actions={
          <>
            {canExport && (
              <a
                href={`/api/hr/export/attendance${exportQuery ? `?${exportQuery}` : ''}`}
                className={buttonVariants({ variant: 'outline' })}
              >
                <Download aria-hidden /> Export CSV
              </a>
            )}
            {people.length > 0 && (
              <AttendanceEditButton
                people={people}
                today={dayKey(new Date())}
                statuses={Object.fromEntries(
                  (['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'ON_LEAVE', 'HOLIDAY'] as const).map((s) => [
                    s,
                    ATTENDANCE_STATUS_LABELS[s],
                  ]),
                )}
                defaultUserId={firstParam(params, 'user')}
              />
            )}
          </>
        }
      />
      <HrNav items={hrNavItems(ctx)} active="/hr/attendance" />
      <SubTabs
        label="Attendance views"
        active={view}
        items={[
          { key: 'today', href: '/hr/attendance', label: 'Today' },
          { key: 'records', href: '/hr/attendance?view=records', label: 'Records' },
          {
            key: 'corrections',
            href: '/hr/attendance?view=corrections',
            label: 'Corrections',
            count: corrections.length,
          },
        ]}
      />
      {view === 'today' && <TodayView ctx={ctx} date={firstParam(params, 'date')} />}
      {view === 'records' && <RecordsView ctx={ctx} params={params} />}
      {view === 'corrections' && (
        <CorrectionList
          items={corrections}
          categories={CORRECTION_CATEGORY_LABELS}
          mode="review"
          highlight={firstParam(params, 'highlight')}
        />
      )}
      {view === 'person' && (
        <PersonView
          ctx={ctx}
          userId={firstParam(params, 'user') ?? ''}
          month={firstParam(params, 'month')}
          timeZone={tz}
        />
      )}
    </>
  )
}

type Ctx = Awaited<ReturnType<typeof requirePageContext>>

async function TodayView({ ctx, date }: { ctx: Ctx; date?: string }) {
  const overview = await attendanceService.overview(ctx, date)
  const tz = ctx.organization.timezone
  type Row = (typeof overview.rows)[number]
  return (
    <div className="space-y-6">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="att-date">Date</Label>
          <Input id="att-date" name="date" type="date" defaultValue={formatDateOnly(overview.date)} className="w-44" />
        </div>
        <Button type="submit" variant="outline">
          Show
        </Button>
        <p className="text-small text-muted-foreground">
          {formatDay(overview.date)}
          {overview.holiday ? ` · Holiday: ${overview.holiday}` : !overview.workingDay ? ' · Not a working day' : ''}
        </p>
      </form>
      <section aria-label="Attendance totals" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          label="Checked in"
          value={`${overview.stats.checkedIn}/${overview.stats.expected}`}
          icon={UserRoundCheck}
        />
        <StatCard
          label="Late"
          value={overview.stats.late}
          icon={AlarmClock}
          tone={overview.stats.late ? 'attention' : 'default'}
        />
        <StatCard label="On break" value={overview.stats.onBreak} icon={Coffee} />
        <StatCard label="On leave" value={overview.stats.onLeave} icon={Palmtree} />
        <StatCard
          label={overview.isToday ? 'Not checked in' : 'Absent'}
          value={overview.stats.notCheckedIn}
          icon={UserRoundX}
          className="col-span-2 lg:col-span-1"
        />
      </section>
      <DataTable<Row>
        caption={`Attendance on ${formatDay(overview.date)}`}
        rows={overview.rows}
        getRowId={(row) => row.intern.id}
        empty={
          <EmptyState
            icon={Clock}
            title="No interns to track"
            description="Interns in onboarding or active appear here."
          />
        }
        columns={[
          {
            key: 'intern',
            header: 'Intern',
            cell: (row) => (
              <div className="flex min-w-44 items-center gap-3">
                <UserAvatar person={row.user} className="size-8" />
                <div className="min-w-0">
                  <Link
                    href={`/hr/attendance?view=person&user=${row.user.id}`}
                    className="block truncate font-medium hover:underline"
                  >
                    {row.name}
                  </Link>
                  <p className="text-caption text-muted-foreground">{row.intern.department ?? row.intern.code}</p>
                </div>
              </div>
            ),
          },
          {
            key: 'state',
            header: 'Status',
            cell: (row) => (
              <div className="flex flex-wrap items-center gap-1.5">
                {row.status ? <StatusBadge status={row.status} label={ATTENDANCE_STATUS_LABELS[row.status]} /> : null}
                {STATE_LABELS[row.state] && row.state !== row.status && (
                  <StatusBadge
                    status={row.state === 'NOT_CHECKED_IN' ? 'PENDING' : row.state}
                    label={STATE_LABELS[row.state]}
                  />
                )}
                {row.leaveType && <span className="text-caption text-muted-foreground">{row.leaveType}</span>}
              </div>
            ),
          },
          { key: 'in', header: 'In', cell: (row) => <span className="tabular">{formatTime(row.checkIn, tz)}</span> },
          { key: 'out', header: 'Out', cell: (row) => <span className="tabular">{formatTime(row.checkOut, tz)}</span> },
          {
            key: 'late',
            header: 'Late by',
            hideBelow: 'md',
            cell: (row) => (row.lateMinutes ? formatDuration(row.lateMinutes) : '—'),
          },
          { key: 'worked', header: 'Worked', hideBelow: 'md', cell: (row) => formatDuration(row.totalMinutes) },
        ]}
      />
    </div>
  )
}

async function RecordsView({ ctx, params }: { ctx: Ctx; params: Record<string, string | string[] | undefined> }) {
  const [{ query, page }, departments] = await Promise.all([
    attendanceService.records(ctx, params),
    organizationService.listDepartments(ctx).catch(() => []),
  ])
  const tz = ctx.organization.timezone
  type Row = (typeof page.items)[number]
  const linkParams = Object.fromEntries(
    Object.entries(params).flatMap(([k, v]) => (typeof v === 'string' && k !== 'page' ? [[k, v]] : [])),
  )
  return (
    <div className="space-y-4">
      <form method="get" className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-4 sm:grid-cols-5 sm:items-end">
        <input type="hidden" name="view" value="records" />
        <div className="grid gap-1.5">
          <Label htmlFor="rec-from">From</Label>
          <Input id="rec-from" name="from" type="date" defaultValue={query.from} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rec-to">To</Label>
          <Input id="rec-to" name="to" type="date" defaultValue={query.to} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rec-status">Status</Label>
          <select id="rec-status" name="status" defaultValue={query.status ?? ''} className={inputClassName}>
            <option value="">Any</option>
            {Object.entries(ATTENDANCE_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rec-dept">Department</Label>
          <select id="rec-dept" name="department" defaultValue={query.department ?? ''} className={inputClassName}>
            <option value="">Any</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2 flex gap-2 sm:col-span-1">
          <Button type="submit">Apply</Button>
          <Link href="/hr/attendance?view=records" className={buttonVariants({ variant: 'ghost' })}>
            Clear
          </Link>
        </div>
      </form>
      <DataTable<Row>
        caption="Attendance records"
        rows={page.items}
        getRowId={(row) => row.id}
        empty={<EmptyState icon={Clock} title="No records match" description="Try a wider date range." />}
        columns={[
          {
            key: 'date',
            header: 'Date',
            cell: (row) => <span className="whitespace-nowrap">{formatDay(row.date)}</span>,
          },
          {
            key: 'who',
            header: 'Intern',
            cell: (row) => (
              <Link
                href={`/hr/attendance?view=person&user=${row.user.id}&month=${formatMonth(row.date)}`}
                className="font-medium hover:underline"
              >
                {fullName(row.user)}
              </Link>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            cell: (row) => (
              <span className="flex items-center gap-1">
                <StatusBadge status={row.effectiveStatus} label={ATTENDANCE_STATUS_LABELS[row.effectiveStatus]} />
                {row.source !== 'SELF' && (
                  <span className="text-caption text-muted-foreground">
                    {row.source === 'HR' ? 'HR edit' : 'corrected'}
                  </span>
                )}
              </span>
            ),
          },
          {
            key: 'in',
            header: 'In',
            cell: (row) => <span className="tabular">{formatTime(row.check_in_at, tz)}</span>,
          },
          {
            key: 'out',
            header: 'Out',
            cell: (row) => <span className="tabular">{formatTime(row.check_out_at, tz)}</span>,
          },
          { key: 'break', header: 'Breaks', hideBelow: 'lg', cell: (row) => formatDuration(row.break_minutes) },
          { key: 'worked', header: 'Worked', hideBelow: 'md', cell: (row) => formatDuration(row.total_minutes) },
        ]}
      />
      <Pagination
        pathname="/hr/attendance"
        params={linkParams}
        page={page.page}
        totalPages={page.totalPages}
        total={page.total}
        pageSize={page.pageSize}
      />
    </div>
  )
}

async function PersonView({
  ctx,
  userId,
  month,
  timeZone,
}: {
  ctx: Ctx
  userId: string
  month?: string
  timeZone: string
}) {
  if (!userId)
    return <EmptyState icon={Clock} title="Choose someone" description="Open a person from Today or Records." />
  const data = await attendanceService.month(ctx, { userId, month })
  const base = `/hr/attendance?view=person&user=${userId}`
  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>{data.personName}</CardTitle>
        <MonthNav
          label={monthLabel(data.month)}
          prevHref={`${base}&month=${formatMonth(shiftMonth(data.month, -1))}`}
          nextHref={`${base}&month=${formatMonth(shiftMonth(data.month, 1))}`}
          todayHref={base}
        />
      </CardHeader>
      <CardContent className="space-y-6">
        <AttendanceSummary summary={data.summary} />
        <AttendanceCalendar days={data.days} caption={`Attendance for ${monthLabel(data.month)}`} />
        <AttendanceDays days={data.days} timeZone={timeZone} />
      </CardContent>
    </Card>
  )
}
