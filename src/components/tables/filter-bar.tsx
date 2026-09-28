import Link from 'next/link'
import { cn } from '@/lib/utils'
import { buildHref } from './pagination'

export interface FilterOption {
  value: string
  label: string
}

/**
 * Single-select filter chips driven by a URL search param. Selecting a
 * filter resets pagination. Use several FilterBars side by side for multiple
 * dimensions.
 */
export function FilterBar({
  label,
  param,
  options,
  pathname,
  params,
  allLabel = 'All',
  className,
}: {
  label: string
  param: string
  options: FilterOption[]
  pathname: string
  params: Record<string, string | undefined>
  allLabel?: string
  className?: string
}) {
  const current = params[param]
  const items: (FilterOption & { href: string; active: boolean })[] = [
    {
      value: '',
      label: allLabel,
      href: buildHref(pathname, params, { [param]: undefined, page: undefined }),
      active: !current,
    },
    ...options.map((option) => ({
      ...option,
      href: buildHref(pathname, params, { [param]: option.value, page: undefined }),
      active: current === option.value,
    })),
  ]

  return (
    <nav aria-label={label} className={cn('-mx-1 mb-4 overflow-x-auto px-1 pb-1', className)}>
      <ul className="flex w-max items-center gap-1.5">
        {items.map((item) => (
          <li key={item.value || 'all'}>
            <Link
              href={item.href}
              aria-current={item.active ? 'true' : undefined}
              className={cn(
                'inline-flex h-8 items-center rounded-full border px-3 text-caption font-medium transition-colors',
                item.active
                  ? 'border-transparent bg-foreground text-background'
                  : 'bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
