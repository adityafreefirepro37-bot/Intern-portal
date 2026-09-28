import * as React from 'react'
import { cn } from '@/lib/utils'

export interface Column<T> {
  key: string
  header: string
  cell: (row: T) => React.ReactNode
  /** Hide on small screens to keep the table readable. */
  hideBelow?: 'sm' | 'md' | 'lg'
  align?: 'left' | 'right'
  className?: string
}

const hideClass = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' } as const

/**
 * Semantic, responsive table. Server-renderable (no client state): sorting,
 * filtering and pagination are driven by URL search params so views are
 * linkable and work without JavaScript.
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  getRowId,
  highlightId,
  empty,
  className,
}: {
  /** Accessible table name (visually hidden). */
  caption: string
  columns: Column<T>[]
  rows: T[]
  getRowId: (row: T) => string
  highlightId?: string
  empty?: React.ReactNode
  className?: string
}) {
  if (rows.length === 0 && empty) return <>{empty}</>
  return (
    // Focusable scroll region so keyboard users can scroll wide tables horizontally.
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className={cn('overflow-x-auto rounded-xl border bg-card', className)}
    >
      <table className="w-full border-collapse text-small">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b bg-muted/50">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'h-10 whitespace-nowrap px-4 text-left text-caption font-medium text-muted-foreground',
                  column.align === 'right' && 'text-right',
                  column.hideBelow && hideClass[column.hideBelow],
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const id = getRowId(row)
            const highlighted = highlightId === id
            return (
              <tr
                key={id}
                id={`row-${id}`}
                aria-current={highlighted ? 'true' : undefined}
                className={cn(
                  'border-b transition-colors last:border-b-0 hover:bg-muted/40',
                  highlighted && 'bg-accent/70',
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'px-4 py-3 align-middle',
                      column.align === 'right' && 'text-right',
                      column.hideBelow && hideClass[column.hideBelow],
                      column.className,
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
