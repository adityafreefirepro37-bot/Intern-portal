import 'server-only'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { NotFoundError } from '@/lib/errors'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { AUDIT_ACTIONS } from '../services/audit-actions'
import { auditService } from '../services/audit.service'
import { authorizationService } from '../services/authorization.service'
import { aiActionService } from './actions.service'

/**
 * AI conversations are private to their owner: every query pins both the
 * organization and the user, so another person's conversation (even an
 * administrator's request for it) is simply "not found".
 */

const titleSchema = z.string().trim().min(1, 'Enter a title').max(120)
const feedbackSchema = z.strictObject({
  messageId: z.uuid(),
  rating: z.enum(['HELPFUL', 'NOT_HELPFUL']),
  reason: z.string().trim().max(500).optional(),
})

function ownerWhere(ctx: RequestContext) {
  return { organization_id: ctx.organization.id, user_id: ctx.actor.userId }
}

export const aiConversationService = {
  async list(ctx: RequestContext, query: { q?: string; archived?: boolean } = {}) {
    authorizationService.require(ctx, 'ai.use')
    const term = query.q?.trim().slice(0, 100)
    return prisma.aiConversation.findMany({
      where: {
        ...ownerWhere(ctx),
        archived_at: query.archived ? { not: null } : null,
        ...(term
          ? {
              OR: [
                { title: { contains: term, mode: 'insensitive' as const } },
                { messages: { some: { content: { contains: term, mode: 'insensitive' as const } } } },
              ],
            }
          : {}),
      },
      orderBy: { updated_at: 'desc' },
      take: 100,
      select: { id: true, title: true, context_type: true, context_id: true, updated_at: true, archived_at: true },
    })
  },

  async owned(ctx: RequestContext, conversationId: string) {
    authorizationService.require(ctx, 'ai.use')
    const id = parseInput(z.uuid(), conversationId)
    const conversation = await prisma.aiConversation.findFirst({ where: { id, ...ownerWhere(ctx) } })
    if (!conversation) throw new NotFoundError('Conversation')
    return conversation
  },

  /** A conversation with its messages and any action proposals. */
  async get(ctx: RequestContext, conversationId: string) {
    const conversation = await this.owned(ctx, conversationId)
    const [messages, actions] = await Promise.all([
      prisma.aiMessage.findMany({
        where: { conversation_id: conversation.id, role: { in: ['USER', 'ASSISTANT'] } },
        orderBy: { created_at: 'asc' },
        take: 200,
        select: { id: true, role: true, content: true, metadata: true, feedback: true, created_at: true },
      }),
      prisma.aiActionRequest.findMany({
        where: { conversation_id: conversation.id, user_id: ctx.actor.userId },
        select: { id: true, message_id: true },
      }),
    ])
    const proposals = await Promise.all(
      actions.map(async (a) => ({ messageId: a.message_id, proposal: await aiActionService.get(ctx, a.id) })),
    )
    return { conversation, messages, proposals }
  },

  async rename(ctx: RequestContext, conversationId: string, title: string) {
    const conversation = await this.owned(ctx, conversationId)
    await prisma.aiConversation.update({ where: { id: conversation.id }, data: { title: parseInput(titleSchema, title) } })
  },

  async setArchived(ctx: RequestContext, conversationId: string, archived: boolean) {
    const conversation = await this.owned(ctx, conversationId)
    await prisma.aiConversation.update({ where: { id: conversation.id }, data: { archived_at: archived ? new Date() : null } })
  },

  async remove(ctx: RequestContext, conversationId: string) {
    const conversation = await this.owned(ctx, conversationId)
    await prisma.aiConversation.delete({ where: { id: conversation.id } })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.AI_CONVERSATION_DELETED,
      resourceType: 'ai_conversation',
      resourceId: conversation.id,
    })
  },

  /** Rates an answer in the user's own conversation. */
  async feedback(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'ai.use')
    const data = parseInput(feedbackSchema, input)
    const message = await prisma.aiMessage.findFirst({
      where: { id: data.messageId, role: 'ASSISTANT', conversation: ownerWhere(ctx) },
      select: { id: true },
    })
    if (!message) throw new NotFoundError('Message')
    await prisma.aiMessage.update({
      where: { id: message.id },
      data: { feedback: data.rating, feedback_reason: data.reason ?? null, feedback_at: new Date() },
    })
  },
}
