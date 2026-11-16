import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Hash, Lock } from 'lucide-react'
import { AccessDenied } from '@/components/common/states'
import { Badge } from '@/components/ui/badge'
import { ChannelSettings } from '@/features/communication/components/channel-dialogs'
import { Chat } from '@/features/communication/components/chat'
import { ChannelList, MESSAGES_HEIGHT } from '@/features/communication/components/messages-layout'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { messageService } from '@/server/services/message.service'

export const metadata: Metadata = { title: 'Messages' }

export default async function ChannelPage({ params }: PageProps<'/messages/[channel]'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'message.read')) return <AccessDenied what="messages" />
  const { channel: key } = await params
  if (!/^[\w-]{1,100}$/.test(key)) notFound()
  const canSend = authorizationService.can(ctx, 'message.send')
  const canManage = authorizationService.can(ctx, 'channel.manage')
  // The poll cursor starts at render time, so nothing posted meanwhile is missed.
  const renderedAt = new Date().toISOString()
  let page: Awaited<ReturnType<typeof messageService.open>>
  try {
    page = await messageService.open(ctx, decodeURIComponent(key))
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    if (error instanceof ForbiddenError) return <AccessDenied what="this conversation" />
    throw error
  }
  const isGeneral = page.channel.type === 'GENERAL'
  const isDirect = page.channel.type === 'DIRECT'
  const [list, people, channelOptions] = await Promise.all([
    messageService.channels(ctx),
    canSend || isGeneral ? messageService.people(ctx) : Promise.resolve(null),
    canManage ? messageService.channelOptions(ctx) : Promise.resolve(null),
  ])
  const mentionable = (isGeneral ? (people ?? []) : page.members).filter((p) => p.id !== ctx.actor.userId)
  const Icon = isDirect ? null : isGeneral ? Hash : Lock

  return (
    <div className={cn('grid gap-4 md:grid-cols-[16rem_minmax(0,1fr)]', MESSAGES_HEIGHT)}>
      <div className="hidden min-h-0 md:block">
        <ChannelList {...list} activeId={page.channel.id} people={canSend ? people : null} channelOptions={channelOptions} />
      </div>
      <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card">
        <header className="flex items-center gap-2 border-b px-3 py-2.5 sm:px-4">
          <Link href="/messages" className="rounded-md p-1 hover:bg-accent md:hidden" aria-label="All conversations">
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
          {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-h3">{page.channel.name}</h1>
            {page.channel.description && (
              <p className="truncate text-caption text-muted-foreground">{page.channel.description}</p>
            )}
          </div>
          {page.channel.archived && <Badge variant="neutral">Archived</Badge>}
          {!isDirect && (
            <ChannelSettings
              channel={{ ...page.channel, name: page.channel.rawName }}
              members={page.members}
              people={people ?? []}
              canManage={page.canManage}
              meId={ctx.actor.userId}
            />
          )}
        </header>
        <Chat
          key={page.channel.id}
          channelId={page.channel.id}
          channelName={isDirect ? page.channel.name : `#${page.channel.name}`}
          initialMessages={page.messages}
          initialHasMore={page.hasMore}
          initialCursor={renderedAt}
          lastReadAt={page.lastReadAt}
          canPost={page.canPost}
          meId={ctx.actor.userId}
          mentionable={isDirect ? [] : mentionable}
          timeZone={ctx.organization.timezone}
          placeholder={isDirect ? `Message ${page.channel.name}` : `Message #${page.channel.name}`}
        />
      </section>
    </div>
  )
}
