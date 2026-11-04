import type { Metadata } from 'next'
import Link from 'next/link'
import { BookOpen, Settings2 } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { Button } from '@/components/ui/button'
import { AiWorkspace } from '@/features/ai/components/ai-workspace'
import type { ChatMessageView } from '@/features/ai/components/ai-chat'
import { NOT_CONFIGURED_MESSAGE } from '@/lib/ai/prompts'
import { AI_CONTEXT_TYPES, type AiContextKind } from '@/lib/ai/router'
import { AppError } from '@/lib/errors'
import { firstParam } from '@/lib/validation/list-params'
import { requirePageContext } from '@/server/context'
import type { SourceRef } from '@/server/ai/chat.service'
import { aiConversationService } from '@/server/ai/conversation.service'
import { aiSettingsService } from '@/server/ai/settings.service'
import { CONTEXT_PROMPTS, suggestedPrompts } from '@/server/ai/suggestions'
import { getAIProvider } from '@/server/ai/provider'
import { authorizationService } from '@/server/services/authorization.service'

export const metadata: Metadata = { title: 'AYAVA AI' }

function greetingFor(name: string, timeZone: string) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date()))
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  return `${part}, ${name.split(' ')[0]}.`
}

export default async function AiPage({ searchParams }: PageProps<'/ai'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'ai.use')) return <AccessDenied what="AYAVA AI" />

  const params = await searchParams
  const activeId = firstParam(params, 'c') ?? null
  const search = firstParam(params, 'search') ?? ''
  const archived = firstParam(params, 'archived') === '1'
  const ask = firstParam(params, 'q') ?? null
  const rawContext = firstParam(params, 'context')
  const contextType = AI_CONTEXT_TYPES.find((type) => type === rawContext) as AiContextKind | undefined
  const contextId = firstParam(params, 'id') ?? null

  const [conversations, settings, active] = await Promise.all([
    aiConversationService.list(ctx, { q: search, archived }),
    aiSettingsService.get(ctx.organization.id),
    activeId
      ? aiConversationService.get(ctx, activeId).catch((error: unknown) => {
          if (error instanceof AppError && error.status < 500) return null
          throw error
        })
      : Promise.resolve(null),
  ])

  const proposals = new Map((active?.proposals ?? []).map((p) => [p.messageId, p.proposal]))
  const initialMessages: ChatMessageView[] = (active?.messages ?? []).map((message) => {
    const metadata = (message.metadata ?? {}) as { sources?: SourceRef[] }
    return {
      id: message.id,
      role: message.role as 'USER' | 'ASSISTANT',
      content: message.content,
      sources: metadata.sources,
      feedback: message.feedback,
      proposal: proposals.get(message.id) ?? null,
    }
  })

  const disabledReason = !getAIProvider()
    ? NOT_CONFIGURED_MESSAGE
    : !settings.enabled
      ? 'AYAVA AI is turned off for your organization.'
      : null

  return (
    <>
      <PageHeader
        title="AYAVA AI"
        description="Ask about your work, learning, projects and company knowledge. It only sees what you can see."
        className="mb-4 sm:mb-4"
        actions={
          <div className="flex flex-wrap gap-2">
            {authorizationService.can(ctx, 'knowledge.read') && (
              <Button asChild variant="outline">
                <Link href="/knowledge">
                  <BookOpen aria-hidden /> Knowledge base
                </Link>
              </Button>
            )}
            {authorizationService.can(ctx, 'ai.manage') && (
              <Button asChild variant="outline">
                <Link href="/ai/settings">
                  <Settings2 aria-hidden /> AI settings
                </Link>
              </Button>
            )}
          </div>
        }
      />
      <AiWorkspace
        conversations={conversations}
        activeId={active?.conversation.id ?? null}
        archivedView={archived}
        query={search}
        chat={{
          conversationId: active?.conversation.id ?? null,
          initialMessages,
          contextType: active?.conversation.context_type ?? contextType ?? 'GLOBAL',
          contextId: active?.conversation.context_id ?? contextId,
          suggestions: contextType ? (CONTEXT_PROMPTS[contextType] ?? suggestedPrompts(ctx)) : suggestedPrompts(ctx),
          greeting: greetingFor(ctx.actor.displayName, ctx.organization.timezone),
          allowStudyMode: settings.studyMode,
          autoAsk: active ? null : ask,
          disabledReason,
        }}
      />
    </>
  )
}
