import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AttendanceCalendar, AttendanceDays, AttendanceSummary } from '@/features/hr/components/attendance-calendar'
import { AttendanceToday } from '@/features/hr/components/attendance-today'
import { CorrectionList, CorrectionRequestButton } from '@/features/hr/components/corrections'
import { MonthNav } from '@/features/hr/components/hr-nav'
import { formatMonth, monthLabel, shiftMonth } from '@/lib/hr/time'
import { addDays, formatDateOnly } from '@/lib/interns/dates'
import { firstParam } from '@/lib/validation/list-params'
import { requirePageContext } from '@/server/context'
import { attendanceService, CORRECTION_CATEGORY_LABELS } from '@/server/services/attendance.service'
import { authorizationService } from '@/server/services/authorization.service'

export const metadata: Metadata = { title: 'Attendance' }

/**
 * Personal attendance: check in/out with server timestamps, breaks, the month
 * calendar and correction requests. People who oversee others' attendance
 * (and don't record their own) are sent to the HR attendance view.
 */
export default async function AttendancePage({ searchParams }: PageProps<'/attendance'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'attendance.create')) {
    const scope = authorizationService.scopeOf(ctx, 'attendance.read')
    if (scope && scope !== 'OWN') redirect('/hr/attendance')
    return <AccessDenied what="attendance" />
  }
  const params = await searchParams
  const [today, month] = await Promise.all([
    attendanceService.today(ctx),
    attendanceService.month(ctx, { month: firstParam(params, 'month') }),
  ])
  const tz = ctx.organization.timezone
  const todayKey = formatDateOnly(today.date)

  return (
    <>
      <PageHeader title="Attendance" description="Your check-ins, breaks and monthly record." />
      <div className="space-y-6">
        <AttendanceToday today={today} timeZone={tz} />

        <Card>
          <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <CardTitle>Monthly record</CardTitle>
              <CardDescription>Absences are only counted for days that have passed.</CardDescription>
            </div>
            <MonthNav
              label={monthLabel(month.month)}
              prevHref={`/attendance?month=${formatMonth(shiftMonth(month.month, -1))}`}
              nextHref={`/attendance?month=${formatMonth(shiftMonth(month.month, 1))}`}
              todayHref="/attendance"
            />
          </CardHeader>
          <CardContent className="space-y-6">
            <AttendanceSummary summary={month.summary} />
            <AttendanceCalendar days={month.days} caption={`Attendance for ${monthLabel(month.month)}`} />
            <AttendanceDays days={month.days} timeZone={tz} />
          </CardContent>
        </Card>

        <section aria-labelledby="corrections-title" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="corrections-title" className="text-h3">
              Corrections
            </h2>
            {authorizationService.can(ctx, 'attendance_correction.request') && (
              <CorrectionRequestButton
                categories={CORRECTION_CATEGORY_LABELS}
                today={todayKey}
                minDate={formatDateOnly(addDays(today.date, -30))}
              />
            )}
          </div>
          <CorrectionList
            items={month.corrections}
            categories={CORRECTION_CATEGORY_LABELS}
            mode="own"
            highlight={firstParam(params, 'highlight')}
          />
        </section>
      </div>
    </>
  )
}
