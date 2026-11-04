'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Archive, ArchiveRestore, History, MessageSquarePlus, Pencil, Search, Trash2 } from 'lucide-react'
import { EditorDialog } from '@/components/forms/editor-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/features/auth/components/form-bits'
import { ConfirmActionButton } from '@/features/learning/components/confirm-action'
import { cn } from '@/lib/utils'
import { archiveConversationAction, deleteConversationAction, renameConversationAction } from '@/server/actions/ai'
import { AiChat, type AiChatProps } from './ai-chat'

export interface ConversationRow {
  id: string
  title: string | null
  context_type: string
  updated_at: Date | string
  archived_at: Date | string | null
}

/** The /ai page: conversation history beside the chat. */
export function AiWorkspace({
  conversations,
  activeId,
  archivedView,
  query,
  chat,
}: {
  conversations: ConversationRow[]
  activeId: string | null
  archivedView: boolean
  query: string
  chat: AiChatProps
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [historyOpen, setHistoryOpen] = React.useState(false)
  // Which chat is mounted. Opening another conversation (or a new one) remounts it to load
  // that history; the conversation this chat just started must not, or focus would be lost.
  const [instance, setInstance] = React.useState({ generation: 0, activeId, started: null as string | null })
  if (instance.activeId !== activeId) {
    const own = activeId !== null && activeId === instance.started
    setInstance({ generation: own ? instance.generation : instance.generation + 1, activeId, started: own ? instance.started : null })
  }

  const href =(next: Record<string, string | null>) => {
    const search = new URLSearchParams(params.toString())
    search.delete('q')
    for (const [key, value] of Object.entries(next)) {
      if (value) search.set(key, value)
      else search.delete(key)
    }
    const text = search.toString()
    return text ? `${pathname}?${text}` : pathname
  }

  const sidebar = (
    <nav aria-label="AI conversations" className="flex h-full min-h-0 flex-col gap-2">
      <Button asChild variant="outline" className="w-full justify-start">
        <Link href="/ai">
          <MessageSquarePlus aria-hidden /> New conversation
        </Link>
      </Button>
      <form action="/ai" role="search" className="relative">
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
        <Input name="search" type="search" aria-label="Search conversations" placeholder="Search…" defaultValue={query} className="pl-8" />
        {archivedView && <input type="hidden" name="archived" value="1" />}
      </form>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {conversations.length === 0 && (
          <li className="px-2 py-3 text-caption text-muted-foreground">
            {query ? 'No conversations match.' : archivedView ? 'Nothing archived.' : 'Your conversations will appear here.'}
          </li>
        )}
        {conversations.map((conversation) => (
          <li key={conversation.id} className={cn('group flex items-center rounded-md hover:bg-muted', conversation.id === activeId && 'bg-muted')}>
            <Link
              href={href({ c: conversation.id })}
              aria-current={conversation.id === activeId ? 'page' : undefined}
              className="min-w-0 flex-1 truncate px-2 py-1.5 text-small"
              onClick={() => setHistoryOpen(false)}
            >
              {conversation.title || 'Untitled conversation'}
            </Link>
            {conversation.id === activeId && <ConversationActions conversation={conversation} />}
          </li>
        ))}
      </ul>
      <Link href={archivedView ? '/ai' : '/ai?archived=1'} className="px-2 text-caption text-muted-foreground underline-offset-2 hover:underline">
        {archivedView ? 'Back to conversations' : 'View archived'}
      </Link>
    </nav>
  )

  return (
    <div className="grid h-[calc(100dvh-14rem)] min-h-[26rem] gap-4 md:h-[calc(100dvh-11rem)] lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden min-h-0 lg:block">{sidebar}</aside>
      <section className="flex min-h-0 flex-col rounded-xl border bg-card p-3 sm:p-4">
        <div className="mb-2 lg:hidden">
          <Button type="button" variant="ghost" size="sm" aria-expanded={historyOpen} onClick={() => setHistoryOpen((open) => !open)}>
            <History aria-hidden /> Conversations
          </Button>
          {historyOpen && <div className="mt-2 max-h-72 overflow-hidden rounded-lg border p-2">{sidebar}</div>}
        </div>
        <div className="min-h-0 flex-1">
          <AiChat
            key={instance.generation}
            {...chat}
            onConversationStarted={(id) => {
              setInstance((current) => ({ ...current, started: id }))
              window.history.replaceState(null, '', `/ai?c=${id}`)
              router.refresh()
            }}
          />
        </div>
      </section>
    </div>
  )
}

function ConversationActions({ conversation }: { conversation: ConversationRow }) {
  const router = useRouter()
  const archived = Boolean(conversation.archived_at)
  return (
    <span className="flex shrink-0 items-center pr-0.5">
      <EditorDialog
        title="Rename conversation"
        action={renameConversationAction}
        trigger={(open) => (
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Rename conversation" onClick={open}>
            <Pencil aria-hidden />
          </Button>
        )}
      >
        {(state) => (
          <>
            <input type="hidden" name="conversationId" value={conversation.id} />
            <Field label="Title" htmlFor="ai-rename" error={state.fields?.title}>
              <Input id="ai-rename" name="title" required maxLength={120} defaultValue={conversation.title ?? ''} />
            </Field>
          </>
        )}
      </EditorDialog>
      <ConfirmActionButton
        action={archiveConversationAction}
        fields={{ conversationId: conversation.id, archived: archived ? 'false' : 'true' }}
        title={archived ? 'Restore this conversation?' : 'Archive this conversation?'}
        description={archived ? 'It returns to your conversation list.' : 'It moves out of your list. You can still open it from Archived.'}
        confirmLabel={archived ? 'Restore' : 'Archive'}
        variant="ghost"
        size="icon-sm"
        aria-label={archived ? 'Restore conversation' : 'Archive conversation'}
      >
        {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
      </ConfirmActionButton>
      <ConfirmActionButton
        action={async (previous, data) => {
          const result = await deleteConversationAction(previous, data)
          if (result.status === 'success') router.push('/ai')
          return result
        }}
        fields={{ conversationId: conversation.id }}
        title="Delete this conversation?"
        description="This can’t be undone."
        confirmLabel="Delete"
        destructive
        variant="ghost"
        size="icon-sm"
        aria-label="Delete conversation"
      >
        <Trash2 aria-hidden />
      </ConfirmActionButton>
    </span>
  )
}
