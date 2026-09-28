import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Params = Record<string, string | undefined>

export function buildHref(pathname: string, params: Params, overrides: Params): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value !== undefined && value !== '') search.set(key, value)
  }
  const query = search.toString()
  return query ? `${pathname}?${query}` : pathname
}

/** Link-based pagination (works without JavaScript; pages are linkable). */
export function Pagination({
  pathname,
  params,
  page,
  totalPages,
  total,
  pageSize,
}: {
  pathname: string
  params: Params
  page: number
  totalPages: number
  total: number
  pageSize: number
}) {
  if (total === 0) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  const previous = page > 1 ? buildHref(pathname, params, { page: String(page - 1) }) : null
  const next = page < totalPages ? buildHref(pathname, params, { page: String(page + 1) }) : null

  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex items-center justify-between gap-4 text-small text-muted-foreground"
    >
      <p className="tabular">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        <PageLink href={previous} label="Previous page">
          <ChevronLeft aria-hidden />
          <span className="hidden sm:inline">Previous</span>
        </PageLink>
        <span className="tabular px-1" aria-current="page">
          {page} / {totalPages}
        </span>
        <PageLink href={next} label="Next page">
          <span className="hidden sm:inline">Next</span>
          <ChevronRight aria-hidden />
        </PageLink>
      </div>
    </nav>
  )
}

function PageLink({ href, label, children }: { href: string | null; label: string; children: ReactNode }) {
  const className = cn(buttonVariants({ variant: 'outline', size: 'sm' }))
  if (!href) {
    // A disabled button (not a label-carrying span) so the state is exposed correctly.
    return (
      <button type="button" disabled aria-label={label} className={className}>
        {children}
      </button>
    )
  }
  return (
    <Link href={href} aria-label={label} className={className}>
      {children}
    </Link>
  )
}
