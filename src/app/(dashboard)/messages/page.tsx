import type { Metadata } from 'next'
import { MessagesSquare } from 'lucide-react'
import { EmptyState, AccessDenied } from '@/components/common/states'
import { ChannelList, MESSAGES_HEIGHT } from '@/features/communication/components/messages-layout'
import { cn } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { messageService } from '@/server/services/message.service'

export const metadata: Metadata = { title: 'Messages' }

/** Conversation list (the whole page on phones; beside an empty pane on larger screens). */
export default async function MessagesPage() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'message.read')) return <AccessDenied what="messages" />
  const canSend = authorizationService.can(ctx, 'message.send')
  const canManage = authorizationService.can(ctx, 'channel.manage')
  const [list, people, channelOptions] = await Promise.all([
    messageService.channels(ctx),
    canSend ? messageService.people(ctx) : Promise.resolve(null),
    canManage ? messageService.channelOptions(ctx) : Promise.resolve(null),
  ])
  return (
    <>
      <h1 className="mb-4 text-h1">Messages</h1>
      <div className={cn('grid gap-4 md:grid-cols-[16rem_minmax(0,1fr)]', MESSAGES_HEIGHT)}>
        <ChannelList {...list} people={people} channelOptions={channelOptions} />
        <section className="hidden items-center justify-center rounded-xl border bg-card md:flex">
          <EmptyState
            icon={MessagesSquare}
            title="Pick a conversation"
            description={
              list.channels.length
                ? 'Choose a channel or start a direct message.'
                : 'No channels yet. Start a direct message with the + next to “Direct messages”.'
            }
          />
        </section>
      </div>
    </>
  )
}
