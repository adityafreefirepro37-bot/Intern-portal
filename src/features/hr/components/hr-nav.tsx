import Link from 'next/link'
import { cn } from '@/lib/utils'

export interface HrNavItem {
  href: string
  label: string
}

/**
 * Section navigation for the HR area. Items are resolved on the server from
 * the viewer's permissions (see hrNavItems), so links never lead to 403s.
 */
export function HrNav({ items, active }: { items: HrNavItem[]; active: string }) {
  if (items.length < 2) return null
  return (
    <nav aria-label="HR sections" className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-lg bg-muted p-1 lg:w-auto lg:flex-wrap">
        {items.map((item) => {
          const current = item.href === active
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'inline-flex h-8 items-center whitespace-nowrap rounded-md px-3 text-label text-muted-foreground transition-colors hover:text-foreground',
                  current && 'bg-card text-foreground shadow-sm',
                )}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Month navigation (previous / current label / next) as plain links. */
export function MonthNav({
  label,
  prevHref,
  nextHref,
  todayHref,
}: {
  label: string
  prevHref: string
  nextHref: string
  todayHref?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={prevHref}
        className="inline-flex h-8 items-center rounded-md border bg-card px-3 text-caption font-medium hover:bg-accent"
        aria-label="Previous month"
      >
        ← Prev
      </Link>
      <h2 className="min-w-36 text-center text-h3" aria-live="polite">
        {label}
      </h2>
      <Link
        href={nextHref}
        className="inline-flex h-8 items-center rounded-md border bg-card px-3 text-caption font-medium hover:bg-accent"
        aria-label="Next month"
      >
        Next →
      </Link>
      {todayHref && (
        <Link href={todayHref} className="text-caption font-medium text-primary hover:underline">
          This month
        </Link>
      )}
    </div>
  )
}

/** Views within one HR page (`?view=`), as links so every view is linkable and server-rendered. */
export function SubTabs({
  items,
  active,
  label,
}: {
  items: { key: string; href: string; label: string; count?: number }[]
  active: string
  label: string
}) {
  return (
    <nav aria-label={label} className="mb-4 flex flex-wrap gap-2">
      {items.map((item) => {
        const current = item.key === active
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-caption font-medium transition-colors',
              current ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-accent',
            )}
          >
            {item.label}
            {item.count !== undefined && item.count > 0 && (
              <span
                className={cn(
                  'tabular rounded-full px-1.5 text-[0.6875rem]',
                  current ? 'bg-primary-foreground/20' : 'bg-muted text-muted-foreground',
                )}
              >
                {item.count}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
