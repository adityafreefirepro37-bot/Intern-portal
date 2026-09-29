'use client'

import * as React from 'react'
import { CommandMenu } from '@/components/navigation/command-menu'
import { NavList } from '@/components/navigation/nav-list'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { VisibleNavItem } from '@/config/navigation'
import { SITE } from '@/config/site'
import { Brand } from './brand'
import { MobileNav } from './mobile-nav'
import { Sidebar } from './sidebar'
import type { ShellNotification } from './notification-bell'
import { Topbar, type ShellUser } from './topbar'

/**
 * Application shell. Receives only serializable, already-authorized data from
 * the server layout (visible nav hrefs, the current user's display fields).
 *
 * Desktop: collapsible sidebar + topbar. Mobile: header, bottom navigation
 * and a slide-in drawer with the full menu.
 */
export function AppShell({
  user,
  organizationName,
  nav,
  initialCollapsed,
  notifications,
  children,
}: {
  user: ShellUser
  organizationName: string
  nav: VisibleNavItem[]
  initialCollapsed: boolean
  notifications: { items: ShellNotification[]; unread: number }
  children: React.ReactNode
}) {
  const [collapsed, setCollapsed] = React.useState(initialCollapsed)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [searchOpen, setSearchOpen] = React.useState(false)

  const toggleSidebar = React.useCallback(() => {
    setCollapsed((current) => {
      const next = !current
      document.cookie = `${SITE.sidebarCookie}=${next ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; samesite=lax`
      return next
    })
  }, [])

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow-lg"
      >
        Skip to content
      </a>

      <Sidebar nav={nav} organizationName={organizationName} collapsed={collapsed} onToggle={toggleSidebar} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          notifications={notifications}
          user={user}
          organizationName={organizationName}
          onOpenMenu={() => setMenuOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
        />
        <main id="main" tabIndex={-1} className="flex-1 px-4 pb-28 pt-6 outline-none sm:px-6 md:pb-10 lg:px-8 lg:pt-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>

      <MobileNav nav={nav} onOpenMenu={() => setMenuOpen(true)} />

      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogContent side="left" className="bg-sidebar">
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <DialogDescription className="sr-only">All sections of AYAVA Intern OS</DialogDescription>
          <div className="mb-2 px-1">
            <Brand organizationName={organizationName} />
          </div>
          <NavList nav={nav} onNavigate={() => setMenuOpen(false)} />
        </DialogContent>
      </Dialog>

      <CommandMenu open={searchOpen} onOpenChange={setSearchOpen} nav={nav} />
    </div>
  )
}
