'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { Bell, KeyRound, LogOut, Menu, Search, UserRound } from 'lucide-react'
import { PhaseBadge } from '@/components/common/badges'
import { UserAvatar } from '@/components/common/user-avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Kbd } from '@/components/ui/misc'
import { signOutAction } from '@/server/actions/auth'
import { Brand } from './brand'

export interface ShellUser {
  displayName: string
  email: string
  avatarUrl: string | null
  roleNames: string[]
}

export function Topbar({
  user,
  organizationName,
  onOpenMenu,
  onOpenSearch,
}: {
  user: ShellUser
  organizationName: string
  onOpenMenu: () => void
  onOpenSearch: () => void
}) {
  const [signingOut, startSignOut] = useTransition()
  const [firstName, ...rest] = user.displayName.split(' ')
  const person = { first_name: firstName ?? '', last_name: rest.join(' '), avatar_url: user.avatarUrl }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur sm:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="-ml-2 md:hidden"
        onClick={onOpenMenu}
        aria-label="Open navigation menu"
      >
        <Menu aria-hidden />
      </Button>
      <div className="md:hidden">
        <Brand collapsed organizationName={organizationName} />
      </div>

      <button
        type="button"
        onClick={onOpenSearch}
        className="ml-auto flex h-9 items-center gap-2 rounded-md border border-input bg-card px-3 text-small text-muted-foreground shadow-xs transition-colors hover:bg-accent md:ml-0 md:w-full md:max-w-sm"
        aria-label="Search (Ctrl+K)"
      >
        <Search className="size-4" aria-hidden />
        <span className="hidden flex-1 text-left md:inline">Search…</span>
        <span className="hidden items-center gap-0.5 md:flex" aria-hidden>
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="flex items-center gap-1 md:ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Notifications">
              <Bell aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel className="flex items-center justify-between">
              Notifications <PhaseBadge phase="06" />
            </DropdownMenuLabel>
            <p className="px-2 pb-3 pt-1 text-small text-muted-foreground">
              In-app notifications arrive in Phase 06. Nothing is being missed in the meantime.
            </p>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2.5 rounded-full p-0.5 pr-0.5 transition-colors hover:bg-accent sm:rounded-lg sm:pr-2"
              aria-label={`Account menu for ${user.displayName}`}
            >
              <UserAvatar person={person} className="size-8" />
              <span className="hidden text-left leading-tight lg:block">
                <span className="block text-small font-medium">{user.displayName}</span>
                <span className="block text-caption text-muted-foreground">
                  {user.roleNames.join(', ') || 'No role'}
                </span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-foreground">
              <span className="block text-small font-medium">{user.displayName}</span>
              <span className="block truncate text-caption font-normal text-muted-foreground">{user.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/profile">
                <UserRound aria-hidden /> My profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/security">
                <KeyRound aria-hidden /> Security &amp; sessions
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/*
              Sign-out calls the server action (a same-origin POST, so it can't be
              triggered cross-site). It's invoked directly on select because the menu
              unmounts before a nested <form> would get to submit.
            */}
            <DropdownMenuItem
              disabled={signingOut}
              onSelect={(event) => {
                event.preventDefault()
                startSignOut(() => signOutAction())
              }}
            >
              <LogOut aria-hidden /> {signingOut ? 'Signing out…' : 'Sign out'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
