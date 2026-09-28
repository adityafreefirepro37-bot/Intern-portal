'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { filterNavigation, isActivePath, type VisibleNavItem } from '@/config/navigation'
import { cn } from '@/lib/utils'

/** Sectioned navigation used by the desktop sidebar and the mobile drawer. */
export function NavList({
  nav,
  collapsed = false,
  onNavigate,
}: {
  nav: readonly VisibleNavItem[]
  collapsed?: boolean
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const sections = filterNavigation(nav)

  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {sections.map((section) => (
        <div key={section.title}>
          <p
            className={cn(
              'mb-1.5 px-2.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground',
              collapsed && 'sr-only',
            )}
          >
            {section.title}
          </p>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const active = isActivePath(pathname, item.href)
              const Icon = item.icon
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    title={collapsed ? item.resolvedLabel : undefined}
                    className={cn(
                      'group flex h-9 items-center gap-2.5 rounded-md px-2.5 text-small font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground',
                      active && 'bg-sidebar-accent text-foreground',
                      collapsed && 'justify-center px-0',
                    )}
                  >
                    <Icon
                      className={cn(
                        'size-4 shrink-0 text-muted-foreground group-hover:text-foreground',
                        active && 'text-primary',
                      )}
                      aria-hidden
                    />
                    <span className={cn('flex-1 truncate', collapsed && 'sr-only')}>{item.resolvedLabel}</span>
                    {item.phase && !collapsed && (
                      <span
                        className="rounded border px-1 text-[0.625rem] font-medium text-muted-foreground"
                        aria-label={`Coming in phase ${item.phase}`}
                      >
                        P{item.phase}
                      </span>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
