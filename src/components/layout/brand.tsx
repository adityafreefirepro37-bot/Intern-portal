import Link from 'next/link'
import { cn } from '@/lib/utils'

/** Ayava wordmark + monogram. */
export function Brand({ collapsed = false, organizationName }: { collapsed?: boolean; organizationName?: string }) {
  return (
    <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded-md" aria-label="AYAVA Intern OS — Overview">
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-[0.9375rem] font-semibold tracking-tight text-primary-foreground shadow-sm"
      >
        A
      </span>
      <span className={cn('min-w-0 leading-tight', collapsed && 'sr-only')}>
        <span className="block text-[0.9375rem] font-semibold tracking-[0.08em]">AYAVA</span>
        <span className="block truncate text-caption text-muted-foreground">{organizationName ?? 'Intern OS'}</span>
      </span>
    </Link>
  )
}
