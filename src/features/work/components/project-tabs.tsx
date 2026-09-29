'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

/** Project section navigation (each tab is its own route). */
export function ProjectTabs({ base, tabs }: { base: string; tabs: { segment: string; label: string }[] }) {
  const pathname = usePathname()
  return (
    <nav aria-label="Project sections" className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-lg bg-muted p-1 lg:w-auto lg:flex-wrap">
        {tabs.map((tab) => {
          const href = tab.segment ? `${base}/${tab.segment}` : base
          const current = tab.segment ? pathname.startsWith(href) : pathname === base
          return (
            <li key={tab.segment || 'overview'}>
              <Link
                href={href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'inline-flex h-8 items-center whitespace-nowrap rounded-md px-3 text-label text-muted-foreground transition-colors hover:text-foreground',
                  current && 'bg-card text-foreground shadow-sm',
                )}
              >
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
