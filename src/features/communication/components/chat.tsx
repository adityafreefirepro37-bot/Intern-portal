'use client'

import * as React from 'react'
import { AtSign, MoreHorizontal, Pencil, SendHorizontal, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/feedback/confirm-dialog'
import { useToast } from '@/components/feedback/toast'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { inputClassName, Textarea } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { MENTION_PATTERN, mentionToken } from '@/lib/communication/mentions'
import { cn, initials } from '@/lib/utils'
import {
  deleteMessageAction,
  editMessageAction,
  markChannelReadAction,
  sendMessageAction,
} from '@/server/actions/communication'
import type { ChatMessage } from '@/server/services/message.service'

const POLL_MS = 4000
const URL_PATTERN = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g

/** Text with highlighted @mentions and clickable links — never HTML. */
function MessageBody({ body, meId }: { body: string; meId: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  const pushText = (text: string, keyBase: number) => {
    let i = 0
    for (const piece of text.split(URL_PATTERN)) {
      if (!piece) continue
      parts.push(
        /^https?:\/\//.test(piece) ? (
          <a key={`${keyBase}-${i++}`} href={piece} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-primary underline">
            {piece}
          </a>
        ) : (
          <React.Fragment key={`${keyBase}-${i++}`}>{piece}</React.Fragment>
        ),
      )
    }
  }
  for (const match of body.matchAll(MENTION_PATTERN)) {
    if (match.index! > last) pushText(body.slice(last, match.index), last)
    parts.push(
      <span
        key={`m-${match.index}`}
        className={cn('rounded px-0.5 font-medium', match[2] === meId ? 'bg-warning/20 text-foreground' : 'bg-primary/10 text-primary')}
      >
        @{match[1]}
      </span>,
    )
    last = match.index! + match[0].length
  }
  if (last < body.length) pushText(body.slice(last), last)
  return <p className="whitespace-pre-wrap break-words text-small">{parts}</p>
}

function dayLabel(iso: string, timeZone: string) {
  const date = new Date(iso)
  const key = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(d)
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86_400_000)
  if (key(date) === key(today)) return 'Today'
  if (key(date) === key(yesterday)) return 'Yesterday'
  return new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone }).format(date)
}

function timeLabel(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso))
}

function merge(current: ChatMessage[], incoming: ChatMessage[]) {
  if (incoming.length === 0) return current
  const byId = new Map(current.map((m) => [m.id, m]))
  for (const m of incoming) {
    const existing = byId.get(m.id)
    if (!existing || existing.updatedAt <= m.updatedAt) byId.set(m.id, m)
  }
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export interface MentionTarget {
  id: string
  name: string
}

export function Chat({
  channelId,
  channelName,
  initialMessages,
  initialHasMore,
  initialCursor,
  lastReadAt,
  canPost,
  meId,
  mentionable,
  timeZone,
  placeholder,
}: {
  channelId: string
  channelName: string
  initialMessages: ChatMessage[]
  initialHasMore: boolean
  initialCursor: string
  lastReadAt: string | null
  canPost: boolean
  meId: string
  mentionable: MentionTarget[]
  timeZone: string
  placeholder: string
}) {
  const { toast } = useToast()
  const [messages, setMessages] = React.useState(initialMessages)
  const [hasMore, setHasMore] = React.useState(initialHasMore)
  const [loadingOlder, setLoadingOlder] = React.useState(false)
  const [body, setBody] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [editing, setEditing] = React.useState<{ id: string; body: string } | null>(null)
  const [deleting, setDeleting] = React.useState<string | null>(null)
  const cursor = React.useRef(initialCursor)
  const scroller = React.useRef<HTMLDivElement>(null)
  const textarea = React.useRef<HTMLTextAreaElement>(null)
  const nearBottom = React.useRef(true)
  const [unreadFrom] = React.useState(lastReadAt)

  const scrollToBottom = React.useCallback((smooth = false) => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  React.useEffect(() => {
    scrollToBottom()
    void markChannelReadAction({ channelId })
  }, [channelId, scrollToBottom])

  // Poll for new, edited and deleted messages while the tab is visible.
  React.useEffect(() => {
    let stopped = false
    let inFlight = false
    async function poll() {
      if (stopped || inFlight || document.hidden) return
      inFlight = true
      try {
        const response = await fetch(`/api/messages/${channelId}?since=${encodeURIComponent(cursor.current)}`, {
          cache: 'no-store',
        })
        if (!response.ok) return
        const json = (await response.json()) as { success: boolean; data?: { messages: ChatMessage[]; cursor: string } }
        if (!json.success || !json.data) return
        cursor.current = json.data.cursor
        if (json.data.messages.length) {
          const fromOthers = json.data.messages.some((m) => m.sender.id !== meId && !m.deleted)
          const stick = nearBottom.current
          setMessages((current) => merge(current, json.data!.messages))
          if (stick) requestAnimationFrame(() => scrollToBottom(true))
          if (fromOthers) void markChannelReadAction({ channelId })
        }
      } catch {
        // Offline or a transient error: try again on the next tick.
      } finally {
        inFlight = false
      }
    }
    const timer = window.setInterval(poll, POLL_MS)
    const onVisible = () => !document.hidden && void poll()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [channelId, meId, scrollToBottom])

  async function loadOlder() {
    if (!messages.length) return
    setLoadingOlder(true)
    const el = scroller.current
    const previousHeight = el?.scrollHeight ?? 0
    try {
      const response = await fetch(`/api/messages/${channelId}?before=${encodeURIComponent(messages[0].createdAt)}`, { cache: 'no-store' })
      const json = (await response.json()) as { success: boolean; data?: { messages: ChatMessage[]; hasMore: boolean } }
      if (json.success && json.data) {
        setMessages((current) => merge(current, json.data!.messages))
        setHasMore(json.data.hasMore)
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight - previousHeight
        })
      }
    } finally {
      setLoadingOlder(false)
    }
  }

  async function send() {
    const text = body.trim()
    if (!text || sending) return
    setSending(true)
    const result = await sendMessageAction({ channelId, body: text })
    setSending(false)
    if (result.status === 'success' && result.data) {
      setBody('')
      setMessages((current) => merge(current, [result.data!]))
      requestAnimationFrame(() => scrollToBottom(true))
      textarea.current?.focus()
    } else {
      toast({ title: result.message ?? 'Message not sent', variant: 'error' })
    }
  }

  async function saveEdit() {
    if (!editing) return
    const result = await editMessageAction({ messageId: editing.id, body: editing.body })
    if (result.status === 'success' && result.data) {
      setMessages((current) => merge(current, [result.data!]))
      setEditing(null)
    } else {
      toast({ title: result.message ?? 'Could not save the change', variant: 'error' })
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    const result = await deleteMessageAction({ messageId: deleting })
    if (result.status === 'success') {
      setMessages((current) =>
        current.map((m) => (m.id === deleting ? { ...m, deleted: true, body: '', canEdit: false, canDelete: false } : m)),
      )
    } else {
      toast({ title: result.message ?? 'Could not delete the message', variant: 'error' })
    }
  }

  function insertMention(personId: string) {
    const person = mentionable.find((p) => p.id === personId)
    if (!person) return
    const el = textarea.current
    const at = el?.selectionStart ?? body.length
    const token = mentionToken(person.name, person.id)
    setBody((current) => current.slice(0, at) + token + current.slice(at))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(at + token.length, at + token.length)
    })
  }

  // The "New" divider sits above the first message from someone else since the last visit.
  const firstUnreadId =
    unreadFrom === null
      ? undefined
      : messages.find((m) => m.sender.id !== meId && m.createdAt > unreadFrom && !m.deleted)?.id
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5"
        role="log"
        aria-live="polite"
        aria-label={`Messages in ${channelName}`}
      >
        {hasMore && (
          <div className="mb-4 text-center">
            <Button variant="ghost" size="sm" onClick={loadOlder} disabled={loadingOlder}>
              {loadingOlder ? 'Loading…' : 'Load earlier messages'}
            </Button>
          </div>
        )}
        {messages.length === 0 && (
          <p className="py-16 text-center text-small text-muted-foreground">No messages yet. Say hello!</p>
        )}
        <ol className="space-y-1">
          {messages.map((m, index) => {
            const day = dayLabel(m.createdAt, timeZone)
            const prev = messages[index - 1]
            const showDay = !prev || dayLabel(prev.createdAt, timeZone) !== day
            const grouped =
              !showDay &&
              prev.sender.id === m.sender.id &&
              new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000
            const showUnread = m.id === firstUnreadId
            return (
              <li key={m.id}>
                {showDay && (
                  <div className="my-4 flex items-center gap-3 text-caption font-medium text-muted-foreground" role="separator">
                    <span className="h-px flex-1 bg-border" />
                    {day}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                )}
                {showUnread && (
                  <div className="my-2 flex items-center gap-3 text-caption font-medium text-destructive" role="separator">
                    <span className="h-px flex-1 bg-destructive/40" />
                    New
                    <span className="h-px flex-1 bg-destructive/40" />
                  </div>
                )}
                <article className={cn('group flex gap-3 rounded-md px-2 py-1 hover:bg-accent/40', grouped ? 'mt-0' : 'mt-2')}>
                  <div className="w-8 shrink-0">
                    {!grouped && (
                      <Avatar className="size-8">
                        {m.sender.avatarUrl && <AvatarImage src={m.sender.avatarUrl} alt="" />}
                        <AvatarFallback aria-hidden>{initials(m.sender.name)}</AvatarFallback>
                      </Avatar>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    {!grouped && (
                      <p className="flex items-baseline gap-2">
                        <span className="text-small font-semibold">{m.sender.name}</span>
                        <time dateTime={m.createdAt} className="text-caption text-muted-foreground">
                          {timeLabel(m.createdAt, timeZone)}
                        </time>
                      </p>
                    )}
                    {m.deleted ? (
                      <p className="text-small italic text-muted-foreground">This message was deleted.</p>
                    ) : editing?.id === m.id ? (
                      <div className="mt-1 grid gap-2">
                        <Textarea
                          value={editing.body}
                          onChange={(e) => setEditing({ id: m.id, body: e.target.value })}
                          rows={3}
                          maxLength={4000}
                          aria-label="Edit message"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') setEditing(null)
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              void saveEdit()
                            }
                          }}
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={saveEdit}>
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <MessageBody body={m.body} meId={meId} />
                        {m.edited && <span className="text-caption text-muted-foreground">(edited)</span>}
                      </>
                    )}
                  </div>
                  {(m.canEdit || m.canDelete) && editing?.id !== m.id && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 data-[state=open]:opacity-100"
                          aria-label="Message options"
                        >
                          <MoreHorizontal aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {m.canEdit && (
                          <DropdownMenuItem onSelect={() => setEditing({ id: m.id, body: m.body })}>
                            <Pencil aria-hidden /> Edit
                          </DropdownMenuItem>
                        )}
                        {m.canDelete && (
                          <DropdownMenuItem onSelect={() => setDeleting(m.id)} className="text-destructive">
                            <Trash2 aria-hidden /> Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </article>
              </li>
            )
          })}
        </ol>
      </div>

      {canPost ? (
        <form
          className="border-t bg-card p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <Textarea
            ref={textarea}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send()
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder={placeholder}
            aria-label={`Message ${channelName}`}
            className="resize-none"
          />
          <div className="mt-2 flex items-center gap-2">
            {mentionable.length > 0 && (
              <label className="flex items-center gap-1.5 text-caption text-muted-foreground">
                <AtSign className="size-3.5" aria-hidden />
                <select
                  value=""
                  onChange={(e) => insertMention(e.target.value)}
                  className={cn(inputClassName, 'h-8 w-auto max-w-44 text-caption')}
                  aria-label="Mention someone"
                >
                  <option value="">Mention…</option>
                  {mentionable.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <span className="ml-auto hidden text-caption text-muted-foreground sm:inline">Enter to send · Shift+Enter for a new line</span>
            <Button type="submit" size="sm" disabled={sending || !body.trim()}>
              <SendHorizontal aria-hidden /> Send
            </Button>
          </div>
        </form>
      ) : (
        <p className="border-t bg-muted/40 p-3 text-center text-small text-muted-foreground">
          You can read this channel but not post in it.
        </p>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this message?"
        description="Everyone in the conversation will see that a message was deleted."
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  )
}
