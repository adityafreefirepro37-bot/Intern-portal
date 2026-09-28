import * as React from 'react'
import { cn } from '@/lib/utils'

/** Loading placeholder block. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />
}

/** Keyboard shortcut hint. */
export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 font-sans text-[0.6875rem] font-medium text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

/** Accessible progress bar (value 0–100). */
export function Progress({
  value,
  label,
  className,
  indicatorClassName,
}: {
  value: number
  label: string
  className?: string
  indicatorClassName?: string
}) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div
        className={cn('h-full rounded-full bg-primary transition-[width]', indicatorClassName)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}
