import 'server-only'
import { randomBytes } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { buildLeadSummaryMessages } from '@/lib/ai/prompts'
import { prisma } from '@/lib/db/client'
import {
  analyzeHtml,
  findingsFor,
  mergeSignals,
  servicesFor,
  type Finding,
  type LeadAudit,
  type SiteSignals,
} from '@/lib/leads/audit'
import { AYAVA_SERVICES, INDUSTRY_CHECKS, type IndustryCheck } from '@/lib/leads/catalog'
import { scoreLead } from '@/lib/leads/score'
import { logger } from '@/lib/logging'
import { generateStructured, getAIProvider } from '../ai/provider'
import { aiSettingsService } from '../ai/settings.service'
import { enqueueJob, type JobHandler } from '../jobs/queue'
import { domainOf, FetchBlockedError, normaliseWebsite } from './safe-fetch'
import {
  apiCalls,
  cityPositions,
  countApiCall,
  growthSettings,
  PAGESPEED_API,
  PLACES_API,
  TOMTOM_API,
  type GrowthSettings,
} from './settings'
import { leadSources, type FoundBusiness } from './sources'

/**
 * The Growth pipeline, run by the background worker:
 *
 *   scheduler tick ─► lead.search    one page of a search (TomTom: ≤100 businesses; Google: ≤20; OSM: all)
 *                  ─► lead.research  homepage + contact page + sitemap → audit signals
 *                  ─► lead.speed     PageSpeed Insights (mobile)
 *                  ─► score          findings → need / fit → HOT / WARM / SKIP (+ private audit page)
 *                  ─► lead.summary   AI words the top problems (rules-based summary until then)
 *
 * TomTom and Google usage is capped per day and per month (Growth settings) so it
 * stays inside the free allowance. Suppressed businesses (opted out) are never imported.
 */

const DAY_MS = 86_400_000
/** Exhausted searches run again after this long, to pick up new businesses. */
const RESEARCH_AGAIN_DAYS = 30

export function newAuditToken(): string {
  return randomBytes(18).toString('base64url')
}

function digits(phone: string | null | undefined): string | null {
  const d = phone?.replace(/\D/g, '') ?? ''
  return d.length >= 10 ? d.slice(-10) : null
}

function industryChecks(checks: string[]): IndustryCheck[] {
  return checks.filter((c): c is IndustryCheck => (INDUSTRY_CHECKS as readonly string[]).includes(c))
}

// ─── Searches ────────────────────────────────────────────────────────────────

/** Creates the searches for active industries × cities (and deactivates the rest). Idempotent. */
export async function syncSearches(organizationId: string, settings: GrowthSettings) {
  const industries = await prisma.leadIndustry.findMany({ where: { organization_id: organizationId } })
  const wanted: Prisma.LeadSearchCreateManyInput[] = []
  for (const industry of industries) {
    if (!industry.active) continue
    for (const city of settings.cities) {
      for (const term of industry.search_terms) {
        wanted.push({ organization_id: organizationId, industry_id: industry.id, city, term, source: 'TOMTOM' })
        wanted.push({ organization_id: organizationId, industry_id: industry.id, city, term, source: 'GOOGLE_PLACES' })
      }
      if (industry.osm_tags.length)
        wanted.push({
          organization_id: organizationId,
          industry_id: industry.id,
          city,
          term: '*',
          source: 'OPENSTREETMAP',
        })
    }
  }
  if (wanted.length) await prisma.leadSearch.createMany({ data: wanted, skipDuplicates: true })
  const key = (s: { industry_id: string; city: string; term: string; source?: string }) =>
    `${s.industry_id}|${s.city}|${s.term}|${s.source}`
  const wantedKeys = new Set(wanted.map(key))
  const existing = await prisma.leadSearch.findMany({
    where: { organization_id: organizationId },
    select: { id: true, industry_id: true, city: true, term: true, source: true, active: true },
  })
  const activate = existing.filter((s) => !s.active && wantedKeys.has(key(s))).map((s) => s.id)
  const deactivate = existing.filter((s) => s.active && !wantedKeys.has(key(s))).map((s) => s.id)
  if (activate.length) await prisma.leadSearch.updateMany({ where: { id: { in: activate } }, data: { active: true } })
  if (deactivate.length)
    await prisma.leadSearch.updateMany({ where: { id: { in: deactivate } }, data: { active: false } })
  return { searches: wanted.length, deactivated: deactivate.length }
}

/** Called every worker run: queues the next searches within today's allowance. */
export async function scheduleLeadWork() {
  const rows = await prisma.setting.findMany({ where: { key: 'growth' }, select: { organization_id: true } })
  let queued = 0
  for (const { organization_id: organizationId } of rows) {
    const settings = await growthSettings.get(organizationId)
    if (!settings.enabled) continue
    // Exhausted searches come round again after a month.
    await prisma.leadSearch.updateMany({
      where: {
        organization_id: organizationId,
        exhausted: true,
        last_run_at: { lt: new Date(Date.now() - RESEARCH_AGAIN_DAYS * DAY_MS) },
      },
      data: { exhausted: false, page_token: null },
    })
    if ((await leadsAddedToday(organizationId)) >= settings.newLeadsDailyCap) continue

    const order: Prisma.LeadSearchOrderByWithRelationInput[] = [
      { last_run_at: { sort: 'asc', nulls: 'first' } },
      { industry: { priority: 'asc' } },
      { created_at: 'asc' },
    ]
    for (const paged of pagedSources(settings)) {
      if (!paged.on) continue
      const usage = await apiCalls(organizationId, paged.api)
      const left = Math.min(paged.dailyCap - usage.today, paged.monthlyCap - usage.month)
      if (left > 0) {
        const next = await prisma.leadSearch.findMany({
          where: { organization_id: organizationId, source: paged.source, active: true, exhausted: false },
          orderBy: order,
          take: Math.min(left, 2),
          select: { id: true, city: true },
        })
        // Geocode new cities here, one at a time, so searches running in parallel don't each do it.
        if (paged.source === 'TOMTOM')
          for (const city of new Set(next.map((s) => s.city))) await cityPosition(organizationId, city)
        for (const s of next)
          if (
            await enqueueJob({
              type: 'lead.search',
              organizationId,
              payload: { searchId: s.id },
              dedupeKey: `lead.search:${s.id}`,
            })
          )
            queued++
      }
    }
    if (settings.osmEnabled) {
      const next = await prisma.leadSearch.findFirst({
        where: { organization_id: organizationId, source: 'OPENSTREETMAP', active: true, exhausted: false },
        orderBy: order,
        select: { id: true },
      })
      if (
        next &&
        (await enqueueJob({
          type: 'lead.search',
          organizationId,
          payload: { searchId: next.id },
          dedupeKey: `lead.search:${next.id}`,
        }))
      )
        queued++
    }
  }
  return { queued }
}

/** Sources that page through results and count against a free allowance. */
function pagedSources(settings: GrowthSettings) {
  return [
    {
      source: 'TOMTOM' as const,
      api: TOMTOM_API,
      on: settings.tomtomEnabled && leadSources().tomtomConfigured(),
      dailyCap: settings.tomtomDailyCap,
      monthlyCap: settings.tomtomMonthlyCap,
    },
    {
      source: 'GOOGLE_PLACES' as const,
      api: PLACES_API,
      on: settings.googleEnabled && leadSources().placesConfigured(),
      dailyCap: settings.placesDailyCap,
      monthlyCap: settings.placesMonthlyCap,
    },
  ]
}

/** A city's centre for TomTom (geocoded once, then cached; a city TomTom can't find is cached as null). */
async function cityPosition(organizationId: string, city: string) {
  const cache = await cityPositions.get(organizationId)
  if (city in cache) return cache[city] ?? null
  await countApiCall(organizationId, TOMTOM_API)
  const position = await leadSources().tomtomGeocode(city)
  await cityPositions.set(organizationId, city, position)
  return position
}

async function leadsAddedToday(organizationId: string) {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  return prisma.lead.count({
    where: { organization_id: organizationId, created_at: { gte: start }, source: { not: 'MANUAL' } },
  })
}

async function suppressionSets(organizationId: string) {
  const rows = await prisma.leadSuppression.findMany({
    where: { organization_id: organizationId },
    select: { kind: true, value: true },
  })
  const sets = {
    PLACE: new Set<string>(),
    DOMAIN: new Set<string>(),
    EMAIL: new Set<string>(),
    PHONE: new Set<string>(),
  }
  for (const r of rows) sets[r.kind as keyof typeof sets]?.add(r.value)
  return sets
}

/** Adds new businesses as leads (skipping duplicates and opted-out ones) and queues their research. */
export async function importBusinesses(
  organizationId: string,
  businesses: FoundBusiness[],
  origin: {
    source: 'GOOGLE_PLACES' | 'TOMTOM' | 'OPENSTREETMAP'
    searchId: string | null
    industryId: string | null
    city: string | null
  },
  dailyCap: number,
) {
  const suppressed = await suppressionSets(organizationId)
  let room = Math.max(0, dailyCap - (await leadsAddedToday(organizationId)))
  let added = 0
  for (const b of businesses) {
    if (room <= 0) break
    const website = normaliseWebsite(b.website)
    const domain = domainOf(website)
    const phone = digits(b.phone)
    const email = b.email?.trim().toLowerCase() || null
    if (
      suppressed.PLACE.has(`${origin.source}:${b.externalId}`) ||
      (domain && suppressed.DOMAIN.has(domain)) ||
      (phone && suppressed.PHONE.has(phone)) ||
      (email && suppressed.EMAIL.has(email))
    ) {
      continue
    }
    const duplicate = await prisma.lead.findFirst({
      where: {
        organization_id: organizationId,
        OR: [
          { source: origin.source, external_id: b.externalId },
          ...(domain ? [{ website: { contains: `://${domain}` } }, { website: { contains: `://www.${domain}` } }] : []),
          ...(phone ? [{ phone: { endsWith: phone } }] : []),
        ],
      },
      select: { id: true },
    })
    if (duplicate) continue
    const lead = await prisma.lead
      .create({
        data: {
          organization_id: organizationId,
          source: origin.source,
          external_id: b.externalId,
          industry_id: origin.industryId,
          search_id: origin.searchId,
          name: b.name.slice(0, 200),
          category: b.category,
          address: b.address,
          city: origin.city,
          phone: b.phone,
          website,
          email,
          maps_url: b.mapsUrl,
          rating: b.rating,
          review_count: b.reviewCount,
          business_status: b.businessStatus,
          latitude: b.latitude,
          longitude: b.longitude,
        },
        select: { id: true },
      })
      // Two searches running at once can find the same business: the second insert loses the race.
      .catch((error: unknown) => {
        if ((error as { code?: string })?.code === 'P2002') return null
        throw error
      })
    if (!lead) continue
    await enqueueJob({
      type: 'lead.research',
      organizationId,
      payload: { leadId: lead.id },
      dedupeKey: `lead.research:${lead.id}`,
    })
    added++
    room--
  }
  return { found: businesses.length, added }
}

const runSearch: JobHandler = async (payload) => {
  const searchId = z.uuid().parse(payload.searchId)
  const search = await prisma.leadSearch.findUnique({ where: { id: searchId }, include: { industry: true } })
  if (!search || !search.active || search.exhausted) return
  const settings = await growthSettings.get(search.organization_id)
  if (!settings.enabled) return
  try {
    if (search.source === 'GOOGLE_PLACES' || search.source === 'TOMTOM') {
      const paged = pagedSources(settings).find((x) => x.source === search.source)!
      const usage = await apiCalls(search.organization_id, paged.api)
      if (!paged.on || usage.today >= paged.dailyCap || usage.month >= paged.monthlyCap) return
      let page
      if (search.source === 'TOMTOM') {
        const near = await cityPosition(search.organization_id, search.city)
        if (!near) {
          await prisma.leadSearch.update({
            where: { id: search.id },
            data: {
              exhausted: true,
              last_run_at: new Date(),
              last_error: `TomTom couldn’t find the city “${search.city}”`,
            },
          })
          return
        }
        await countApiCall(search.organization_id, paged.api)
        page = await leadSources().tomtomSearch(search.term, near, search.page_token)
      } else {
        await countApiCall(search.organization_id, paged.api)
        page = await leadSources().placesTextSearch(`${search.term} in ${search.city}`, search.page_token)
      }
      const result = await importBusinesses(
        search.organization_id,
        page.businesses,
        { source: search.source, searchId: search.id, industryId: search.industry_id, city: search.city },
        settings.newLeadsDailyCap,
      )
      await prisma.leadSearch.update({
        where: { id: search.id },
        data: {
          page_token: page.nextPageToken,
          exhausted: !page.nextPageToken,
          pages_fetched: { increment: 1 },
          found: { increment: result.found },
          added: { increment: result.added },
          last_run_at: new Date(),
          last_error: null,
        },
      })
    } else {
      const businesses = await leadSources().osmSearch(search.city, search.industry.osm_tags)
      const result = await importBusinesses(
        search.organization_id,
        businesses,
        { source: 'OPENSTREETMAP', searchId: search.id, industryId: search.industry_id, city: search.city },
        settings.newLeadsDailyCap,
      )
      await prisma.leadSearch.update({
        where: { id: search.id },
        data: {
          exhausted: true,
          pages_fetched: { increment: 1 },
          found: { increment: result.found },
          added: { increment: result.added },
          last_run_at: new Date(),
          last_error: null,
        },
      })
    }
  } catch (error) {
    await prisma.leadSearch.update({
      where: { id: search.id },
      data: {
        last_run_at: new Date(),
        last_error: (error instanceof Error ? error.message : String(error)).slice(0, 300),
      },
    })
    throw error
  }
}

// ─── Research ────────────────────────────────────────────────────────────────

function friendlyFetchError(error: unknown): string {
  if (error instanceof FetchBlockedError)
    return `The website address can’t be checked (${error.message.toLowerCase()}).`
  if (error instanceof Error && /timed?\s*out|abort/i.test(`${error.name} ${error.message}`))
    return 'The website took too long to respond.'
  if (error instanceof Error && /ENOTFOUND|getaddrinfo/i.test(error.message))
    return 'The website address doesn’t exist any more.'
  return 'The website could not be opened.'
}

async function checkSitemap(origin: string): Promise<boolean | null> {
  const sources = leadSources()
  try {
    const sitemap = await sources.fetchPage(`${origin}/sitemap.xml`, {
      timeoutMs: 6_000,
      accept: 'application/xml,text/xml,*/*',
    })
    if (sitemap.status === 200 && /<(urlset|sitemapindex)\b/i.test(sitemap.text)) return true
    const robots = await sources.fetchPage(`${origin}/robots.txt`, { timeoutMs: 5_000, accept: 'text/plain,*/*' })
    return robots.status === 200 && /^\s*sitemap\s*:/im.test(robots.text)
  } catch {
    return null
  }
}

export async function auditWebsite(website: string | null): Promise<LeadAudit> {
  const audit: LeadAudit = {
    version: 1,
    checkedAt: new Date().toISOString(),
    website,
    site: null,
    siteError: null,
    speed: null,
    sitemap: null,
  }
  if (!website) return audit
  const sources = leadSources()
  try {
    const home = await sources.fetchPage(website, { timeoutMs: 12_000 })
    if (home.status >= 400) {
      audit.siteError = `The website returned an error (${home.status}).`
      return audit
    }
    let site: SiteSignals = analyzeHtml(home.text, home.url)
    const homeDomain = domainOf(home.url)
    if (site.contactPageUrl && domainOf(site.contactPageUrl) === homeDomain && site.contactPageUrl !== home.url) {
      try {
        const contact = await sources.fetchPage(site.contactPageUrl, { timeoutMs: 8_000 })
        if (contact.status < 400) site = mergeSignals(site, analyzeHtml(contact.text, contact.url))
      } catch {
        // The homepage is enough.
      }
    }
    audit.site = site
    audit.sitemap = await checkSitemap(new URL(home.url).origin)
  } catch (error) {
    audit.siteError = friendlyFetchError(error)
  }
  return audit
}

const runResearch: JobHandler = async (payload, job) => {
  const leadId = z.uuid().parse(payload.leadId)
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, organization_id: true, website: true, email: true, phone: true, status: true },
  })
  if (!lead || lead.status === 'DO_NOT_CONTACT') return
  await prisma.lead.update({ where: { id: lead.id }, data: { research_status: 'RUNNING' } })
  try {
    const audit = await auditWebsite(normaliseWebsite(lead.website))
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        audit: audit as unknown as Prisma.InputJsonValue,
        email: lead.email ?? audit.site?.emails[0] ?? null,
        phone: lead.phone ?? audit.site?.phones[0] ?? null,
      },
    })
    // PageSpeed works with or without a key (keyless is rate-limited; a refusal only drops the signal).
    if (audit.site) {
      await enqueueJob({
        type: 'lead.speed',
        organizationId: lead.organization_id,
        payload: { leadId: lead.id },
        dedupeKey: `lead.speed:${lead.id}`,
        maxAttempts: 2,
      })
    } else {
      await scoreAndSummarise(lead.id)
    }
  } catch (error) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        research_status: job.attempts >= 3 ? 'FAILED' : 'PENDING',
        research_error: (error instanceof Error ? error.message : String(error)).slice(0, 300),
      },
    })
    throw error
  }
}

const runSpeed: JobHandler = async (payload) => {
  const leadId = z.uuid().parse(payload.leadId)
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, organization_id: true, audit: true },
  })
  if (!lead) return
  const audit = lead.audit as unknown as LeadAudit | null
  if (audit?.site) {
    try {
      await countApiCall(lead.organization_id, PAGESPEED_API)
      audit.speed = await leadSources().pageSpeed(audit.site.finalUrl)
      await prisma.lead.update({ where: { id: lead.id }, data: { audit: audit as unknown as Prisma.InputJsonValue } })
    } catch (error) {
      // Speed is one signal among many: score without it.
      logger.info('PageSpeed check skipped', { leadId, error: error instanceof Error ? error.message : String(error) })
    }
  }
  await scoreAndSummarise(lead.id)
}

// ─── Score & summary ─────────────────────────────────────────────────────────

export interface LeadSummary {
  problems: { title: string; detail: string }[]
  services: string[]
  opener: string | null
}

export function leadFindings(lead: {
  audit: Prisma.JsonValue | null
  rating: number | null
  review_count: number | null
  industry: { checks: string[] } | null
}): Finding[] {
  const audit = lead.audit as unknown as LeadAudit | null
  if (!audit) return []
  return findingsFor(audit, {
    checks: industryChecks(lead.industry?.checks ?? []),
    rating: lead.rating,
    reviewCount: lead.review_count,
  })
}

export function rulesSummary(findings: Finding[]): LeadSummary {
  return {
    problems: findings.slice(0, 3).map((f) => ({ title: f.title, detail: f.detail })),
    services: servicesFor(findings)
      .slice(0, 3)
      .map((s) => s.name),
    opener: null,
  }
}

/** Findings → score → tier; a private audit page for HOT / WARM leads; summary queued. */
export async function scoreAndSummarise(leadId: string) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { industry: { select: { checks: true, priority: true } } },
  })
  if (!lead) return
  const settings = await growthSettings.get(lead.organization_id)
  const findings = leadFindings(lead)
  const score = scoreLead({
    findings,
    industryPriority: lead.industry?.priority ?? 2,
    rating: lead.rating,
    reviewCount: lead.review_count,
    hasEmail: Boolean(lead.email),
    hasPhone: Boolean(lead.phone),
    businessStatus: lead.business_status,
  })
  const keep = score.tier !== 'SKIP'
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      tier: score.tier,
      need_score: score.need,
      fit_score: score.fit,
      score_reasons: score.reasons,
      research_status: 'DONE',
      research_error: null,
      researched_at: new Date(),
      summary: rulesSummary(findings) as unknown as Prisma.InputJsonValue,
      summary_source: 'RULES',
      ...(keep && !lead.audit_token
        ? { audit_token: newAuditToken(), audit_expires_at: new Date(Date.now() + settings.auditPageDays * DAY_MS) }
        : {}),
    },
  })
  if (keep && settings.aiSummaries) {
    await enqueueJob({
      type: 'lead.summary',
      organizationId: lead.organization_id,
      payload: { leadId: lead.id },
      dedupeKey: `lead.summary:${lead.id}`,
      maxAttempts: 2,
    })
  }
}

const aiSummarySchema = z.object({
  problems: z
    .array(z.object({ title: z.string().min(2).max(120), detail: z.string().min(5).max(300) }))
    .min(1)
    .max(3),
  services: z.array(z.string()).max(5).catch([]),
  opener: z.string().max(300).nullable().catch(null),
})

const runSummary: JobHandler = async (payload) => {
  const leadId = z.uuid().parse(payload.leadId)
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { industry: { select: { name: true, checks: true } } },
  })
  if (!lead || lead.tier === 'SKIP') return
  const provider = getAIProvider()
  const [ai, settings] = await Promise.all([
    aiSettingsService.get(lead.organization_id),
    growthSettings.get(lead.organization_id),
  ])
  if (!provider || !ai.enabled || !settings.aiSummaries) return
  const findings = leadFindings(lead)
  if (!findings.length) return
  const services = servicesFor(findings).map((s) => s.name)
  const started = Date.now()
  const { data, result } = await generateStructured(provider, aiSummarySchema, {
    messages: buildLeadSummaryMessages({
      businessName: lead.name,
      industry: lead.industry?.name ?? lead.category,
      city: lead.city,
      findings: findings
        .slice(0, 8)
        .map((f) => ({ title: f.title, detail: f.detail, severity: f.severity, service: AYAVA_SERVICES[f.service] })),
      services,
      proof: settings.proof,
    }),
    maxTokens: 700,
  })
  const allowed = new Set<string>(Object.values(AYAVA_SERVICES))
  const summary: LeadSummary = {
    problems: data.problems,
    services: data.services.filter((s) => allowed.has(s)).slice(0, 3),
    opener: data.opener,
  }
  if (!summary.services.length) summary.services = services.slice(0, 3)
  await prisma.lead.update({
    where: { id: lead.id },
    data: { summary: summary as unknown as Prisma.InputJsonValue, summary_source: 'AI' },
  })
  await prisma.aiUsageEvent.create({
    data: {
      organization_id: lead.organization_id,
      feature: 'LEADS',
      intent: 'lead_summary',
      provider: result.provider,
      model: result.model,
      tokens_input: result.usage.input,
      tokens_output: result.usage.output,
      latency_ms: Date.now() - started,
      success: true,
    },
  })
}

export const LEAD_JOB_HANDLERS: Record<string, JobHandler> = {
  'lead.search': runSearch,
  'lead.research': runResearch,
  'lead.speed': runSpeed,
  'lead.summary': runSummary,
}
