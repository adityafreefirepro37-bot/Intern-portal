import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * A single headline figure. `value` always comes from a service query; the
 * component never supplies numbers of its own.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
  tone = 'default',
  className,
}: {
  label: string
  value: number | string
  hint?: string
  icon?: LucideIcon
  href?: string
  tone?: 'default' | 'attention'
  className?: string
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-label text-muted-foreground">{label}</p>
        {Icon && (
          <span
            className={cn(
              'flex size-8 items-center justify-center rounded-lg bg-secondary text-secondary-foreground',
              tone === 'attention' && 'bg-warning/14 text-warning',
            )}
          >
            <Icon className="size-4" aria-hidden />
          </span>
        )}
      </div>
      <p className="tabular mt-3 text-[1.875rem] font-semibold leading-none tracking-tight">{value}</p>
      {hint && <p className="mt-2 text-caption text-muted-foreground">{hint}</p>}
    </>
  )

  return (
    <Card className={cn('relative p-5 transition-colors', href && 'hover:border-ring/40', className)}>
      {href ? (
        <Link
          href={href}
          className="block rounded-md after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-xl focus-visible:after:outline-2 focus-visible:after:outline-ring"
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </Card>
  )
}
