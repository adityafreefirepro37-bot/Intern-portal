import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  CalendarPlus,
  ClipboardList,
  ClipboardPlus,
  Inbox,
  Palmtree,
  UserPlus,
  UsersRound,
} from 'lucide-react'
import { PhaseBadge } from '@/components/common/badges'
import { cn } from '@/lib/utils'

interface QuickAction {
  label: string
  icon: LucideIcon
  href?: string
  /** Set when the action ships in a later phase — rendered disabled. */
  phase?: string
}

/**
 * Shortcuts. Actions that are not built yet are shown disabled with the
 * phase that delivers them — they never pretend to work.
 */
export function QuickActions({ can }: { can: (permission: string) => boolean }) {
  const actions: QuickAction[] = [
    can('task.create') && { label: 'Create task', icon: ClipboardPlus, href: '/tasks' },
    can('task.read') && { label: 'Open My Work', icon: Inbox, href: '/my-work' },
    can('intern.create') && { label: 'Add intern', icon: UserPlus, href: '/interns/new' },
    can('onboarding.manage') && { label: 'Review onboarding', icon: ClipboardList, href: '/onboarding' },
    can('meeting.manage') && { label: 'Schedule meeting', icon: CalendarPlus, phase: '06' },
    can('leave.request') && { label: 'Request leave', icon: Palmtree, phase: '05' },
    can('team.read') && { label: 'Browse teams', icon: UsersRound, href: '/teams' },
    can('course.read') && { label: 'Open Learning Hub', icon: BookOpen, href: '/learning' },
  ].filter(Boolean) as QuickAction[]

  if (actions.length === 0) return null

  const base = 'flex h-10 w-full items-center gap-2.5 rounded-md border bg-card px-3 text-small font-medium'
  return (
    <ul className="grid gap-2">
      {actions.map(({ label, icon: Icon, href, phase }) => (
        <li key={label}>
          {href ? (
            <Link href={href} className={cn(base, 'transition-colors hover:bg-accent')}>
              <Icon className="size-4 text-muted-foreground" aria-hidden />
              {label}
            </Link>
          ) : (
            <span aria-disabled="true" className={cn(base, 'cursor-not-allowed text-muted-foreground')}>
              <Icon className="size-4" aria-hidden />
              {label}
              <PhaseBadge phase={phase ?? ''} className="ml-auto" />
              <span className="sr-only">(not available yet)</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
