'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowDownAZ, ArrowUpZA, Loader2, Search, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { inputClassName } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface Option {
  value: string
  label: string
}

const KEYS = ['status', 'manager', 'member', 'startFrom', 'startTo', 'dueFrom', 'dueTo'] as const

/** Project search, filters and sort, all kept in the URL. */
export function ProjectFilters({
  statuses,
  managers,
  sorts,
}: {
  statuses: Option[]
  managers: Option[]
  sorts: Option[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = React.useTransition()
  const [query, setQuery] = React.useState(params.get('q') ?? '')
  const active = KEYS.filter((key) => params.get(key)).length
  const [open, setOpen] = React.useState(active > 0)

  const update = React.useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString())
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value)
        else next.delete(key)
      }
      next.delete('page')
      const search = next.toString()
      startTransition(() => router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false }))
    },
    [params, pathname, router],
  )

  React.useEffect(() => {
    if ((params.get('q') ?? '') === query) return
    const timer = setTimeout(() => update({ q: query.trim() || null }), 350)
    return () => clearTimeout(timer)
  }, [query, params, update])

  const dir = params.get('dir') === 'desc' ? 'desc' : 'asc'
  const date = (key: string, label: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`project-filter-${key}`}>{label}</Label>
      <input
        id={`project-filter-${key}`}
        type="date"
        value={params.get(key) ?? ''}
        onChange={(event) => update({ [key]: event.target.value || null })}
        className={inputClassName}
      />
    </div>
  )

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div role="search" className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects"
            aria-label="Search projects"
            className={cn(inputClassName, 'pl-9')}
          />
          {pending && (
            <Loader2
              className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
              aria-label="Updating"
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Status"
            value={params.get('status') ?? ''}
            onChange={(event) => update({ status: event.target.value || null })}
            className={cn(inputClassName, 'w-auto')}
          >
            <option value="">All (not archived)</option>
            {statuses.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Sort by"
            value={params.get('sort') ?? 'status'}
            onChange={(event) => update({ sort: event.target.value })}
            className={cn(inputClassName, 'w-auto')}
          >
            {sorts.map((option) => (
              <option key={option.value} value={option.value}>
                Sort: {option.label}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={dir === 'asc' ? 'Ascending — switch to descending' : 'Descending — switch to ascending'}
            onClick={() => update({ dir: dir === 'asc' ? 'desc' : null })}
          >
            {dir === 'asc' ? <ArrowDownAZ aria-hidden /> : <ArrowUpZA aria-hidden />}
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-expanded={open}
            aria-controls="project-filter-panel"
            onClick={() => setOpen((v) => !v)}
          >
            <SlidersHorizontal aria-hidden /> Filters{active > 0 && ` (${active})`}
          </Button>
        </div>
      </div>
      {open && (
        <div
          id="project-filter-panel"
          className="grid grid-cols-1 gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="project-filter-manager">Manager</Label>
            <select
              id="project-filter-manager"
              value={params.get('manager') ?? ''}
              onChange={(event) => update({ manager: event.target.value || null })}
              className={inputClassName}
            >
              <option value="">Any</option>
              {managers.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-small">
            <input
              type="checkbox"
              checked={params.get('member') === 'me'}
              onChange={(event) => update({ member: event.target.checked ? 'me' : null })}
              className="size-4 accent-primary"
            />
            Only projects I’m on
          </label>
          {date('startFrom', 'Starts from')}
          {date('startTo', 'Starts by')}
          {date('dueFrom', 'Ends from')}
          {date('dueTo', 'Ends by')}
          <div className="flex items-end">
            <Button
              type="button"
              variant="ghost"
              disabled={active === 0 && !params.get('q')}
              onClick={() => {
                setQuery('')
                update(Object.fromEntries([...KEYS, 'q'].map((key) => [key, null])))
              }}
            >
              <X aria-hidden /> Clear filters
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
