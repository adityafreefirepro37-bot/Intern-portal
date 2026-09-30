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

const FILTER_KEYS = [
  'status',
  'department',
  'team',
  'position',
  'manager',
  'mentor',
  'joinedFrom',
  'joinedTo',
  'endFrom',
  'endTo',
  'onboarding',
  'documents',
] as const

const ONBOARDING_OPTIONS = [
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'complete', label: 'Complete' },
]
const DOCUMENT_OPTIONS = [
  { value: 'complete', label: 'All required verified' },
  { value: 'incomplete', label: 'Missing or unverified' },
]

/**
 * Directory search, filters, sort and page size. All state lives in the URL,
 * so views are shareable and survive reloads; the server re-validates every
 * parameter (unknown values fall back to defaults).
 */
export function DirectoryControls({
  statuses,
  departments,
  teams,
  positions,
  people,
  sorts,
  hrFilters = false,
}: {
  statuses: Option[]
  departments: Option[]
  teams: Option[]
  positions: Option[]
  people: Option[]
  sorts: Option[]
  /** Onboarding and document-completion filters (viewers with those permissions). */
  hrFilters?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = React.useTransition()
  const [query, setQuery] = React.useState(params.get('q') ?? '')
  const activeFilters = FILTER_KEYS.filter((key) => params.get(key)).length
  const [open, setOpen] = React.useState(activeFilters > 0)

  const update = React.useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString())
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value)
        else next.delete(key)
      }
      if (!('page' in changes)) next.delete('page')
      const search = next.toString()
      startTransition(() => router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false }))
    },
    [params, pathname, router],
  )

  // Debounced search: waits for a pause in typing before updating the URL.
  React.useEffect(() => {
    if ((params.get('q') ?? '') === query) return
    const timer = setTimeout(() => update({ q: query.trim() || null }), 350)
    return () => clearTimeout(timer)
  }, [query, params, update])

  const select = (key: string, label: string, options: Option[]) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`filter-${key}`}>{label}</Label>
      <select
        id={`filter-${key}`}
        value={params.get(key) ?? ''}
        onChange={(event) => update({ [key]: event.target.value || null })}
        className={inputClassName}
      >
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
  const date = (key: string, label: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`filter-${key}`}>{label}</Label>
      <input
        id={`filter-${key}`}
        type="date"
        value={params.get(key) ?? ''}
        onChange={(event) => update({ [key]: event.target.value || null })}
        className={inputClassName}
      />
    </div>
  )
  const dir = params.get('dir') === 'desc' ? 'desc' : 'asc'

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
            placeholder="Search name, email, code, position, department or team"
            aria-label="Search interns"
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
            <option value="">All statuses</option>
            {statuses.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Sort by"
            value={params.get('sort') ?? 'name'}
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
            aria-label={
              dir === 'asc' ? 'Sorted ascending — switch to descending' : 'Sorted descending — switch to ascending'
            }
            onClick={() => update({ dir: dir === 'asc' ? 'desc' : null })}
          >
            {dir === 'asc' ? <ArrowDownAZ aria-hidden /> : <ArrowUpZA aria-hidden />}
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-expanded={open}
            aria-controls="intern-filters"
            onClick={() => setOpen((v) => !v)}
          >
            <SlidersHorizontal aria-hidden /> Filters{activeFilters > 0 && ` (${activeFilters})`}
          </Button>
        </div>
      </div>

      {open && (
        <div
          id="intern-filters"
          className="grid grid-cols-1 gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {select('department', 'Department', departments)}
          {select('team', 'Team', teams)}
          {select('position', 'Position', positions)}
          {select('manager', 'Manager', people)}
          {select('mentor', 'Mentor', people)}
          {date('joinedFrom', 'Joined from')}
          {date('joinedTo', 'Joined to')}
          {date('endFrom', 'Ends from')}
          {date('endTo', 'Ends to')}
          {hrFilters && select('onboarding', 'Onboarding', ONBOARDING_OPTIONS)}
          {hrFilters && select('documents', 'Required documents', DOCUMENT_OPTIONS)}
          <div className="flex items-end">
            <Button
              type="button"
              variant="ghost"
              disabled={activeFilters === 0 && !params.get('q')}
              onClick={() => {
                setQuery('')
                update(Object.fromEntries([...FILTER_KEYS, 'q'].map((key) => [key, null])))
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

/** Page-size picker (25/50/100), kept in the URL. */
export function PageSizeSelect({ value }: { value: number }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  return (
    <label className="flex items-center gap-2 text-small text-muted-foreground">
      Rows per page
      <select
        value={value}
        onChange={(event) => {
          const next = new URLSearchParams(params.toString())
          if (event.target.value === '25') next.delete('pageSize')
          else next.set('pageSize', event.target.value)
          next.delete('page')
          const search = next.toString()
          router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false })
        }}
        className={cn(inputClassName, 'h-8 w-auto')}
      >
        {[25, 50, 100].map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>
    </label>
  )
}
