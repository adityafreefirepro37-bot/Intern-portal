import type { Metadata } from 'next'
import Link from 'next/link'
import { Download } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { Pagination } from '@/components/tables/pagination'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, inputClassName } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { HrNav, MonthNav, SubTabs } from '@/features/hr/components/hr-nav'
import { BalanceForm, LeaveList, LeaveRequestButton } from '@/features/hr/components/leave'
import { LeaveAgenda, LeaveBalances } from '@/features/hr/components/leave-views'
import { hrNavItems } from '@/features/hr/nav'
import { LEAVE_STATUS_LABELS } from '@/lib/hr/leave'
import { formatMonth, monthLabel, shiftMonth } from '@/lib/hr/time'
import { formatDateOnly, todayIn } from '@/lib/interns/dates'
import { firstParam } from '@/lib/validation/list-params'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { leaveService } from '@/server/services/leave.service'

export const metadata: Metadata = { title: 'Leave · HR' }

/** CSV download (an API route, not a page). */
const EXPORT_HREF = '/api/hr/export/leave'

const VIEWS = ['requests', 'calendar', 'balances'] as const

/** Leave across the people in scope: approval queue, calendar and (HR) balances. */
export default async function HrLeavePage({ searchParams }: PageProps<'/hr/leave'>) {
  const ctx = await requirePageContext()
  const scope = authorizationService.scopeOf(ctx, 'leave.read')
  if (!scope || scope === 'OWN') return <AccessDenied what="team leave" />
  const params = await searchParams
  const view = VIEWS.find((v) => v === firstParam(params, 'view')) ?? 'requests'
  const canManage = authorizationService.can(ctx, 'leave.manage')
  const [queue, types, people] = await Promise.all([
    leaveService.queue(ctx, view === 'requests' ? { status: 'PENDING', ...params } : { status: 'PENDING' }),
    leaveService.types(ctx),
    canManage ? leaveService.managedPeople(ctx) : Promise.resolve([]),
  ])
  const today = todayIn(ctx.organization.timezone)
  const canExport = authorizationService.can(ctx, 'leave.export')

  return (
    <>
      <PageHeader
        title={scope === 'ORGANIZATION' ? 'Leave' : 'Team leave'}
        description="Decide requests, see who’s away and manage balances. You can’t approve your own leave."
        actions={
          <>
            {canExport && (
              <a href={EXPORT_HREF} download className={buttonVariants({ variant: 'outline' })}>
                <Download aria-hidden /> Export CSV
              </a>
            )}
            {canManage && people.length > 0 && (
              <LeaveRequestButton
                label="Record leave"
                today={formatDateOnly(today)}
                people={people}
                types={types.map((t) => ({ ...t, remaining: null, unlimited: t.quota_days === null }))}
              />
            )}
          </>
        }
      />
      <HrNav items={hrNavItems(ctx)} active="/hr/leave" />
      <SubTabs
        label="Leave views"
        active={view}
        items={[
          { key: 'requests', href: '/hr/leave', label: 'Requests', count: queue.pending },
          { key: 'calendar', href: '/hr/leave?view=calendar', label: 'Calendar' },
          ...(canManage ? [{ key: 'balances', href: '/hr/leave?view=balances', label: 'Balances' }] : []),
        ]}
      />
      {view === 'requests' && <RequestsView queue={queue} types={types} params={params} />}
      {view === 'calendar' && <CalendarView ctx={ctx} month={firstParam(params, 'month')} />}
      {view === 'balances' && canManage && (
        <BalancesView ctx={ctx} people={people} userId={firstParam(params, 'user')} />
      )}
    </>
  )
}

type Ctx = Awaited<ReturnType<typeof requirePageContext>>
type Queue = Awaited<ReturnType<typeof leaveService.queue>>

function RequestsView({
  queue,
  types,
  params,
}: {
  queue: Queue
  types: { id: string; name: string }[]
  params: Record<string, string | string[] | undefined>
}) {
  const { query, page } = queue
  const linkParams = Object.fromEntries(
    Object.entries(params).flatMap(([k, v]) => (typeof v === 'string' && k !== 'page' ? [[k, v]] : [])),
  )
  return (
    <div className="space-y-4">
      <form method="get" className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-4 sm:grid-cols-5 sm:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="lv-status">Status</Label>
          <select id="lv-status" name="status" defaultValue={query.status ?? ''} className={inputClassName}>
            <option value="">Any</option>
            {Object.entries(LEAVE_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lv-type">Type</Label>
          <select id="lv-type" name="type" defaultValue={query.type ?? ''} className={inputClassName}>
            <option value="">Any</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lv-from">From</Label>
          <Input id="lv-from" name="from" type="date" defaultValue={query.from} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lv-to">To</Label>
          <Input id="lv-to" name="to" type="date" defaultValue={query.to} />
        </div>
        <div className="col-span-2 flex gap-2 sm:col-span-1">
          <Button type="submit">Apply</Button>
          <Link href="/hr/leave?status=" className={buttonVariants({ variant: 'ghost' })}>
            All
          </Link>
        </div>
      </form>
      <LeaveList
        rows={page.items}
        showPerson
        canManage={queue.can.manage}
        highlight={typeof params.highlight === 'string' ? params.highlight : undefined}
        emptyText={
          query.status === 'PENDING' ? 'No requests are waiting for a decision.' : 'No requests match these filters.'
        }
      />
      <Pagination
        pathname="/hr/leave"
        params={linkParams}
        page={page.page}
        totalPages={page.totalPages}
        total={page.total}
        pageSize={page.pageSize}
      />
    </div>
  )
}

async function CalendarView({ ctx, month }: { ctx: Ctx; month?: string }) {
  const calendar = await leaveService.calendar(ctx, month)
  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>Who’s away</CardTitle>
        <MonthNav
          label={monthLabel(calendar.month)}
          prevHref={`/hr/leave?view=calendar&month=${formatMonth(shiftMonth(calendar.month, -1))}`}
          nextHref={`/hr/leave?view=calendar&month=${formatMonth(shiftMonth(calendar.month, 1))}`}
          todayHref="/hr/leave?view=calendar"
        />
      </CardHeader>
      <CardContent>
        <LeaveAgenda start={calendar.start} end={calendar.end} leave={calendar.leave} holidays={calendar.holidays} />
      </CardContent>
    </Card>
  )
}

async function BalancesView({
  ctx,
  people,
  userId,
}: {
  ctx: Ctx
  people: { id: string; name: string }[]
  userId?: string
}) {
  const selected = people.find((p) => p.id === userId)
  const data = selected ? await leaveService.forUser(ctx, selected.id) : null
  return (
    <div className="space-y-4">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="view" value="balances" />
        <div className="grid gap-1.5">
          <Label htmlFor="bal-user">Intern</Label>
          <select id="bal-user" name="user" defaultValue={selected?.id ?? ''} className={inputClassName}>
            <option value="" disabled>
              Choose…
            </option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline">
          Show
        </Button>
      </form>
      {data && selected && (
        <Card>
          <CardHeader>
            <CardTitle>{selected.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <LeaveBalances balances={data.balances} />
            <div className="space-y-3">
              <h3 className="text-label">Adjust allowances</h3>
              {data.balances.map((b) => (
                <BalanceForm key={b.type.id} userId={selected.id} type={b.type} allocated={b.allocated} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
