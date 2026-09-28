'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { NAVIGATION, isActivePath, type VisibleNavItem } from '@/config/navigation'
import { cn } from '@/lib/utils'

/** Bottom navigation bar for small screens: key destinations + "More". */
export function MobileNav({ nav, onOpenMenu }: { nav: readonly VisibleNavItem[]; onOpenMenu: () => void }) {
  const labels = new Map(nav.map((item) => [item.href, item.label]))
  const pathname = usePathname()
  const items = NAVIGATION.flatMap((section) => section.items)
    .filter((item) => item.mobile && labels.has(item.href))
    .slice(0, 4)

  const itemClass =
    'flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md py-1.5 text-[0.6875rem] font-medium text-muted-foreground transition-colors'

  return (
    <nav
      aria-label="Quick navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="mx-auto flex max-w-lg items-stretch gap-1 px-2 py-1.5">
        {items.map((item) => {
          const active = isActivePath(pathname, item.href)
          const Icon = item.icon
          return (
            <li key={item.href} className="flex flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(itemClass, active && 'text-primary')}
              >
                <Icon className="size-5" aria-hidden />
                {(labels.get(item.href) ?? item.label).replace(' Hub', '').replace('My ', '')}
              </Link>
            </li>
          )
        })}
        <li className="flex flex-1">
          <button type="button" onClick={onOpenMenu} className={itemClass}>
            <Menu className="size-5" aria-hidden />
            More
          </button>
        </li>
      </ul>
    </nav>
  )
}
