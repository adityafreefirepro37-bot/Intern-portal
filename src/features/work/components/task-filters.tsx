'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowDownAZ, ArrowUpZA, KanbanSquare, List, Loader2, Search, SlidersHorizontal, X } from 'lucide-react'
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
  'priority',
  'assignee',
  'project',
  'milestone',
  'createdBy',
  'submission',
  'due',
  'closed',
] as const

/** Named views: filter presets kept in the URL (the saved-filter architecture). */
export const TASK_VIEWS = [
  { key: 'mine', label: 'My open work', params: { assignee: 'me' } },
  { key: 'overdue', label: 'Overdue', params: { due: 'overdue' } },
  { key: 'review', label: 'Awaiting review', params: { submission: 'PENDING' } },
  { key: 'blocked', label: 'Blocked', params: { status: 'BLOCKED' } },
  { key: 'unassigned', label: 'Unassigned', params: { assignee: 'none' } },
] as const

/**
 * Task search, filters, sort and view switch. Everything lives in the URL so
 * views are linkable; the server validates every parameter.
 */
export function TaskFilters({
  statuses,
  priorities,
  people,
  projects,
  milestones,
  sorts,
  view,
  showViewToggle = true,
}: {
  statuses: Option[]
  priorities: Option[]
  people: Option[]
  projects?: Option[]
  milestones?: Option[]
  sorts: Option[]
  view: 'list' | 'board'
  showViewToggle?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = React.useTransition()
  const [query, setQuery] = React.useState(params.get('q') ?? '')
  const active = FILTER_KEYS.filter((key) => params.get(key)).length
  const [open, setOpen] = React.useState(active > 0)

  const href = React.useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString())
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value)
        else next.delete(key)
      }
      if (!('page' in changes)) next.delete('page')
      const search = next.toString()
      return search ? `${pathname}?${search}` : pathname
    },
    [params, pathname],
  )
  const update = React.useCallback(
    (changes: Record<string, string | null>) => startTransition(() => router.replace(href(changes), { scroll: false })),
    [href, router],
  )

  React.useEffect(() => {
    if ((params.get('q') ?? '') === query) return
    const timer = setTimeout(() => update({ q: query.trim() || null }), 350)
    return () => clearTimeout(timer)
  }, [query, params, update])

  const select = (key: string, label: string, options: Option[], anyLabel = 'Any') => (
    <div className="grid gap-1.5">
      <Label htmlFor={`task-filter-${key}`}>{label}</Label>
      <select
        id={`task-filter-${key}`}
        value={params.get(key) ?? ''}
        onChange={(event) => update({ [key]: event.target.value || null })}
        className={inputClassName}
      >
        <option value="">{anyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
  const dir = params.get('dir') === 'desc' ? 'desc' : 'asc'
  const clearAll = Object.fromEntries([...FILTER_KEYS, 'q'].map((key) => [key, null]))

  return (
    <div className="mb-4 space-y-3">
      <nav aria-label="Saved views" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {TASK_VIEWS.map((preset) => {
          const current = Object.entries(preset.params).every(([k, v]) => params.get(k) === v)
          return (
            <Link
              key={preset.key}
              href={href({ ...clearAll, ...preset.params })}
              aria-current={current ? 'page' : undefined}
              scroll={false}
              className={cn(
                'inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-caption font-medium transition-colors hover:bg-accent',
                current && 'border-primary bg-primary text-primary-foreground hover:bg-primary',
              )}
            >
              {preset.label}
            </Link>
          )
        })}
      </nav>

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
            placeholder="Search tasks and projects"
            aria-label="Search tasks"
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
          {view === 'list' && (
            <>
              <select
                aria-label="Sort by"
                value={params.get('sort') ?? 'due'}
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
            </>
          )}
          <Button
            type="button"
            variant="outline"
            aria-expanded={open}
            aria-controls="task-filter-panel"
            onClick={() => setOpen((v) => !v)}
          >
            <SlidersHorizontal aria-hidden /> Filters{active > 0 && ` (${active})`}
          </Button>
          {showViewToggle && (
            <div role="group" aria-label="View" className="flex rounded-md border p-0.5">
              <Link
                href={href({ view: null })}
                aria-current={view === 'list' ? 'page' : undefined}
                className={cn(
                  'flex h-8 items-center gap-1.5 rounded px-2.5 text-caption font-medium',
                  view === 'list' && 'bg-accent',
                )}
              >
                <List className="size-4" aria-hidden /> List
              </Link>
              <Link
                href={href({ view: 'board', page: null, sort: null, dir: null })}
                aria-current={view === 'board' ? 'page' : undefined}
                className={cn(
                  'flex h-8 items-center gap-1.5 rounded px-2.5 text-caption font-medium',
                  view === 'board' && 'bg-accent',
                )}
              >
                <KanbanSquare className="size-4" aria-hidden /> Board
              </Link>
            </div>
          )}
        </div>
      </div>

      {open && (
        <div
          id="task-filter-panel"
          className="grid grid-cols-1 gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {view === 'list' && select('status', 'Status', statuses, 'All open')}
          {select('priority', 'Priority', priorities)}
          {select('assignee', 'Assignee', [
            { value: 'me', label: 'Me' },
            { value: 'none', label: 'Unassigned' },
            ...people,
          ])}
          {projects && select('project', 'Project', projects)}
          {milestones && milestones.length > 0 && select('milestone', 'Milestone', milestones)}
          {select('createdBy', 'Created by', [{ value: 'me', label: 'Me' }, ...people])}
          {select('submission', 'Submission', [
            { value: 'PENDING', label: 'Awaiting review' },
            { value: 'CHANGES_REQUESTED', label: 'Changes requested' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'NONE', label: 'Not submitted' },
          ])}
          {select('due', 'Due', [
            { value: 'overdue', label: 'Overdue' },
            { value: 'today', label: 'Due today' },
            { value: 'week', label: 'Due in 7 days' },
            { value: 'none', label: 'No due date' },
          ])}
          {view === 'list' && (
            <label className="flex items-center gap-2 self-end pb-2 text-small">
              <input
                type="checkbox"
                checked={params.get('closed') === '1'}
                onChange={(event) => update({ closed: event.target.checked ? '1' : null })}
                className="size-4 accent-primary"
              />
              Include completed & cancelled
            </label>
          )}
          <div className="flex items-end">
            <Button
              type="button"
              variant="ghost"
              disabled={active === 0 && !params.get('q')}
              onClick={() => {
                setQuery('')
                update(clearAll)
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

export function PageSizeSelect({ value, options = [25, 50, 100] }: { value: number; options?: number[] }) {
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
          if (Number(event.target.value) === options[0]) next.delete('pageSize')
          else next.set('pageSize', event.target.value)
          next.delete('page')
          const search = next.toString()
          router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false })
        }}
        className={cn(inputClassName, 'h-8 w-auto')}
      >
        {options.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>
    </label>
  )
}
