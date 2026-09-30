import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MonthNav } from '@/features/hr/components/hr-nav'
import { LeaveList, LeaveRequestButton } from '@/features/hr/components/leave'
import { LeaveAgenda, LeaveBalances } from '@/features/hr/components/leave-views'
import { formatMonth, monthLabel, shiftMonth } from '@/lib/hr/time'
import { formatDateOnly } from '@/lib/interns/dates'
import { firstParam } from '@/lib/validation/list-params'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { leaveService } from '@/server/services/leave.service'

export const metadata: Metadata = { title: 'Leave' }

/** Personal leave: balances, requests and the month's leave and holidays. Reviewers use /hr/leave. */
export default async function LeavePage({ searchParams }: PageProps<'/leave'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'leave.request')) {
    const scope = authorizationService.scopeOf(ctx, 'leave.read')
    if (scope && scope !== 'OWN') redirect('/hr/leave')
    return <AccessDenied what="leave" />
  }
  const params = await searchParams
  const [mine, calendar] = await Promise.all([
    leaveService.mine(ctx),
    leaveService.calendar(ctx, firstParam(params, 'month'), true),
  ])
  const types = mine.balances.map((b) => ({
    id: b.type.id,
    name: b.type.name,
    requires_attachment: b.type.requires_attachment,
    remaining: b.remaining,
    unlimited: b.unlimited,
  }))

  return (
    <>
      <PageHeader
        title="Leave"
        description="Request time off and track your balance. Weekends and holidays are never counted."
        actions={mine.canRequest && <LeaveRequestButton types={types} today={formatDateOnly(mine.today)} />}
      />
      <div className="space-y-6">
        <section aria-labelledby="balance-title" className="space-y-3">
          <h2 id="balance-title" className="text-h3">
            Balance
          </h2>
          <LeaveBalances balances={mine.balances} />
        </section>
        <section aria-labelledby="requests-title" className="space-y-3">
          <h2 id="requests-title" className="text-h3">
            Your requests
          </h2>
          <LeaveList rows={mine.requests} showPerson={false} highlight={firstParam(params, 'highlight')} />
        </section>
        <Card>
          <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Calendar</CardTitle>
            <MonthNav
              label={monthLabel(calendar.month)}
              prevHref={`/leave?month=${formatMonth(shiftMonth(calendar.month, -1))}`}
              nextHref={`/leave?month=${formatMonth(shiftMonth(calendar.month, 1))}`}
              todayHref="/leave"
            />
          </CardHeader>
          <CardContent>
            <LeaveAgenda
              start={calendar.start}
              end={calendar.end}
              leave={calendar.leave}
              holidays={calendar.holidays}
            />
          </CardContent>
        </Card>
      </div>
    </>
  )
}
