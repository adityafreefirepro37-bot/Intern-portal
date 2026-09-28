'use client'

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NavList } from '@/components/navigation/nav-list'
import type { VisibleNavItem } from '@/config/navigation'
import { cn } from '@/lib/utils'
import { Brand } from './brand'

/** Desktop sidebar (md and up). Collapses to an icon rail. */
export function Sidebar({
  nav,
  organizationName,
  collapsed,
  onToggle,
}: {
  nav: readonly VisibleNavItem[]
  organizationName: string
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <aside
      aria-label="Sidebar"
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 md:flex',
        collapsed ? 'w-[4.25rem]' : 'w-64',
      )}
    >
      <div
        className={cn('flex h-16 items-center border-b border-sidebar-border px-4', collapsed && 'justify-center px-0')}
      >
        <Brand collapsed={collapsed} organizationName={organizationName} />
      </div>
      <div className={cn('flex-1 overflow-y-auto px-3 py-4', collapsed && 'px-2')}>
        <NavList nav={nav} collapsed={collapsed} />
      </div>
      <div className={cn('border-t border-sidebar-border p-3', collapsed && 'flex justify-center px-2')}>
        <Button
          variant="ghost"
          size={collapsed ? 'icon' : 'sm'}
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(!collapsed && 'w-full justify-start text-muted-foreground')}
        >
          {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
          {!collapsed && 'Collapse'}
        </Button>
      </div>
    </aside>
  )
}
