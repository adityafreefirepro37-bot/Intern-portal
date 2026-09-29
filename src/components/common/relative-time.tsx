'use client'

import { timeAgo } from '@/lib/utils'

/**
 * "3 minutes ago". Server and browser render at slightly different moments,
 * so the text may legitimately differ during hydration; that single text node
 * is exempt from the mismatch check. The machine-readable timestamp is exact.
 */
export function RelativeTime({ date, className }: { date: Date | string; className?: string }) {
  const value = new Date(date)
  return (
    <time dateTime={value.toISOString()} title={value.toISOString()} className={className} suppressHydrationWarning>
      {timeAgo(value, new Date())}
    </time>
  )
}
