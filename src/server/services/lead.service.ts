import 'server-only'
import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, NotFoundError } from '@/lib/errors'
import { servicesFor, type LeadAudit } from '@/lib/leads/audit'
import { AYAVA_SERVICES } from '@/lib/leads/catalog'
import { fullName } from '@/lib/utils/format'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { enqueueJob } from '../jobs/queue'
import { runWorker } from '../jobs/worker'
import { leadFindings, syncSearches, type LeadSummary } from '../leads/pipeline'
import { domainOf, normaliseWebsite } from '../leads/safe-fetch'
import { apiCalls, growthSettings, growthSettingsSchema, PAGESPEED_API, PLACES_API } from '../leads/settings'
import { leadSources } from '../leads/sources'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { NOTIFICATION_TYPES, notificationService, usersWithPermission } from './notification.service'

/**
 * Growth leads. `lead.manage` (organization) runs Growth: settings, searches,
 * assigning. `lead.read` / `lead.update` with a narrower scope reach only the
 * leads assigned to the actor (interns doing outreach research). The private
 * audit page (/audit/<token>) is public by design and shows only the business
 * name and the audit — never contact details or notes.
 */

type LeadPermission = 'lead.read' | 'lead.update' | 'lead.manage'

function leadScope(ctx: RequestContext, permission: LeadPermission): Prisma.LeadWhereInput {
  const scope = authorizationService.require(ctx, permission)
  const base = { organization_id: ctx.organization.id }
  return scope === 'ORGANIZATION' ? base : { ...base, assigned_to: ctx.actor.userId }
}

const PAGE_SIZE = 50

const listFilterSchema = z.object({
  tier: z.enum(['HOT', 'WARM', 'SKIP']).optional(),
  status: z.enum(['NEW', 'REVIEWED', 'READY', 'NOT_A_FIT', 'DO_NOT_CONTACT']).optional(),
  research: z.enum(['PENDING', 'RUNNING', 'DONE', 'FAILED']).optional(),
  industryId: z.uuid().optional(),
  city: z.string().trim().max(60).optional(),
  assigned: z.union([z.literal('me'), z.literal('none'), z.uuid()]).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.number().int().min(1).max(1000).default(1),
})
export type LeadListFilter = z.input<typeof listFilterSchema>

const checklistSchema = z.strictObject({
  instagramActive: z.enum(['yes', 'no', 'none']).nullable().optional(),
  runsAds: z.enum(['yes', 'no', 'unknown']).nullable().optional(),
  decisionMaker: z.string().trim().max(120).nullable().optional(),
})

const updateSchema = z.strictObject({
  leadId: z.uuid(),
  status: z.enum(['NEW', 'REVIEWED', 'READY', 'NOT_A_FIT']).optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  checklist: checklistSchema.optional(),
  email: z.email().max(120).nullable().optional(),
})

const manualSchema = z.strictObject({
  name: z.string().trim().min(2, 'Enter the business name').max(200),
  website: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.email().max(120).optional().or(z.literal('')),
  city: z.string().trim().max(60).optional(),
  industryId: z.uuid().optional(),
})

const industrySchema = z.strictObject({
  industryId: z.uuid(),
  active: z.boolean(),
  priority: z.number().int().min(1).max(3),
  terms: z.array(z.string().trim().min(2).max(60)).min(1, 'Add at least one search term').max(6),
})

function auditUrl(token: string | null) {
  return token ? `/audit/${token}` : null
}

export const leadService = {
  async overview(ctx: RequestContext) {
    const where = leadScope(ctx, 'lead.read')
    const manage = authorizationService.can(ctx, 'lead.manage')
    const [byTier, byResearch, total, ready] = await Promise.all([
      prisma.lead.groupBy({ by: ['tier'], where: { ...where, status: { not: 'DO_NOT_CONTACT' } }, _count: { _all: true } }),
      prisma.lead.groupBy({ by: ['research_status'], where, _count: { _all: true } }),
      prisma.lead.count({ where }),
      prisma.lead.count({ where: { ...where, status: 'READY' } }),
    ])
    const tiers = Object.fromEntries(byTier.map((r) => [r.tier ?? 'UNSCORED', r._count._all])) as Record<string, number>
    const research = Object.fromEntries(byResearch.map((r) => [r.research_status, r._count._all])) as Record<string, number>
    if (!manage) return { total, ready, tiers, research, admin: null }
    const [settings, places, speed, lastJob, searches] = await Promise.all([
      growthSettings.get(ctx.organization.id),
      apiCalls(ctx.organization.id, PLACES_API),
      apiCalls(ctx.organization.id, PAGESPEED_API),
      prisma.backgroundJob.findFirst({ where: { organization_id: ctx.organization.id, status: { in: ['DONE', 'FAILED'] } }, orderBy: { finished_at: 'desc' }, select: { finished_at: true } }),
      prisma.leadSearch.groupBy({ by: ['exhausted'], where: { organization_id: ctx.organization.id, active: true }, _count: { _all: true } }),
    ])
    return {
      total,
      ready,
      tiers,
      research,
      admin: {
        enabled: settings.enabled,
        googleConfigured: leadSources().placesConfigured(),
        places: { ...places, dailyCap: settings.placesDailyCap, monthlyCap: settings.placesMonthlyCap },
        pagespeedToday: speed.today,
        lastWorkerRun: lastJob?.finished_at ?? null,
        searchesOpen: searches.find((s) => !s.exhausted)?._count._all ?? 0,
        searchesDone: searches.find((s) => s.exhausted)?._count._all ?? 0,
      },
    }
  },

  async list(ctx: RequestContext, input: LeadListFilter) {
    const filter = parseInput(listFilterSchema, input)
    const where: Prisma.LeadWhereInput = { ...leadScope(ctx, 'lead.read') }
    if (filter.tier) where.tier = filter.tier
    if (filter.status) where.status = filter.status
    else where.status = { not: 'DO_NOT_CONTACT' }
    if (filter.research) where.research_status = filter.research
    if (filter.industryId) where.industry_id = filter.industryId
    if (filter.city) where.city = filter.city
    if (filter.assigned === 'me') where.assigned_to = ctx.actor.userId
    else if (filter.assigned === 'none') where.assigned_to = null
    else if (filter.assigned) where.assigned_to = filter.assigned
    if (filter.q) where.OR = [{ name: { contains: filter.q, mode: 'insensitive' } }, { website: { contains: filter.q, mode: 'insensitive' } }]
    const [items, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: [{ tier: { sort: 'asc', nulls: 'last' } }, { need_score: { sort: 'desc', nulls: 'last' } }, { created_at: 'desc' }],
        skip: (filter.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          name: true,
          city: true,
          category: true,
          website: true,
          email: true,
          phone: true,
          rating: true,
          review_count: true,
          tier: true,
          need_score: true,
          fit_score: true,
          status: true,
          research_status: true,
          audit_views: true,
          summary: true,
          industry: { select: { id: true, name: true } },
          assignee: { select: { id: true, first_name: true, last_name: true } },
        },
      }),
      prisma.lead.count({ where }),
    ])
    return {
      total,
      page: filter.page,
      pageSize: PAGE_SIZE,
      items: items.map(({ summary, assignee, ...lead }) => ({
        ...lead,
        topProblem: (summary as unknown as LeadSummary | null)?.problems?.[0]?.title ?? null,
        assignee: assignee ? { id: assignee.id, name: fullName(assignee) } : null,
      })),
    }
  },

  async get(ctx: RequestContext, leadId: string) {
    const id = parseInput(z.uuid(), leadId)
    const lead = await prisma.lead.findFirst({
      where: { id, ...leadScope(ctx, 'lead.read') },
      include: {
        industry: { select: { id: true, name: true, checks: true, priority: true } },
        assignee: { select: { id: true, first_name: true, last_name: true } },
        search: { select: { term: true, city: true, source: true } },
      },
    })
    if (!lead) throw new NotFoundError('Lead')
    const findings = leadFindings(lead)
    return {
      ...lead,
      audit: lead.audit as unknown as LeadAudit | null,
      summary: lead.summary as unknown as LeadSummary | null,
      checklist: (lead.checklist ?? {}) as z.infer<typeof checklistSchema>,
      scoreReasons: (lead.score_reasons ?? []) as string[],
      findings,
      services: servicesFor(findings),
      assignee: lead.assignee ? { id: lead.assignee.id, name: fullName(lead.assignee) } : null,
      auditUrl: auditUrl(lead.audit_token),
      canUpdate: authorizationService.can(ctx, 'lead.update') && (authorizationService.scopeOf(ctx, 'lead.update') === 'ORGANIZATION' || lead.assigned_to === ctx.actor.userId),
      canManage: authorizationService.scopeOf(ctx, 'lead.manage') === 'ORGANIZATION',
    }
  },

  async update(ctx: RequestContext, input: z.input<typeof updateSchema>) {
    const data = parseInput(updateSchema, input)
    const lead = await prisma.lead.findFirst({ where: { id: data.leadId, ...leadScope(ctx, 'lead.update') }, select: { id: true, status: true, checklist: true } })
    if (!lead) throw new NotFoundError('Lead')
    if (lead.status === 'DO_NOT_CONTACT') throw new ConflictError('This business asked not to be contacted')
    const checklist = data.checklist ? { ...((lead.checklist ?? {}) as object), ...data.checklist } : undefined
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        ...(data.status ? { status: data.status } : {}),
        ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
        ...(data.email !== undefined ? { email: data.email?.toLowerCase() ?? null } : {}),
        ...(checklist ? { checklist } : {}),
      },
    })
    await auditService.logForContext(ctx, { action: AUDIT_ACTIONS.LEAD_UPDATED, resourceType: 'lead', resourceId: lead.id, metadata: { status: data.status, checklist: Boolean(data.checklist), notes: data.notes !== undefined } })
    return { updated: true }
  },

  async assign(ctx: RequestContext, input: { leadIds: string[]; userId: string | null }) {
    const data = parseInput(z.strictObject({ leadIds: z.array(z.uuid()).min(1).max(200), userId: z.uuid().nullable() }), input)
    leadScope(ctx, 'lead.manage')
    if (data.userId) {
      const user = await prisma.user.findFirst({ where: { id: data.userId, organization_id: ctx.organization.id, status: 'ACTIVE', deleted_at: null }, select: { id: true } })
      if (!user) throw new NotFoundError('Person')
    }
    const result = await prisma.lead.updateMany({ where: { id: { in: data.leadIds }, organization_id: ctx.organization.id, status: { not: 'DO_NOT_CONTACT' } }, data: { assigned_to: data.userId } })
    await auditService.logForContext(ctx, { action: AUDIT_ACTIONS.LEAD_ASSIGNED, resourceType: 'lead', metadata: { count: result.count, userId: data.userId } })
    if (data.userId && result.count) {
      await notificationService.notify(
        ctx.organization.id,
        [data.userId],
        {
          type: NOTIFICATION_TYPES.LEAD_ASSIGNED,
          title: result.count === 1 ? 'A lead was assigned to you' : `${result.count} leads were assigned to you`,
          body: 'Review the audit, check Instagram and ads, and mark each one ready or not a fit.',
          entityType: 'lead',
          entityId: data.leadIds.length === 1 ? data.leadIds[0]! : null,
        },
        ctx.actor.userId,
      )
    }
    return { assigned: result.count }
  },

  async addManual(ctx: RequestContext, input: z.input<typeof manualSchema>) {
    const data = parseInput(manualSchema, input)
    leadScope(ctx, 'lead.manage')
    const website = normaliseWebsite(data.website)
    if (data.website && !website) throw new ConflictError('That website address isn’t valid (social profiles don’t count as a website)')
    const domain = domainOf(website)
    if (domain) {
      const suppressed = await prisma.leadSuppression.findFirst({ where: { organization_id: ctx.organization.id, kind: 'DOMAIN', value: domain } })
      if (suppressed) throw new ConflictError('This business asked not to be contacted')
      const existing = await prisma.lead.findFirst({ where: { organization_id: ctx.organization.id, website: { contains: `://${domain}` } }, select: { id: true } })
      if (existing) throw new ConflictError('A lead with this website already exists')
    }
    if (data.industryId) {
      const industry = await prisma.leadIndustry.findFirst({ where: { id: data.industryId, organization_id: ctx.organization.id }, select: { id: true } })
      if (!industry) throw new NotFoundError('Industry')
    }
    const lead = await prisma.lead.create({
      data: {
        organization_id: ctx.organization.id,
        source: 'MANUAL',
        external_id: randomUUID(),
        industry_id: data.industryId ?? null,
        name: data.name,
        city: data.city || null,
        website,
        phone: data.phone || null,
        email: data.email ? data.email.toLowerCase() : null,
      },
      select: { id: true },
    })
    await enqueueJob({ type: 'lead.research', organizationId: ctx.organization.id, payload: { leadId: lead.id }, dedupeKey: `lead.research:${lead.id}` })
    await auditService.logForContext(ctx, { action: AUDIT_ACTIONS.LEAD_CREATED, resourceType: 'lead', resourceId: lead.id })
    return { id: lead.id }
  },

  async research(ctx: RequestContext, leadId: string) {
    const id = parseInput(z.uuid(), leadId)
    const lead = await prisma.lead.findFirst({ where: { id, ...leadScope(ctx, 'lead.manage') }, select: { id: true, status: true } })
    if (!lead) throw new NotFoundError('Lead')
    if (lead.status === 'DO_NOT_CONTACT') throw new ConflictError('This business asked not to be contacted')
    await prisma.lead.update({ where: { id }, data: { research_status: 'PENDING', research_error: null } })
    await enqueueJob({ type: 'lead.research', organizationId: ctx.organization.id, payload: { leadId: id }, dedupeKey: `lead.research:${id}` })
    await auditService.logForContext(ctx, { action: AUDIT_ACTIONS.LEAD_RESEARCH_REQUESTED, resourceType: 'lead', resourceId: id })
    return { queued: true }
  },

  /** Runs the worker now (instead of waiting for the next scheduled run). */
  async runNow(ctx: RequestContext) {
    leadScope(ctx, 'lead.manage')
    return runWorker(40_000)
  },

  async assignableUsers(ctx: RequestContext) {
    leadScope(ctx, 'lead.manage')
    const users = await prisma.user.findMany({
      where: { organization_id: ctx.organization.id, status: 'ACTIVE', deleted_at: null },
      orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
      select: { id: true, first_name: true, last_name: true },
    })
    return users.map((u) => ({ id: u.id, name: fullName(u) }))
  },

  async filters(ctx: RequestContext) {
    authorizationService.require(ctx, 'lead.read')
    const [industries, cities] = await Promise.all([
      prisma.leadIndustry.findMany({ where: { organization_id: ctx.organization.id }, orderBy: { position: 'asc' }, select: { id: true, name: true } }),
      prisma.lead.findMany({ where: { organization_id: ctx.organization.id, city: { not: null } }, distinct: ['city'], select: { city: true }, orderBy: { city: 'asc' } }),
    ])
    return { industries, cities: cities.map((c) => c.city!) }
  },

  // ─── Settings & searches (lead.manage) ──────────────────────────────────────

  async settings(ctx: RequestContext) {
    leadScope(ctx, 'lead.manage')
    const [settings, industries] = await Promise.all([
      growthSettings.get(ctx.organization.id),
      prisma.leadIndustry.findMany({
        where: { organization_id: ctx.organization.id },
        orderBy: { position: 'asc' },
        include: { _count: { select: { leads: true } } },
      }),
    ])
    return { settings, industries, googleConfigured: leadSources().placesConfigured(), services: Object.values(AYAVA_SERVICES) }
  },

  async saveSettings(ctx: RequestContext, input: unknown) {
    leadScope(ctx, 'lead.manage')
    const data = parseInput(growthSettingsSchema, input)
    data.cities = [...new Set(data.cities.map((c) => c.trim()).filter(Boolean))]
    const saved = await growthSettings.save(ctx.organization.id, data)
    const sync = await syncSearches(ctx.organization.id, saved)
    await auditService.logForContext(ctx, { action: AUDIT_ACTIONS.LEAD_SETTINGS_UPDATED, resourceType: 'settings', metadata: { enabled: saved.enabled, cities: saved.cities.length, placesDailyCap: saved.placesDailyCap } })
    return { saved: true, searches: sync.searches }
  },

  async saveIndustry(ctx: RequestContext, input: z.input<typeof industrySchema>) {
    leadScope(ctx, 'lead.manage')
    const data = parseInput(industrySchema, input)
    const industry = await prisma.leadIndustry.findFirst({ where: { id: data.industryId, organization_id: ctx.organization.id }, select: { id: true } })
    if (!industry) throw new NotFoundError('Industry')
    await prisma.leadIndustry.update({ where: { id: industry.id }, data: { active: data.active, priority: data.priority, search_terms: [...new Set(data.terms)] } })
    await syncSearches(ctx.organization.id, await growthSettings.get(ctx.organization.id))
    await auditService.logForContext(ctx, { action: AUDIT_ACTIONS.LEAD_INDUSTRY_UPDATED, resourceType: 'lead_industry', resourceId: industry.id, metadata: { active: data.active, priority: data.priority } })
    return { saved: true }
  },

  async searches(ctx: RequestContext) {
    leadScope(ctx, 'lead.manage')
    return prisma.leadSearch.findMany({
      where: { organization_id: ctx.organization.id, active: true },
      orderBy: [{ industry: { position: 'asc' } }, { city: 'asc' }, { source: 'asc' }, { term: 'asc' }],
      select: {
        id: true,
        city: true,
        term: true,
        source: true,
        exhausted: true,
        pages_fetched: true,
        found: true,
        added: true,
        last_run_at: true,
        last_error: true,
        industry: { select: { name: true } },
      },
    })
  },
}

// ─── Public audit page (no sign-in) ──────────────────────────────────────────

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,40}$/)

async function leadByToken(token: string) {
  const parsed = tokenSchema.safeParse(token)
  if (!parsed.success) return null
  const lead = await prisma.lead.findUnique({
    where: { audit_token: parsed.data },
    include: { industry: { select: { name: true, checks: true } }, organization: { select: { name: true, website_url: true } } },
  })
  if (!lead || lead.status === 'DO_NOT_CONTACT') return null
  if (lead.audit_expires_at && lead.audit_expires_at < new Date()) return null
  return lead
}

export const publicAuditService = {
  async get(token: string) {
    const lead = await leadByToken(token)
    if (!lead) return null
    const findings = leadFindings(lead)
    const audit = lead.audit as unknown as LeadAudit | null
    return {
      businessName: lead.name,
      city: lead.city,
      industry: lead.industry?.name ?? null,
      checkedAt: audit?.checkedAt ?? lead.researched_at?.toISOString() ?? null,
      summary: lead.summary as unknown as LeadSummary | null,
      findings: findings.slice(0, 8).map(({ key, severity, title, detail, service }) => ({ key, severity, title, detail, service: AYAVA_SERVICES[service] })),
      speed: audit?.speed?.performance ?? null,
      rating: lead.rating,
      reviewCount: lead.review_count,
      agency: { name: lead.organization.name, website: lead.organization.website_url },
    }
  },

  /** Counted from the browser after the page has been visible for a moment (link scanners don't count). */
  async recordView(token: string) {
    const lead = await leadByToken(token)
    if (!lead) return { ok: false }
    const now = new Date()
    const updated = await prisma.lead.update({
      where: { id: lead.id },
      data: { audit_views: { increment: 1 }, audit_last_viewed_at: now, audit_first_viewed_at: lead.audit_first_viewed_at ?? now },
      select: { audit_views: true },
    })
    // The second view is the buying signal: tell whoever owns the lead.
    if (updated.audit_views === 2) {
      const recipients = lead.assigned_to ? [lead.assigned_to] : await usersWithPermission(lead.organization_id, 'lead.manage')
      await notificationService.notify(
        lead.organization_id,
        recipients,
        { type: NOTIFICATION_TYPES.LEAD_AUDIT_VIEWED, title: `${lead.name} opened their audit again`, body: 'They have looked at it twice: a good moment to follow up.', entityType: 'lead', entityId: lead.id },
        null,
      )
    }
    return { ok: true }
  },

  /** "Remove my business's data": contact details and the audit are erased and the business is never contacted again. */
  async optOut(token: string) {
    const lead = await leadByToken(token)
    if (!lead) return { ok: false }
    const domain = domainOf(lead.website)
    const phone = lead.phone?.replace(/\D/g, '').slice(-10)
    const suppressions = [
      { kind: 'PLACE', value: `${lead.source}:${lead.external_id}` },
      ...(domain ? [{ kind: 'DOMAIN', value: domain }] : []),
      ...(phone && phone.length === 10 ? [{ kind: 'PHONE', value: phone }] : []),
      ...(lead.email ? [{ kind: 'EMAIL', value: lead.email.toLowerCase() }] : []),
    ]
    await prisma.$transaction([
      prisma.leadSuppression.createMany({ data: suppressions.map((s) => ({ ...s, organization_id: lead.organization_id, reason: 'Asked to be removed from the audit page' })), skipDuplicates: true }),
      prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: 'DO_NOT_CONTACT',
          phone: null,
          email: null,
          website: null,
          address: null,
          latitude: null,
          longitude: null,
          notes: null,
          audit_token: null,
          audit_expires_at: null,
        },
      }),
      prisma.$executeRaw`UPDATE "leads" SET "audit" = NULL, "summary" = NULL, "checklist" = NULL, "score_reasons" = NULL WHERE "id" = ${lead.id}::uuid`,
    ])
    await auditService.log({ organizationId: lead.organization_id, actorUserId: null, action: AUDIT_ACTIONS.LEAD_OPTED_OUT, resourceType: 'lead', resourceId: lead.id })
    return { ok: true }
  },
}

