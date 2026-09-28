import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { Inbox, Loader2, Lock, TriangleAlert } from 'lucide-react'
import { Skeleton } from '@/components/ui/misc'
import { cn } from '@/lib/utils'

/** Nothing to show yet — explain why and, optionally, what to do next. */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: LucideIcon
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'py-8' : 'py-14', className)}>
      <span className="mb-4 flex size-11 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <h2 className="text-h3">{title}</h2>
      {description && <p className="mt-1.5 max-w-sm text-small text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** Inline spinner with an accessible status message. */
export function LoadingState({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div
      role="status"
      className={cn('flex items-center justify-center gap-2 py-12 text-small text-muted-foreground', className)}
    >
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  )
}

/** Skeleton layout for a page while its data streams in. */
export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading page" className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-[7.5rem] rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-xl lg:col-span-2" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  )
}

/** Something went wrong; offers a retry when one is available. */
export function ErrorState({
  title = 'Something went wrong',
  description = 'We couldn’t load this. Please try again.',
  action,
  reference,
  className,
}: {
  title?: string
  description?: React.ReactNode
  action?: React.ReactNode
  reference?: string
  className?: string
}) {
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center py-14 text-center', className)}>
      <span className="mb-4 flex size-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <TriangleAlert className="size-5" aria-hidden />
      </span>
      <h2 className="text-h3">{title}</h2>
      <p className="mt-1.5 max-w-sm text-small text-muted-foreground">{description}</p>
      {reference && <p className="mt-2 font-mono text-caption text-muted-foreground">Reference: {reference}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** Shown when the viewer lacks the permission a page needs. */
export function AccessDenied({ what = 'this page' }: { what?: string }) {
  return (
    <EmptyState
      icon={Lock}
      title="You don’t have access"
      description={`Your role doesn’t include permission to view ${what}. Ask an administrator if you need it.`}
    />
  )
}
