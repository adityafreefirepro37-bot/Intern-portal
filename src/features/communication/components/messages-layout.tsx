import Link from 'next/link'
import { Archive, Hash, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NewChannel, NewDirectMessage, type ChannelOptions } from './channel-dialogs'

export interface ChannelListItem {
  id: string
  slug: string
  name: string
  type: string
  archived: boolean
  unread: number
}

function ChannelLink({ item, active }: { item: ChannelListItem; active: boolean }) {
  const Icon = item.type === 'DIRECT' ? null : item.archived ? Archive : item.type === 'GENERAL' ? Hash : Lock
  return (
    <li>
      <Link
        href={`/messages/${item.slug}`}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1.5 text-small hover:bg-accent',
          active && 'bg-accent font-medium',
          item.unread > 0 && 'font-semibold',
        )}
      >
        {Icon ? (
          <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <span className="size-2 shrink-0 rounded-full bg-success/60" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate">{item.name}</span>
        {item.unread > 0 && (
          <span className="tabular rounded-full bg-primary px-1.5 text-[0.6875rem] font-semibold text-primary-foreground">
            {item.unread > 99 ? '99+' : item.unread}
            <span className="sr-only"> unread</span>
          </span>
        )}
      </Link>
    </li>
  )
}

/** Channel and conversation list; on phones it's its own page (/messages). */
export function ChannelList({
  channels,
  direct,
  archived,
  activeId,
  people,
  channelOptions,
}: {
  channels: ChannelListItem[]
  direct: ChannelListItem[]
  archived: ChannelListItem[]
  activeId?: string
  people: { id: string; name: string }[] | null
  channelOptions: ChannelOptions | null
}) {
  return (
    <nav aria-label="Conversations" className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto rounded-xl border bg-card p-3">
      <section>
        <div className="mb-1 flex items-center justify-between px-2">
          <h2 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">Channels</h2>
          {channelOptions && <NewChannel options={channelOptions} />}
        </div>
        {channels.length === 0 ? (
          <p className="px-2 text-caption text-muted-foreground">No channels yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {channels.map((c) => (
              <ChannelLink key={c.id} item={c} active={c.id === activeId} />
            ))}
          </ul>
        )}
      </section>
      <section>
        <div className="mb-1 flex items-center justify-between px-2">
          <h2 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">Direct messages</h2>
          {people && <NewDirectMessage people={people} />}
        </div>
        {direct.length === 0 ? (
          <p className="px-2 text-caption text-muted-foreground">Start a conversation with the + button.</p>
        ) : (
          <ul className="space-y-0.5">
            {direct.map((c) => (
              <ChannelLink key={c.id} item={c} active={c.id === activeId} />
            ))}
          </ul>
        )}
      </section>
      {archived.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer px-2 text-caption font-semibold uppercase tracking-wide text-muted-foreground">
            Archived ({archived.length})
          </summary>
          <ul className="mt-1 space-y-0.5">
            {archived.map((c) => (
              <ChannelLink key={c.id} item={c} active={c.id === activeId} />
            ))}
          </ul>
        </details>
      )}
    </nav>
  )
}

/** Fits the viewport below the top bar and above the phone's bottom navigation. */
export const MESSAGES_HEIGHT = 'h-[calc(100dvh-13rem)] min-h-[24rem] md:h-[calc(100dvh-10.5rem)]'
