'use client'

import * as React from 'react'
import { Coffee, LogIn, LogOut, Play } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ATTENDANCE_STATUS_LABELS } from '@/lib/hr/attendance'
import { formatDuration, formatTime } from '@/lib/hr/time'
import { checkInAction, checkOutAction, endBreakAction, startBreakAction } from '@/server/actions/hr'
import { ActionButton } from './action-form'

interface TodayView {
  date: Date
  record: {
    status: keyof typeof ATTENDANCE_STATUS_LABELS
    check_in_at: Date | null
    check_out_at: Date | null
    total_minutes: number | null
    break_minutes: number
    late_minutes: number | null
    breaks: { id: string; started_at: Date; ended_at: Date | null }[]
  } | null
  rules: { workStart: string; graceMinutes: number }
  holiday: string | null
  onLeave: string | null
  workingDay: boolean
  openBreak: { started_at: Date } | null
  can: { checkIn: boolean; checkOut: boolean; startBreak: boolean; endBreak: boolean }
}

/** Minutes worked so far (ticks each minute while checked in; breaks excluded). */
function useElapsed(record: TodayView['record']) {
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    // First tick right after mount (the server can't know the browser's "now"), then every 30 s.
    const first = setTimeout(() => setNow(Date.now()), 0)
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [])
  if (!record?.check_in_at || record.check_out_at || now === null) return null
  const breaks = record.breaks.reduce(
    (sum, b) => sum + ((b.ended_at ? new Date(b.ended_at).getTime() : now) - new Date(b.started_at).getTime()),
    0,
  )
  return Math.max(0, Math.floor((now - new Date(record.check_in_at).getTime() - breaks) / 60_000))
}

/** Today's check-in card. Times shown are server timestamps in the organization timezone. */
export function AttendanceToday({ today, timeZone }: { today: TodayView; timeZone: string }) {
  const { record } = today
  const elapsed = useElapsed(record)
  const note = today.onLeave
    ? `You’re on approved leave today (${today.onLeave}).`
    : today.holiday
      ? `Today is a holiday: ${today.holiday}. You can still check in if you’re working.`
      : !today.workingDay
        ? 'Today isn’t a working day. You can still check in if you’re working.'
        : `Work starts at ${today.rules.workStart}; check-ins after ${today.rules.graceMinutes} minutes count as late.`

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>Today</CardTitle>
          <CardDescription>{note}</CardDescription>
        </div>
        {record && (
          <StatusBadge
            status={record.status}
            label={
              record.check_out_at
                ? ATTENDANCE_STATUS_LABELS[record.status]
                : today.openBreak
                  ? 'On break'
                  : 'Checked in'
            }
          />
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-caption text-muted-foreground">Checked in</dt>
            <dd className="tabular text-h3">{formatTime(record?.check_in_at, timeZone)}</dd>
            {record?.late_minutes ? (
              <dd className="text-caption text-warning">{formatDuration(record.late_minutes)} after start</dd>
            ) : null}
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">Checked out</dt>
            <dd className="tabular text-h3">{formatTime(record?.check_out_at, timeZone)}</dd>
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">Breaks</dt>
            <dd className="tabular text-h3">{record ? formatDuration(record.break_minutes) : '—'}</dd>
            {today.openBreak && (
              <dd className="text-caption text-muted-foreground">
                since {formatTime(today.openBreak.started_at, timeZone)}
              </dd>
            )}
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">Worked</dt>
            <dd className="tabular text-h3" aria-live="off">
              {record?.check_out_at
                ? formatDuration(record.total_minutes)
                : elapsed !== null
                  ? formatDuration(elapsed)
                  : '—'}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          {today.can.checkIn && (
            <ActionButton action={checkInAction} fields={{}} pendingLabel="Checking in…">
              <LogIn aria-hidden /> Check in
            </ActionButton>
          )}
          {today.can.startBreak && (
            <ActionButton action={startBreakAction} fields={{}} variant="outline">
              <Coffee aria-hidden /> Start break
            </ActionButton>
          )}
          {today.can.endBreak && (
            <ActionButton action={endBreakAction} fields={{}} variant="outline">
              <Play aria-hidden /> End break
            </ActionButton>
          )}
          {today.can.checkOut && (
            <ActionButton
              action={checkOutAction}
              fields={{}}
              variant={today.can.endBreak ? 'outline' : 'default'}
              pendingLabel="Checking out…"
            >
              <LogOut aria-hidden /> Check out
            </ActionButton>
          )}
          {record?.check_out_at && (
            <p className="text-small text-muted-foreground">
              You’re done for today. Something wrong? Request a correction below.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
