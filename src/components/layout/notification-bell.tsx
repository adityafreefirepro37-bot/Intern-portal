'use client'

import { RelativeTime } from '@/components/common/relative-time'
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { markNotificationsReadAction } from '@/server/actions/work'

export interface ShellNotification {
  id: string
  title: string
  body: string | null
  read_at: Date | null
  created_at: Date
  href: string | null
}

/** In-app notifications (work events). Email and preferences arrive in Phase 06. */
export function NotificationBell({ items, unread }: { items: ShellNotification[]; unread: number }) {
  const router = useRouter()
  const [, startTransition] = React.useTransition()

  function markRead(id?: string) {
    const formData = new FormData()
    if (id) formData.set('notificationId', id)
    startTransition(async () => {
      await markNotificationsReadAction({ status: 'idle' }, formData)
      router.refresh()
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          className="relative"
        >
          <Bell aria-hidden />
          {unread > 0 && (
            <span
              className="tabular absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[0.625rem] font-semibold leading-4 text-primary-foreground"
              aria-hidden
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          Notifications
          {unread > 0 && (
            <button
              type="button"
              onClick={() => markRead()}
              className="text-caption font-medium text-primary hover:underline"
            >
              Mark all read
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <p className="px-2 pb-3 pt-1 text-small text-muted-foreground">You’re all caught up.</p>
        ) : (
          items.map((item) => (
            <DropdownMenuItem key={item.id} asChild className="items-start">
              <Link
                href={item.href ?? '#'}
                onClick={() => !item.read_at && markRead(item.id)}
                className={cn('flex flex-col items-start gap-0.5 whitespace-normal', !item.read_at && 'bg-accent/50')}
              >
                <span className={cn('text-small', !item.read_at && 'font-medium')}>{item.title}</span>
                <span className="text-caption text-muted-foreground">
                  {item.body ? `${item.body} · ` : ''}
                  <RelativeTime date={item.created_at} />
                </span>
              </Link>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
