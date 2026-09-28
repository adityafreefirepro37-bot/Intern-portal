'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, CornerDownLeft, Loader2, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/misc'
import type { VisibleNavItem } from '@/config/navigation'
import type { ApiResult } from '@/lib/http/response'
import { cn } from '@/lib/utils'
import type { SearchGroup } from '@/server/services/search.service'

interface Entry {
  id: string
  group: string
  title: string
  subtitle?: string
  href: string
}

/**
 * Global command/search palette (Ctrl/⌘+K). With fewer than two characters
 * it lists pages; otherwise it queries /api/search, which returns only
 * results the user is permitted to see. Implements the ARIA combobox +
 * listbox pattern (arrow keys, Enter, Escape).
 */
export function CommandMenu({
  open,
  onOpenChange,
  nav,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  nav: readonly VisibleNavItem[]
}) {
  const router = useRouter()
  const listId = React.useId()
  const [query, setQuery] = React.useState('')
  const [groups, setGroups] = React.useState<SearchGroup[]>([])
  const [status, setStatus] = React.useState<'idle' | 'loading' | 'error'>('idle')
  const [activeIndex, setActiveIndex] = React.useState(0)

  const term = query.trim()

  React.useEffect(() => {
    if (term.length < 2) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setStatus('loading')
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: controller.signal })
        const body = (await response.json()) as ApiResult<SearchGroup[]>
        if (body.success) {
          setGroups(body.data)
          setStatus('idle')
        } else {
          setGroups([])
          setStatus('error')
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setStatus('error')
      }
    }, 200)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [term])

  const entries: Entry[] = React.useMemo(() => {
    if (term.length >= 2) {
      return groups.flatMap((group) =>
        group.results.map((result) => ({
          id: `${result.type}-${result.id}`,
          group: group.label,
          title: result.title,
          subtitle: result.subtitle,
          href: result.href,
        })),
      )
    }
    const lower = term.toLowerCase()
    return nav
      .filter((item) => item.label.toLowerCase().includes(lower))
      .map((item) => ({ id: `nav-${item.href}`, group: 'Go to', title: item.label, href: item.href }))
  }, [term, groups, nav])

  const safeIndex = Math.min(activeIndex, Math.max(entries.length - 1, 0))

  function reset() {
    setQuery('')
    setGroups([])
    setStatus('idle')
    setActiveIndex(0)
  }

  function go(entry: Entry | undefined) {
    if (!entry) return
    onOpenChange(false)
    reset()
    router.push(entry.href)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (entries.length ? (index + 1) % entries.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (entries.length ? (index - 1 + entries.length) % entries.length : 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      go(entries[safeIndex])
    }
  }

  const optionId = (index: number) => `${listId}-option-${index}`

  // Keep the keyboard-highlighted option visible while arrowing through results.
  React.useEffect(() => {
    if (open) document.getElementById(`${listId}-option-${safeIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, safeIndex, listId, entries.length])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent hideClose className="top-[12vh] max-w-xl translate-y-0 gap-0 p-0 sm:top-[18vh]">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Search interns, tasks, projects, courses and announcements, or jump to a page.
        </DialogDescription>
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={entries.length ? optionId(safeIndex) : undefined}
            aria-label="Search or jump to"
            placeholder="Search or jump to…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(0)
              if (event.target.value.trim().length < 2) setStatus('idle')
            }}
            onKeyDown={onKeyDown}
            className="h-12 flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground"
          />
          {status === 'loading' && (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Searching" />
          )}
        </div>

        <div
          tabIndex={0}
          aria-label="Search results"
          className="max-h-[min(60vh,24rem)] overflow-y-auto p-2 outline-none"
        >
          <ul id={listId} role="listbox" aria-label="Results">
            {entries.map((entry, index) => {
              const heading = entry.group !== entries[index - 1]?.group ? entry.group : null
              return (
                <React.Fragment key={entry.id}>
                  {heading && (
                    <li
                      role="presentation"
                      className="px-2 pb-1 pt-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
                    >
                      {heading}
                    </li>
                  )}
                  <li
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === safeIndex}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => go(entry)}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-small',
                      index === safeIndex && 'bg-accent text-accent-foreground',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{entry.title}</span>
                      {entry.subtitle && (
                        <span className="block truncate text-caption text-muted-foreground">{entry.subtitle}</span>
                      )}
                    </span>
                    {index === safeIndex && <ArrowRight className="size-4 text-muted-foreground" aria-hidden />}
                  </li>
                </React.Fragment>
              )
            })}
          </ul>

          {entries.length === 0 && (
            <p role="status" className="px-3 py-8 text-center text-small text-muted-foreground">
              {status === 'error'
                ? 'Search is unavailable right now. Please try again.'
                : status === 'loading'
                  ? 'Searching…'
                  : term.length >= 2
                    ? `No results for “${term}”.`
                    : 'No matching pages.'}
            </p>
          )}
        </div>

        <div className="hidden items-center gap-4 border-t px-4 py-2 text-caption text-muted-foreground sm:flex">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>
              <CornerDownLeft className="size-3" aria-hidden />
            </Kbd>
            open
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Esc</Kbd> close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
