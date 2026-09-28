import type { InternStatus, OnboardingItemStatus } from '@prisma/client'
import { daysBetween, toDateOnly } from './dates'

/**
 * Progress calculations (pure). Every edge case — missing dates, future
 * starts, same-day internships, ended or terminated internships — returns a
 * well-defined value; nothing divides by zero or goes negative.
 */

export interface InternshipProgress {
  state: 'not_scheduled' | 'upcoming' | 'in_progress' | 'finished' | 'ended_early'
  /** 1-based day number within the internship (0 before it starts). */
  day: number
  totalDays: number
  percent: number
  daysUntilStart: number
  daysRemaining: number
}

export function internshipProgress(input: {
  start: Date | null
  expectedEnd: Date | null
  actualEnd?: Date | null
  status: InternStatus
  today: Date
}): InternshipProgress {
  const { start, expectedEnd, actualEnd, status } = input
  const today = toDateOnly(input.today)
  if (!start || !expectedEnd) {
    return { state: 'not_scheduled', day: 0, totalDays: 0, percent: 0, daysUntilStart: 0, daysRemaining: 0 }
  }
  const end = daysBetween(start, expectedEnd) < 0 ? start : expectedEnd
  const totalDays = daysBetween(start, end) + 1

  if (status === 'COMPLETED' || status === 'ALUMNI') {
    return { state: 'finished', day: totalDays, totalDays, percent: 100, daysUntilStart: 0, daysRemaining: 0 }
  }
  if (status === 'TERMINATED') {
    const stoppedAt = actualEnd ?? today
    const day = clamp(daysBetween(start, stoppedAt) + 1, 0, totalDays)
    return { state: 'ended_early', day, totalDays, percent: pct(day, totalDays), daysUntilStart: 0, daysRemaining: 0 }
  }

  const elapsed = daysBetween(start, today)
  if (elapsed < 0) {
    return { state: 'upcoming', day: 0, totalDays, percent: 0, daysUntilStart: -elapsed, daysRemaining: totalDays }
  }
  const day = clamp(elapsed + 1, 1, totalDays)
  return {
    state: 'in_progress',
    day,
    totalDays,
    percent: pct(day, totalDays),
    daysUntilStart: 0,
    daysRemaining: Math.max(0, daysBetween(today, end)),
  }
}

export interface OnboardingItemLike {
  required: boolean
  status: OnboardingItemStatus
  due_date: Date | null
}

export interface OnboardingProgress {
  requiredTotal: number
  requiredDone: number
  optionalTotal: number
  optionalDone: number
  overdue: number
  blocked: number
  /** Required-item completion, 0–100 (100 when nothing is required). */
  percent: number
  /** True when every required item is completed (optional items never block). */
  complete: boolean
}

const DONE: readonly OnboardingItemStatus[] = ['COMPLETED', 'SKIPPED']

/** An item is overdue when its due date has passed and it isn't done. */
export function isOverdue(item: Pick<OnboardingItemLike, 'status' | 'due_date'>, today: Date): boolean {
  return Boolean(item.due_date && !DONE.includes(item.status) && daysBetween(item.due_date, today) > 0)
}

export function onboardingProgress(items: readonly OnboardingItemLike[], today: Date): OnboardingProgress {
  let requiredTotal = 0
  let requiredDone = 0
  let optionalTotal = 0
  let optionalDone = 0
  let overdue = 0
  let blocked = 0
  for (const item of items) {
    // A skipped required item counts as resolved only if HR skipped it deliberately.
    const done = DONE.includes(item.status)
    if (item.required) {
      requiredTotal += 1
      if (done) requiredDone += 1
    } else {
      optionalTotal += 1
      if (done) optionalDone += 1
    }
    if (isOverdue(item, today)) overdue += 1
    if (item.status === 'BLOCKED') blocked += 1
  }
  return {
    requiredTotal,
    requiredDone,
    optionalTotal,
    optionalDone,
    overdue,
    blocked,
    percent: requiredTotal === 0 ? 100 : pct(requiredDone, requiredTotal),
    complete: requiredDone === requiredTotal,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function pct(part: number, total: number) {
  return total <= 0 ? 0 : Math.round((part / total) * 100)
}
