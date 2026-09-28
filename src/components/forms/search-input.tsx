'use client'

import * as React from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** Search field with a leading icon, clear button and accessible label. */
export const SearchInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
    label: string
    value: string
    onValueChange: (value: string) => void
  }
>(({ label, value, onValueChange, className, ...props }, ref) => (
  <div className={cn('relative', className)}>
    <Search
      className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      aria-hidden
    />
    <Input
      ref={ref}
      type="search"
      aria-label={label}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      className="pl-9 pr-8 [&::-webkit-search-cancel-button]:hidden"
      {...props}
    />
    {value && (
      <button
        type="button"
        onClick={() => onValueChange('')}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
      >
        <X className="size-3.5" aria-hidden />
        <span className="sr-only">Clear search</span>
      </button>
    )}
  </div>
))
SearchInput.displayName = 'SearchInput'
