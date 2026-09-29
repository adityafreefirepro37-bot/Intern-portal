import { EmptyState } from '@/components/common/states'
import { UserAvatar } from '@/components/common/user-avatar'
import { fullName, timeAgo } from '@/lib/utils'
import { describeActivity } from './work-badges'

type Actor = { first_name: string; last_name: string; display_name: string | null; avatar_url: string | null } | null

export interface ActivityEntry {
  id: string
  action: string
  metadata: Record<string, unknown>
  created_at?: Date
  createdAt?: Date
  actor: Actor
}

/** Timeline of audit entries (projects and tasks) — the audit log is the single source. */
export function ActivityList({ entries, compact = false }: { entries: ActivityEntry[]; compact?: boolean }) {
  if (entries.length === 0) return <EmptyState title="No activity yet" compact />
  const now = new Date()
  return (
    <ol className="space-y-3">
      {entries.map((entry) => {
        const when = entry.created_at ?? entry.createdAt ?? now
        const reason = typeof entry.metadata.reason === 'string' ? entry.metadata.reason : null
        return (
          <li key={entry.id} className="flex gap-3">
            {entry.actor ? (
              <UserAvatar person={entry.actor} className="size-7" />
            ) : (
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-caption"
                aria-hidden
              >
                ⚙
              </span>
            )}
            <div className="min-w-0 text-small">
              <p>
                <span className="font-medium">{entry.actor ? fullName(entry.actor) : 'System'}</span>{' '}
                {describeActivity(entry.action, entry.metadata)}
              </p>
              {!compact && reason && <p className="text-caption text-muted-foreground">“{reason}”</p>}
              <p className="text-caption text-muted-foreground">
                <time dateTime={new Date(when).toISOString()}>{timeAgo(new Date(when), now)}</time>
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
