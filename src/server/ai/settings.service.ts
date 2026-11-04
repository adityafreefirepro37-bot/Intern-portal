import 'server-only'
import type { AiFeature, Prisma } from '@prisma/client'
import { z } from 'zod'
import { config } from '@/lib/config'
import { prisma } from '@/lib/db/client'
import { AppError } from '@/lib/errors'
import { todayIn } from '@/lib/interns/dates'
import { logger } from '@/lib/logging'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { AUDIT_ACTIONS } from '../services/audit-actions'
import { auditService } from '../services/audit.service'
import { authorizationService } from '../services/authorization.service'

/**
 * Organization AI settings (feature flags, cost limits, retention), usage
 * recording and operational metrics. Settings live in the shared `settings`
 * table under one key; provider credentials stay in environment variables.
 */

const KEY = 'ai'

const flag = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean())

export const aiSettingsSchema = z.object({
  enabled: flag.default(true),
  knowledgeSearch: flag.default(true),
  actions: flag.default(true),
  documentSummary: flag.default(true),
  studyMode: flag.default(true),
  /** Questions one person may ask per day (organization time zone). */
  userDailyRequests: z.coerce.number().int().min(1).max(10_000).default(100),
  /** Tokens the whole organization may use per calendar month (0 = no limit). */
  monthlyTokenLimit: z.coerce.number().int().min(0).max(1_000_000_000).default(2_000_000),
  /** Conversations untouched for this many days are deleted by the daily job. */
  conversationRetentionDays: z.coerce.number().int().min(7).max(3650).default(180),
  usageRetentionDays: z.coerce.number().int().min(30).max(3650).default(365),
})

export type AiSettings = z.infer<typeof aiSettingsSchema>
export const DEFAULT_AI_SETTINGS: AiSettings = aiSettingsSchema.parse({})

export class AiUnavailableError extends AppError {
  constructor(message: string) {
    super('FORBIDDEN', message)
    this.name = 'AiUnavailableError'
  }
}

function startOfMonth(timeZone: string) {
  const today = todayIn(timeZone)
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
}

export interface UsageInput {
  feature: AiFeature
  conversationId?: string | null
  intent?: string
  contextType?: string
  provider?: string | null
  model?: string | null
  tokensInput?: number
  tokensOutput?: number
  latencyMs?: number
  success: boolean
  errorCode?: string
  tools?: string[]
  retrievedChunks?: number
}

export const aiSettingsService = {
  async get(organizationId: string): Promise<AiSettings> {
    const row = await prisma.setting.findUnique({
      where: { organization_id_key: { organization_id: organizationId, key: KEY } },
      select: { value: true },
    })
    const parsed = aiSettingsSchema.safeParse(row?.value ?? {})
    return parsed.success ? parsed.data : DEFAULT_AI_SETTINGS
  },

  /** For the settings page (ai.manage). */
  async view(ctx: RequestContext) {
    authorizationService.require(ctx, 'ai.manage')
    return {
      settings: await this.get(ctx.organization.id),
      provider: {
        configured: config.ai.configured,
        name: config.ai.provider ?? null,
        model: config.ai.model ?? null,
        fallbackModel: config.ai.fallbackModel ?? null,
        embeddingModel: config.ai.embeddingModel ?? null,
      },
    }
  },

  async save(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'ai.manage')
    // Unchecked boxes are absent from form data: treat missing flags as off.
    const raw = (input ?? {}) as Record<string, unknown>
    const data = parseInput(aiSettingsSchema, {
      ...raw,
      enabled: raw.enabled ?? false,
      knowledgeSearch: raw.knowledgeSearch ?? false,
      actions: raw.actions ?? false,
      documentSummary: raw.documentSummary ?? false,
      studyMode: raw.studyMode ?? false,
    })
    const before = await this.get(ctx.organization.id)
    await prisma.setting.upsert({
      where: { organization_id_key: { organization_id: ctx.organization.id, key: KEY } },
      update: { value: data as Prisma.InputJsonValue },
      create: { organization_id: ctx.organization.id, key: KEY, value: data as Prisma.InputJsonValue },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.AI_SETTINGS_UPDATED,
      resourceType: 'settings',
      resourceId: KEY,
      metadata: { before, after: data },
    })
    return data
  },

  /**
   * Throws a user-facing error unless this person may send another AI request
   * now: AI enabled, under the personal daily limit and the monthly token budget.
   */
  async assertCanUse(ctx: RequestContext, settings: AiSettings) {
    if (!settings.enabled) throw new AiUnavailableError('AYAVA AI is turned off for your organization.')
    const tz = ctx.organization.timezone
    const [today, month] = await Promise.all([
      prisma.aiUsageEvent.count({
        where: { user_id: ctx.actor.userId, feature: 'CHAT', created_at: { gte: dayStart(tz) } },
      }),
      settings.monthlyTokenLimit > 0
        ? prisma.aiUsageEvent.aggregate({
            where: { organization_id: ctx.organization.id, created_at: { gte: startOfMonth(tz) } },
            _sum: { tokens_input: true, tokens_output: true },
          })
        : Promise.resolve(null),
    ])
    if (today >= settings.userDailyRequests) {
      throw new AiUnavailableError(`You’ve reached today’s limit of ${settings.userDailyRequests} AI requests. It resets tomorrow.`)
    }
    if (month && (month._sum.tokens_input ?? 0) + (month._sum.tokens_output ?? 0) >= settings.monthlyTokenLimit) {
      throw new AiUnavailableError('Your organization has used this month’s AI allowance. An administrator can raise it in AI settings.')
    }
  },

  /** Records one AI operation (never content). Failures are logged, never thrown. */
  async record(ctx: RequestContext, input: UsageInput) {
    try {
      await prisma.aiUsageEvent.create({
        data: {
          organization_id: ctx.organization.id,
          user_id: ctx.actor.userId,
          conversation_id: input.conversationId ?? null,
          feature: input.feature,
          intent: input.intent,
          context_type: input.contextType,
          role_slug: ctx.actor.roles[0]?.slug ?? null,
          provider: input.provider ?? null,
          model: input.model ?? null,
          tokens_input: Math.max(0, Math.round(input.tokensInput ?? 0)),
          tokens_output: Math.max(0, Math.round(input.tokensOutput ?? 0)),
          latency_ms: input.latencyMs === undefined ? null : Math.round(input.latencyMs),
          success: input.success,
          error_code: input.errorCode,
          tools: input.tools ?? [],
          retrieved_chunks: input.retrievedChunks ?? 0,
        },
      })
    } catch (error) {
      logger.warn('Could not record AI usage', { error })
    }
  },

  /** Organization-wide AI metrics for administrators — counts only, never conversation content. */
  async metrics(ctx: RequestContext, days = 30) {
    authorizationService.require(ctx, 'ai.manage')
    const org = ctx.organization.id
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const where = { organization_id: org, created_at: { gte: since } }
    const [totals, byFeature, byRole, failures, users, toolRows, feedback, actions, month] = await Promise.all([
      prisma.aiUsageEvent.aggregate({
        where: { ...where, feature: 'CHAT' },
        _count: { _all: true },
        _avg: { latency_ms: true },
        _sum: { tokens_input: true, tokens_output: true, retrieved_chunks: true },
      }),
      prisma.aiUsageEvent.groupBy({ by: ['feature'], where, _count: { _all: true }, _sum: { tokens_input: true, tokens_output: true } }),
      prisma.aiUsageEvent.groupBy({ by: ['role_slug'], where: { ...where, feature: 'CHAT' }, _count: { _all: true } }),
      prisma.aiUsageEvent.groupBy({ by: ['error_code'], where: { ...where, success: false }, _count: { _all: true } }),
      prisma.aiUsageEvent.findMany({ where: { ...where, feature: 'CHAT' }, distinct: ['user_id'], select: { user_id: true } }),
      prisma.$queryRaw<{ tool: string; uses: bigint }[]>`
        SELECT tool, count(*) AS uses FROM ai_usage_events, unnest(tools) AS tool
        WHERE organization_id = ${org}::uuid AND created_at >= ${since}
        GROUP BY tool ORDER BY uses DESC LIMIT 15`,
      prisma.aiMessage.groupBy({
        by: ['feedback'],
        where: { feedback: { not: null }, conversation: { organization_id: org }, feedback_at: { gte: since } },
        _count: { _all: true },
      }),
      prisma.aiActionRequest.groupBy({ by: ['status'], where, _count: { _all: true } }),
      prisma.aiUsageEvent.aggregate({
        where: { organization_id: org, created_at: { gte: startOfMonth(ctx.organization.timezone) } },
        _sum: { tokens_input: true, tokens_output: true },
      }),
    ])
    const chatRequests = totals._count._all
    const withKnowledge = await prisma.aiUsageEvent.count({ where: { ...where, feature: 'CHAT', retrieved_chunks: { gt: 0 } } })
    return {
      days,
      requests: chatRequests,
      activeUsers: users.length,
      averageLatencyMs: Math.round(totals._avg.latency_ms ?? 0),
      tokens: (totals._sum.tokens_input ?? 0) + (totals._sum.tokens_output ?? 0),
      monthTokens: (month._sum.tokens_input ?? 0) + (month._sum.tokens_output ?? 0),
      knowledgeRate: chatRequests ? Math.round((withKnowledge / chatRequests) * 100) : 0,
      byFeature: byFeature.map((f) => ({
        feature: f.feature,
        count: f._count._all,
        tokens: (f._sum.tokens_input ?? 0) + (f._sum.tokens_output ?? 0),
      })),
      byRole: byRole.map((r) => ({ role: r.role_slug ?? 'unknown', count: r._count._all })),
      errors: failures.map((e) => ({ code: e.error_code ?? 'UNKNOWN', count: e._count._all })),
      tools: toolRows.map((t) => ({ tool: t.tool, uses: Number(t.uses) })),
      feedback: {
        helpful: feedback.find((f) => f.feedback === 'HELPFUL')?._count._all ?? 0,
        notHelpful: feedback.find((f) => f.feedback === 'NOT_HELPFUL')?._count._all ?? 0,
      },
      actions: actions.map((a) => ({ status: a.status, count: a._count._all })),
    }
  },

  /** Daily job: retention for conversations, usage events and expired action proposals. */
  async applyRetention(organizationId: string) {
    const settings = await this.get(organizationId)
    const day = 24 * 60 * 60 * 1000
    const [conversations, usage, expired] = await Promise.all([
      prisma.aiConversation.deleteMany({
        where: { organization_id: organizationId, updated_at: { lt: new Date(Date.now() - settings.conversationRetentionDays * day) } },
      }),
      prisma.aiUsageEvent.deleteMany({
        where: { organization_id: organizationId, created_at: { lt: new Date(Date.now() - settings.usageRetentionDays * day) } },
      }),
      prisma.aiActionRequest.updateMany({
        where: { organization_id: organizationId, status: 'PROPOSED', expires_at: { lt: new Date() } },
        data: { status: 'EXPIRED' },
      }),
    ])
    return { conversations: conversations.count, usageEvents: usage.count, expiredActions: expired.count }
  },
}

/** Midnight today in the organization's time zone, as a UTC instant. */
function dayStart(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date())
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const now = Date.now()
  const elapsed = ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000
  return new Date(now - elapsed - (now % 1000))
}
