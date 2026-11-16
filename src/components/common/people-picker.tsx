'use client'

import * as React from 'react'
import { Search, X } from 'lucide-react'
import { inputClassName } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface PickerOption {
  id: string
  name: string
  detail?: string | null
}

/**
 * Searchable multi-select of people. Each option is a real checkbox named
 * `name`, so the selection submits with the surrounding form; filtering only
 * hides options (they stay in the form).
 */
export function PeoplePicker({
  name,
  options,
  defaultSelected = [],
  label,
  id,
  describedBy,
  emptyLabel = 'Nobody to choose from.',
}: {
  name: string
  options: PickerOption[]
  defaultSelected?: string[]
  label: string
  id: string
  describedBy?: string
  emptyLabel?: string
}) {
  const [query, setQuery] = React.useState('')
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(defaultSelected))
  const q = query.trim().toLowerCase()
  const byId = React.useMemo(() => new Map(options.map((o) => [o.id, o])), [options])

  function toggle(personId: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(personId)
      else next.delete(personId)
      return next
    })
  }

  return (
    <div className="grid gap-2" role="group" aria-labelledby={`${id}-label`} aria-describedby={describedBy}>
      <span id={`${id}-label`} className="sr-only">
        {label}
      </span>
      {selected.size > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected">
          {[...selected].map((personId) => (
            <li key={personId}>
              <button
                type="button"
                onClick={() => toggle(personId, false)}
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-caption font-medium text-primary hover:bg-primary/15"
                aria-label={`Remove ${byId.get(personId)?.name ?? 'person'}`}
              >
                {byId.get(personId)?.name ?? 'Unknown'}
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          id={id}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search people…"
          className={cn(inputClassName, 'pl-8')}
          aria-label={`Search ${label.toLowerCase()}`}
          autoComplete="off"
        />
      </div>
      {options.length === 0 ? (
        <p className="text-caption text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="max-h-52 divide-y overflow-y-auto rounded-md border">
          {options.map((option) => {
            const visible = !q || option.name.toLowerCase().includes(q) || option.detail?.toLowerCase().includes(q)
            return (
              <li key={option.id} className={cn(!visible && 'hidden')}>
                <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-small hover:bg-accent">
                  <input
                    type="checkbox"
                    name={name}
                    value={option.id}
                    checked={selected.has(option.id)}
                    onChange={(event) => toggle(option.id, event.target.checked)}
                    className="size-4 accent-primary"
                  />
                  <span className="min-w-0 flex-1 truncate">{option.name}</span>
                  {option.detail && <span className="shrink-0 text-caption text-muted-foreground">{option.detail}</span>}
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
