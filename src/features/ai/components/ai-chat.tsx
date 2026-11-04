'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowUp, BookOpen, Check, Copy, FileText, GraduationCap, Sparkles, Square, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useToast } from '@/components/feedback/toast'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import type { AiContextKind } from '@/lib/ai/router'
import { cn } from '@/lib/utils'
import { messageFeedbackAction } from '@/server/actions/ai'
import type { ActionProposal } from '@/server/ai/actions.service'
import type { ChatEvent, SourceRef } from '@/server/ai/chat.service'
import { ActionCard } from './action-card'
import { Markdown } from './markdown'

export interface ChatMessageView {
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  sources?: SourceRef[]
  feedback?: 'HELPFUL' | 'NOT_HELPFUL' | null
  proposal?: ActionProposal | null
  error?: boolean
  pending?: boolean
}

export interface AiChatProps {
  conversationId?: string | null
  initialMessages?: ChatMessageView[]
  contextType?: AiContextKind
  contextId?: string | null
  contextLabel?: string | null
  suggestions?: string[]
  /** Empty-state heading, e.g. "Good morning, Asha." */
  greeting?: string
  allowStudyMode?: boolean
  /** Sent automatically once (from ?q= or the command menu). */
  autoAsk?: string | null
  /** Reports a newly created conversation so the page can update its address and list. */
  onConversationStarted?: (id: string) => void
  compact?: boolean
  disabledReason?: string | null
}

const newId = () => `local-${Math.random().toString(36).slice(2)}`

export function AiChat({
  conversationId: initialConversationId = null,
  initialMessages = [],
  contextType = 'GLOBAL',
  contextId = null,
  contextLabel = null,
  suggestions = [],
  greeting,
  allowStudyMode = false,
  autoAsk = null,
  onConversationStarted,
  compact = false,
  disabledReason = null,
}: AiChatProps) {
  const [messages, setMessages] = React.useState<ChatMessageView[]>(initialMessages)
  const [input, setInput] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [announcement, setAnnouncement] = React.useState('')
  const [studyMode, setStudyMode] = React.useState(false)
  const conversationRef = React.useRef<string | null>(initialConversationId)
  const abortRef = React.useRef<AbortController | null>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const askedRef = React.useRef(false)
  const inputId = React.useId()

  React.useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [messages])

  const patchLast = React.useCallback((patch: (message: ChatMessageView) => ChatMessageView) => {
    setMessages((current) => current.map((m, i) => (i === current.length - 1 ? patch(m) : m)))
  }, [])

  const send = React.useCallback(
    async (text: string) => {
      const question = text.trim()
      if (!question || abortRef.current) return
      const controller = new AbortController()
      abortRef.current = controller
      setBusy(true)
      setInput('')
      setAnnouncement('AYAVA AI is working…')
      setMessages((current) => [
        ...current,
        { id: newId(), role: 'USER', content: question },
        { id: newId(), role: 'ASSISTANT', content: '', pending: true },
      ])
      let startedConversation: string | null = null
      try {
        const response = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            conversationId: conversationRef.current,
            message: question,
            contextType,
            contextId,
            ...(studyMode ? { studyMode: true } : {}),
          }),
        })
        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
          throw new Error(body?.error?.message ?? 'Something went wrong. Try again.')
        }
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.trim()) continue
            const event = JSON.parse(line) as ChatEvent
            if (event.type === 'start') {
              if (!conversationRef.current) startedConversation = event.conversationId
              conversationRef.current = event.conversationId
            } else if (event.type === 'meta') {
              patchLast((m) => ({ ...m, sources: event.sources }))
            } else if (event.type === 'delta') {
              patchLast((m) => ({ ...m, content: m.content + event.text, pending: true }))
            } else if (event.type === 'action') {
              patchLast((m) => ({ ...m, proposal: event.proposal }))
            } else if (event.type === 'done') {
              patchLast((m) => ({ ...m, id: event.messageId, pending: false }))
              setAnnouncement('Answer ready.')
            } else if (event.type === 'error') {
              patchLast((m) => ({ ...m, content: event.message, error: true, pending: false }))
              setAnnouncement(event.message)
            }
          }
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          patchLast((m) => ({ ...m, pending: false, content: m.content || 'Stopped.' }))
          setAnnouncement('Stopped.')
        } else {
          const message = error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.'
          patchLast((m) => ({ ...m, content: message, error: true, pending: false }))
          setAnnouncement(message)
        }
      } finally {
        patchLast((m) => (m.pending ? { ...m, pending: false } : m))
        abortRef.current = null
        setBusy(false)
        inputRef.current?.focus()
        if (startedConversation) onConversationStarted?.(startedConversation)
      }
    },
    [contextId, contextType, onConversationStarted, patchLast, studyMode],
  )

  React.useEffect(() => {
    if (!autoAsk || askedRef.current || disabledReason) return
    askedRef.current = true
    void send(autoAsk)
  }, [autoAsk, disabledReason, send])

  const empty = messages.length === 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      {contextLabel && (
        <p className="mb-2 flex items-center gap-1.5 text-caption text-muted-foreground">
          <FileText className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">Asking about: {contextLabel}</span>
        </p>
      )}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        role="log"
        aria-label="Conversation with AYAVA AI"
        aria-busy={busy}
        tabIndex={0}
      >
        {empty ? (
          <div className={cn('mx-auto flex max-w-xl flex-col items-center gap-4 py-8 text-center', compact && 'py-4')}>
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Sparkles className="size-5" aria-hidden />
            </span>
            <div>
              {greeting && <h2 className="text-h3">{greeting}</h2>}
              <p className="mt-1 text-small text-muted-foreground">
                {disabledReason ?? 'Ask AYAVA AI anything about your work, learning, projects, or company knowledge.'}
              </p>
            </div>
            {!disabledReason && suggestions.length > 0 && (
              <ul className="flex flex-wrap justify-center gap-2" aria-label="Suggested questions">
                {suggestions.map((suggestion) => (
                  <li key={suggestion}>
                    <Button type="button" variant="outline" size="sm" className="h-auto whitespace-normal py-1.5 text-left" onClick={() => void send(suggestion)}>
                      {suggestion}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <ul className="space-y-4 pb-2 pr-1">
            {messages.map((message) => (
              <li key={message.id}>{message.role === 'USER' ? <UserBubble text={message.content} /> : <AssistantMessage message={message} />}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Announced once per state change, not for every streamed word. */}
      <p className="sr-only" aria-live="polite" role="status">
        {announcement}
      </p>

      <form
        className="mt-3 shrink-0"
        onSubmit={(event) => {
          event.preventDefault()
          void send(input)
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Ask AYAVA AI
        </label>
        <div className="flex items-end gap-2 rounded-xl border bg-card p-2 focus-within:ring-2 focus-within:ring-ring">
          <Textarea
            id={inputId}
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void send(input)
              }
            }}
            rows={1}
            maxLength={4000}
            disabled={Boolean(disabledReason)}
            placeholder="Ask AYAVA AI…"
            className="max-h-40 min-h-9 flex-1 resize-none border-0 bg-transparent p-1.5 shadow-none focus-visible:ring-0"
          />
          {busy ? (
            <Button type="button" variant="outline" size="icon" aria-label="Stop generating" onClick={() => abortRef.current?.abort()}>
              <Square aria-hidden className="size-3.5" />
            </Button>
          ) : (
            <Button type="submit" size="icon" aria-label="Send" disabled={!input.trim() || Boolean(disabledReason)}>
              <ArrowUp aria-hidden />
            </Button>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-caption text-muted-foreground">
          <span>AI can make mistakes. Check important details. Enter to send, Shift+Enter for a new line.</span>
          {allowStudyMode && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" className="size-3.5" checked={studyMode} onChange={(event) => setStudyMode(event.target.checked)} />
              <GraduationCap className="size-3.5" aria-hidden />
              Study mode
            </label>
          )}
        </div>
      </form>
    </div>
  )
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-small text-primary-foreground [overflow-wrap:anywhere]">
        {text}
      </p>
    </div>
  )
}

function AssistantMessage({ message }: { message: ChatMessageView }) {
  const sources = message.sources ?? []
  const saved = !message.id.startsWith('local-')
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
        <Sparkles className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 space-y-2.5">
        {message.pending && !message.content ? (
          <p className="text-small text-muted-foreground motion-safe:animate-pulse">AYAVA AI is working…</p>
        ) : message.error ? (
          <p className="text-small text-destructive">{message.content}</p>
        ) : (
          <Markdown text={message.content} citations={sources} />
        )}
        {message.proposal && <ActionCard initial={message.proposal} />}
        {sources.length > 0 && <SourceList sources={sources} />}
        {saved && !message.pending && !message.error && <MessageTools message={message} />}
      </div>
    </div>
  )
}

function SourceList({ sources }: { sources: SourceRef[] }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-2.5">
      <p className="mb-1.5 flex items-center gap-1.5 text-caption font-semibold text-muted-foreground">
        <BookOpen className="size-3.5" aria-hidden />
        Sources
      </p>
      <ol className="space-y-1 text-caption">
        {sources.map((source) => (
          <li key={source.n} className="flex gap-1.5">
            <span className="tabular shrink-0 font-semibold text-primary">{source.n}.</span>
            <Link href={source.href} className="underline-offset-2 hover:underline">
              {source.title}
              {source.version > 1 && ` (v${source.version})`}
              {source.heading && <span className="text-muted-foreground"> — {source.heading}</span>}
              {source.page && <span className="text-muted-foreground"> · page {source.page}</span>}
              {source.effectiveDate && <span className="text-muted-foreground"> · effective {source.effectiveDate}</span>}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  )
}

function MessageTools({ message }: { message: ChatMessageView }) {
  const { toast } = useToast()
  const router = useRouter()
  const [copied, setCopied] = React.useState(false)
  const [rating, setRating] = React.useState(message.feedback ?? null)

  async function rate(value: 'HELPFUL' | 'NOT_HELPFUL') {
    setRating(value)
    const data = new FormData()
    data.set('messageId', message.id)
    data.set('rating', value)
    const result = await messageFeedbackAction({ status: 'idle' }, data)
    if (result.status === 'error') {
      setRating(message.feedback ?? null)
      toast({ title: result.message ?? 'Couldn’t save that', variant: 'error' })
    } else {
      router.refresh()
    }
  }

  return (
    <div className="flex items-center gap-0.5 text-muted-foreground">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={copied ? 'Copied' : 'Copy answer'}
        onClick={() => {
          void navigator.clipboard.writeText(message.content).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          })
        }}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Helpful" aria-pressed={rating === 'HELPFUL'} className={cn(rating === 'HELPFUL' && 'text-primary')} onClick={() => void rate('HELPFUL')}>
        <ThumbsUp aria-hidden />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Not helpful" aria-pressed={rating === 'NOT_HELPFUL'} className={cn(rating === 'NOT_HELPFUL' && 'text-primary')} onClick={() => void rate('NOT_HELPFUL')}>
        <ThumbsDown aria-hidden />
      </Button>
    </div>
  )
}
