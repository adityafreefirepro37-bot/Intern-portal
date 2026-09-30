import type { OnboardingProgress } from '@/lib/interns/progress'

/** Onboarding buckets, ending-soon windows and CSV export (pure). */

export type OnboardingBucket = 'NOT_STARTED' | 'IN_PROGRESS' | 'NEARLY_COMPLETE' | 'COMPLETE' | 'OVERDUE'

export const ONBOARDING_BUCKET_LABELS: Record<OnboardingBucket, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  NEARLY_COMPLETE: 'Nearly complete',
  COMPLETE: 'Complete',
  OVERDUE: 'Overdue',
}

/** Overdue wins over progress; "nearly complete" is ≥ 80% of required items. */
export function onboardingBucket(
  progress: Pick<OnboardingProgress, 'requiredDone' | 'requiredTotal' | 'overdue' | 'percent'>,
  completed: boolean,
): OnboardingBucket {
  if (completed || (progress.requiredTotal > 0 && progress.requiredDone === progress.requiredTotal)) return 'COMPLETE'
  if (progress.overdue > 0) return 'OVERDUE'
  if (progress.requiredDone === 0) return 'NOT_STARTED'
  return progress.percent >= 80 ? 'NEARLY_COMPLETE' : 'IN_PROGRESS'
}

export const ENDING_WINDOWS = [7, 14, 30] as const
export type EndingWindow = (typeof ENDING_WINDOWS)[number]

export function parseEndingWindow(value: unknown, fallback: EndingWindow = 30): EndingWindow {
  const n = Number(value)
  return (ENDING_WINDOWS as readonly number[]).includes(n) ? (n as EndingWindow) : fallback
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/**
 * Neutralizes spreadsheet formula injection: a cell starting with = + - @ tab
 * or CR is prefixed with an apostrophe so spreadsheet apps treat it as text.
 */
export function safeCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let text = value instanceof Date ? value.toISOString() : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`
  return text
}

export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  // BOM so spreadsheet apps detect UTF-8 (names with non-ASCII characters).
  return `﻿${[headers, ...rows].map((row) => row.map(safeCell).join(',')).join('\r\n')}\r\n`
}
