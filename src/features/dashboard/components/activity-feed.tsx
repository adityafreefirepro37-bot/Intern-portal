import { History } from 'lucide-react'
import { EmptyState } from '@/components/common/states'
import { UserAvatar } from '@/components/common/user-avatar'
import { fullName, humanizeEnum, timeAgo } from '@/lib/utils'
import type { DashboardOverview } from '@/server/services/dashboard.service'

type Activity = NonNullable<DashboardOverview['activity']>[number]

const KNOWN_ACTIONS: Record<string, string> = {
  'project.created': 'created a project',
  'intern.onboarding_started': 'started onboarding for an intern',
  'task.submitted': 'submitted a task for review',
  'task.changes_requested': 'requested changes on a task',
  'announcement.published': 'published an announcement',
}

/** "project.archived" → "archived a project" for actions without a phrase. */
export function describeAction(action: string, resourceType: string): string {
  if (KNOWN_ACTIONS[action]) return KNOWN_ACTIONS[action]
  const verb = action.split('.').pop() ?? action
  return `${humanizeEnum(verb).toLowerCase()} ${humanizeEnum(resourceType).toLowerCase()}`
}

export function ActivityFeed({ items, now }: { items: Activity[]; now: Date }) {
  if (items.length === 0) {
    return (
      <EmptyState
        compact
        icon={History}
        title="No activity yet"
        description="Changes across the workspace appear here."
      />
    )
  }
  return (
    <ol className="space-y-4">
      {items.map((item) => (
        <li key={item.id} className="flex gap-3">
          {item.actor ? (
            <UserAvatar person={item.actor} className="size-7" />
          ) : (
            <span className="size-7 shrink-0 rounded-full bg-muted" aria-hidden />
          )}
          <div className="min-w-0 text-small">
            <p>
              <span className="font-medium">{item.actor ? fullName(item.actor) : 'System'}</span>{' '}
              <span className="text-muted-foreground">{describeAction(item.action, item.resource_type)}</span>
            </p>
            <time dateTime={item.created_at.toISOString()} className="text-caption text-muted-foreground">
              {timeAgo(item.created_at, now)}
            </time>
          </div>
        </li>
      ))}
    </ol>
  )
}
