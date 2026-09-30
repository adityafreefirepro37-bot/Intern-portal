import type { LeaveStatus } from '@prisma/client'
import { dayKey } from './time'

/** Leave rules (pure). */

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
}

/** Requests that hold days (count against balance and block overlaps). */
export const ACTIVE_LEAVE: readonly LeaveStatus[] = ['PENDING', 'APPROVED']

/**
 * Working days in [start, end] — weekends (per the working-day rule) and
 * organization holidays are excluded.
 */
export function workingDaysBetween(
  start: Date,
  end: Date,
  options: { workingDays: readonly number[]; holidays: ReadonlySet<string> },
): number {
  if (end < start) return 0
  let days = 0
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    const date = new Date(t)
    if (options.workingDays.includes(date.getUTCDay()) && !options.holidays.has(dayKey(date))) days++
  }
  return days
}

/** Inclusive date ranges overlap. */
export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart <= bEnd && bStart <= aEnd
}

export interface LeaveBalanceView {
  /** null = unlimited (tracked, not capped). */
  allocated: number | null
  used: number
  pending: number
  remaining: number | null
  unlimited: boolean
}

export function leaveBalance(input: { allocated: number | null; used: number; pending: number }): LeaveBalanceView {
  const unlimited = input.allocated === null
  return {
    allocated: input.allocated,
    used: input.used,
    pending: input.pending,
    remaining: unlimited ? null : Math.max(0, (input.allocated ?? 0) - input.used - input.pending),
    unlimited,
  }
}

/**
 * Who may cancel: the requester while PENDING, or APPROVED leave that hasn't
 * started; HR (leave.manage) any PENDING/APPROVED request.
 */
export function canCancelLeave(input: {
  status: LeaveStatus
  startDate: Date
  today: Date
  isRequester: boolean
  canManage: boolean
}): boolean {
  if (input.status !== 'PENDING' && input.status !== 'APPROVED') return false
  if (input.canManage) return true
  if (!input.isRequester) return false
  return input.status === 'PENDING' || input.startDate > input.today
}

/** Reviewers decide PENDING requests only, and never their own. */
export function canReviewLeave(input: { status: LeaveStatus; isRequester: boolean }): boolean {
  return input.status === 'PENDING' && !input.isRequester
}
