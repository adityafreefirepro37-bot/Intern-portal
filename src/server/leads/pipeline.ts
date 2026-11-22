import 'server-only'
import { randomBytes } from 'node:crypto'
import type { LeadSource, Prisma } from '@prisma/client'
import { z } from 'zod'
import { buildLeadSummaryMessages } from '@/lib/ai/prompts'
import { prisma } from '@/lib/db/client'
import {
  analyzeHtml,
  AUDIT_VERSION,
  findingsFor,
  instagramHandle,
  mergeSignals,
  ownEmails,
  servicesFor,
  websiteSettled,
  type Finding,
  type LeadAudit,
  type SearchVisibility,
  type SiteSignals,
  type WebsiteLookup,
} from '@/lib/leads/audit'
import { reviewLead } from '@/lib/leads/review'
import { AYAVA_SERVICES, INDUSTRY_CHECKS, type IndustryCheck } from '@/lib/leads/catalog'
import { scoreLead } from '@/lib/leads/score'
import { domainGuesses, isDirectory, matchSite, NAME_ONLY } from '@/lib/leads/site-match'
import { logger } from '@/lib/logging'
import { generateStructured, getAIProvider } from '../ai/provider'
import { aiSettingsService } from '../ai/settings.service'
import { NOTIFICATION_TYPES, notificationService, usersWithPermission } from '../services/notification.service'
import { enqueueJob, type JobHandler } from '../jobs/queue'
import { domainOf, FetchBlockedError, normaliseWebsite } from './safe-fetch'
import {
  apiCalls,
  BRAVE_API,
  cityPositions,
  countApiCall,
  growthSettings,
  INSTAGRAM_API,
  YOUTUBE_API,
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
 *                     ↳ lead.find_site  no website listed: likely addresses, then a web search,
 *                                       each page proven to be the business's before it's used
 *                  ─► lead.speed     PageSpeed Insights (mobile): speed + Lighthouse SEO / accessibility
 *                  ─► lead.presence  search visibility (Brave), Instagram and YouTube the site links to
 *                  ─► score          findings → need / fit → HOT / WARM / SKIP (+ private audit page)
 *                  ─► review         AUTO (email sequence) or TEAM (serious cases, the team is told)
 *                  ─► lead.summary   AI words the top problems (rules-based summary until then)
 *
 * TomTom, Google and Brave usage is capped per day and per month (Growth settings) so
 * it stays inside the free allowance. Suppressed businesses (opted out) are never imported.
 * Searches rotate through industries, and only addresses a business publishes itself are used.
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
    queued += await queueUpgradesAndLookups(organizationId, settings)
    if ((await leadsAddedToday(organizationId)) >= settings.newLeadsDailyCap) continue

    for (const paged of pagedSources(settings)) {
      if (!paged.on) continue
      const usage = await apiCalls(organizationId, paged.api)
      const left = Math.min(paged.dailyCap - usage.today, paged.monthlyCap - usage.month)
      if (left > 0) {
        const next = await nextSearches(organizationId, paged.source, Math.min(left, 2))
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
      const [next] = await nextSearches(organizationId, 'OPENSTREETMAP', 1)
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

/**
 * The next searches for a source, rotating through industries: the industry
 * searched least recently goes first (never-searched ones first of all, by
 * priority), and within it the city / term searched least recently.
 */
async function nextSearches(organizationId: string, source: LeadSource, take: number) {
  if (take <= 0) return []
  const where = { organization_id: organizationId, source, active: true }
  const [runs, open] = await Promise.all([
    prisma.leadSearch.groupBy({ by: ['industry_id'], where, _max: { last_run_at: true } }),
    prisma.leadSearch.groupBy({ by: ['industry_id'], where: { ...where, exhausted: false } }),
  ])
  const hasOpen = new Set(open.map((r) => r.industry_id))
  const priorities = new Map(
    (
      await prisma.leadIndustry.findMany({
        where: { id: { in: [...hasOpen] } },
        select: { id: true, priority: true },
      })
    ).map((i) => [i.id, i.priority]),
  )
  const industries = runs
    .filter((r) => hasOpen.has(r.industry_id))
    .sort(
      (a, b) =>
        (a._max.last_run_at?.getTime() ?? 0) - (b._max.last_run_at?.getTime() ?? 0) ||
        (priorities.get(a.industry_id) ?? 9) - (priorities.get(b.industry_id) ?? 9),
    )
  const picked: { id: string; city: string }[] = []
  for (const { industry_id } of industries) {
    if (picked.length >= take) break
    const search = await prisma.leadSearch.findFirst({
      where: { ...where, exhausted: false, industry_id },
      orderBy: [{ last_run_at: { sort: 'asc', nulls: 'first' } }, { created_at: 'asc' }],
      select: { id: true, city: true },
    })
    if (search) picked.push(search)
  }
  return picked
}

/**
 * Every run, a few leads are moved along: ones researched with an older audit
 * format are researched again, and ones whose website is still unknown get their
 * web search once there's allowance for it.
 */
async function queueUpgradesAndLookups(organizationId: string, settings: GrowthSettings) {
  let queued = 0
  const stale = await prisma.lead.findMany({
    where: {
      organization_id: organizationId,
      status: 'NEW',
      research_status: 'DONE',
      OR: Array.from({ length: AUDIT_VERSION - 1 }, (_, i) => ({ audit: { path: ['version'], equals: i + 1 } })),
    },
    orderBy: { created_at: 'asc' },
    take: 20,
    select: { id: true },
  })
  for (const lead of stale)
    if (
      await enqueueJob({
        type: 'lead.research',
        organizationId,
        payload: { leadId: lead.id },
        dedupeKey: `lead.research:${lead.id}`,
      })
    )
      queued++

  const left = await siteSearchesLeft(organizationId, settings)
  if (left > 0) {
    const waiting = await prisma.lead.findMany({
      where: {
        organization_id: organizationId,
        status: 'NEW',
        research_status: 'DONE',
        website: null,
        audit: { path: ['websiteLookup', 'result'], equals: 'waiting' },
      },
      orderBy: { created_at: 'asc' },
      take: Math.min(left, 6),
      select: { id: true },
    })
    for (const lead of waiting)
      if (
        await enqueueJob({
          type: 'lead.find_site',
          organizationId,
          payload: { leadId: lead.id, phase: 'search' },
          dedupeKey: `lead.find_site:search:${lead.id}`,
          maxAttempts: 2,
        })
      )
        queued++
  }
  return queued
}

/** Web searches still allowed today (0 when there's no key or it's switched off). */
async function siteSearchesLeft(organizationId: string, settings: GrowthSettings) {
  if (!settings.siteSearchEnabled || !leadSources().webSearchConfigured()) return 0
  const usage = await apiCalls(organizationId, BRAVE_API)
  return Math.max(0, Math.min(settings.siteSearchDailyCap - usage.today, settings.siteSearchMonthlyCap - usage.month))
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

function todayStart() {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  return start
}

async function leadsAddedToday(organizationId: string) {
  return prisma.lead.count({
    where: { organization_id: organizationId, created_at: { gte: todayStart() }, source: { not: 'MANUAL' } },
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
  // Searches run in parallel: one import at a time per organization, so the daily cap holds.
  const created = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lead-import:${organizationId}`}))`
      let room = Math.max(
        0,
        dailyCap -
          (await tx.lead.count({
            where: { organization_id: organizationId, created_at: { gte: todayStart() }, source: { not: 'MANUAL' } },
          })),
      )
      const ids: string[] = []
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
    const duplicate = await tx.lead.findFirst({
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
    const lead = await tx.lead
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
    if (!lead) continue
    ids.push(lead.id)
    room--
  }
      return ids
    },
    { maxWait: 20_000, timeout: 30_000 },
  )
  for (const id of created)
    await enqueueJob({ type: 'lead.research', organizationId, payload: { leadId: id }, dedupeKey: `lead.research:${id}` })
  return { found: businesses.length, added: created.length }
}

const runSearch: JobHandler = async (payload, job) => {
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
      const businesses = await leadSources().osmSearch(search.city, search.industry.osm_tags, job.attempts)
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

interface SitemapInfo {
  found: boolean | null
  pages: number | null
  latest: string | null
}

function readSitemap(xml: string) {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!)
  const dates = [...xml.matchAll(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/gi)]
    .map((m) => new Date(m[1]!).getTime())
    .filter((t) => !Number.isNaN(t) && t <= Date.now() + 86_400_000)
  return { locs, latest: dates.length ? new Date(Math.max(...dates)).toISOString() : null }
}

/** Whether there is a sitemap, how many pages it lists and its newest "last modified" date. */
async function checkSitemap(origin: string): Promise<SitemapInfo> {
  const sources = leadSources()
  const xml = { accept: 'application/xml,text/xml,*/*' }
  try {
    const sitemap = await sources.fetchPage(`${origin}/sitemap.xml`, { timeoutMs: 6_000, ...xml })
    if (sitemap.status === 200 && /<(urlset|sitemapindex)\b/i.test(sitemap.text)) {
      const top = readSitemap(sitemap.text)
      if (!/<sitemapindex\b/i.test(sitemap.text)) return { found: true, pages: top.locs.length, latest: top.latest }
      // An index: count the first child sitemap's pages (enough to judge size).
      const child = top.locs.find((loc) => domainOf(loc) === domainOf(origin))
      const sub = child ? await sources.fetchPage(child, { timeoutMs: 6_000, ...xml }).catch(() => null) : null
      const inner = sub && sub.status === 200 ? readSitemap(sub.text) : null
      const latest = [top.latest, inner?.latest].filter(Boolean).sort().at(-1) ?? null
      return { found: true, pages: inner ? Math.max(inner.locs.length, top.locs.length) : top.locs.length, latest }
    }
    const robots = await sources.fetchPage(`${origin}/robots.txt`, { timeoutMs: 5_000, accept: 'text/plain,*/*' })
    return { found: robots.status === 200 && /^\s*sitemap\s*:/im.test(robots.text), pages: null, latest: null }
  } catch {
    return { found: null, pages: null, latest: null }
  }
}

async function checkFavicon(origin: string, declared: boolean | undefined): Promise<boolean | null> {
  if (declared) return true
  try {
    const icon = await leadSources().fetchPage(`${origin}/favicon.ico`, { timeoutMs: 5_000, accept: 'image/*,*/*' })
    return icon.status === 200 && /image|icon|octet-stream/i.test(icon.contentType)
  } catch {
    return null
  }
}

export async function auditWebsite(website: string | null): Promise<LeadAudit> {
  const audit: LeadAudit = {
    version: AUDIT_VERSION,
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
    const origin = new URL(home.url).origin
    const [sitemap, favicon] = await Promise.all([checkSitemap(origin), checkFavicon(origin, site.faviconLink)])
    audit.sitemap = sitemap.found
    audit.sitemapPages = sitemap.pages
    audit.sitemapLatest = sitemap.latest
    audit.favicon = favicon
  } catch (error) {
    audit.siteError = friendlyFetchError(error)
  }
  return audit
}

/**
 * The email to use from what the site publishes: the business's own (its domain,
 * or a free mailbox it shows), with a working mail server, and not opted out.
 */
async function publishedEmail(organizationId: string, site: SiteSignals | null): Promise<string | null> {
  if (!site) return null
  const suppressed = (await suppressionSets(organizationId)).EMAIL
  for (const email of ownEmails(site.emails, site.finalUrl)) {
    if (suppressed.has(email)) continue
    if (await leadSources().hasMailServer(email.split('@')[1]!)) return email
  }
  return null
}

const runResearch: JobHandler = async (payload, job) => {
  const leadId = z.uuid().parse(payload.leadId)
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, organization_id: true, website: true, email: true, phone: true, status: true, audit: true },
  })
  if (!lead || lead.status === 'DO_NOT_CONTACT') return
  await prisma.lead.update({ where: { id: lead.id }, data: { research_status: 'RUNNING' } })
  const previous = lead.audit as unknown as LeadAudit | null
  const website = normaliseWebsite(lead.website)
  // No website listed and none looked for yet: find it first (lead.find_site comes back here).
  if (!website && !previous?.websiteLookup) {
    await enqueueJob({
      type: 'lead.find_site',
      organizationId: lead.organization_id,
      payload: { leadId: lead.id, phase: 'guess' },
      dedupeKey: `lead.find_site:${lead.id}`,
      maxAttempts: 2,
    })
    return
  }
  try {
    const audit = await auditWebsite(website)
    audit.websiteSource = website ? (previous?.websiteSource ?? 'listing') : null
    audit.websiteLookup = previous?.websiteLookup ?? null
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        audit: audit as unknown as Prisma.InputJsonValue,
        email: lead.email ?? (await publishedEmail(lead.organization_id, audit.site)),
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

// ─── Finding a website the listing doesn't have ─────────────────────────────

const FIND_SITE_FETCH_MS = 6_000
const MAX_CANDIDATES = 3
/** Stop opening candidates after this long, so a lookup job ends inside its 45 s limit. */
const FIND_SITE_BUDGET_MS = 26_000

async function tryCandidate(
  url: string,
  lead: { name: string; city: string | null; phone: string | null },
  tried: WebsiteLookup['tried'],
): Promise<string | null> {
  try {
    const page = await leadSources().fetchPage(url, { timeoutMs: FIND_SITE_FETCH_MS })
    if (page.status >= 400 || !page.text) {
      tried.push({ url, reason: `error ${page.status}` })
      return null
    }
    let match = matchSite({ url: page.url, html: page.text }, lead)
    // Right name, but the phone number / city isn't on this page: they're usually on the contact page.
    const contactUrl = match.reason === NAME_ONLY ? analyzeHtml(page.text, page.url).contactPageUrl : null
    if (contactUrl && domainOf(contactUrl) === domainOf(page.url)) {
      const contact = await leadSources()
        .fetchPage(contactUrl, { timeoutMs: 5_000 })
        .catch(() => null)
      if (contact && contact.status < 400)
        match = matchSite({ url: page.url, html: `${page.text}\n${contact.text}` }, lead)
    }
    tried.push({ url, reason: match.reason })
    return match.ok ? `${new URL(page.url).origin}/` : null
  } catch (error) {
    tried.push({ url, reason: friendlyFetchError(error).replace(/\.$/, '').toLowerCase() })
    return null
  }
}

/**
 * Looks for the business's own website. Phase `guess`: likely addresses built
 * from the name (free, no API). Phase `search`: Brave web search, counted
 * against its allowance. A page is used only when it proves to be the
 * business's (see matchSite). Then the lead is researched again.
 */
const runFindSite: JobHandler = async (payload) => {
  const leadId = z.uuid().parse(payload.leadId)
  const phase = z.enum(['guess', 'search']).parse(payload.phase ?? 'guess')
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, organization_id: true, name: true, city: true, phone: true, website: true, status: true, audit: true },
  })
  if (!lead || lead.status === 'DO_NOT_CONTACT') return
  const previous = lead.audit as unknown as LeadAudit | null
  const lookup: WebsiteLookup = {
    result: 'waiting',
    guessed: previous?.websiteLookup?.guessed ?? false,
    searched: previous?.websiteLookup?.searched ?? false,
    checkedAt: new Date().toISOString(),
    tried: [...(previous?.websiteLookup?.tried ?? [])].slice(-12),
  }
  const settings = await growthSettings.get(lead.organization_id)
  const sources = leadSources()
  const started = Date.now()
  const inTime = () => Date.now() - started < FIND_SITE_BUDGET_MS
  let found: string | null = null
  let source: 'guess' | 'search' | null = null

  if (!lead.website) {
    if (phase === 'guess') {
      const guesses = domainGuesses(lead.name, lead.city)
      const live = await Promise.all(guesses.map((url) => sources.hostResolves(new URL(url).hostname)))
      for (const url of guesses.filter((_, i) => live[i]).slice(0, MAX_CANDIDATES)) {
        if (!inTime()) break
        found = await tryCandidate(url, lead, lookup.tried)
        if (found) break
      }
      lookup.guessed = true
      if (found) source = 'guess'
    } else if ((await siteSearchesLeft(lead.organization_id, settings)) > 0) {
      await countApiCall(lead.organization_id, BRAVE_API)
      try {
        const results = await sources.webSearch(`"${lead.name}" ${lead.city ?? ''}`.trim())
        const seen = new Set<string>()
        const candidates: string[] = []
        for (const r of results) {
          const url = normaliseWebsite(r.url)
          const domain = domainOf(url)
          if (!url || !domain || isDirectory(url) || seen.has(domain)) continue
          seen.add(domain)
          candidates.push(url)
        }
        for (const url of candidates.slice(0, MAX_CANDIDATES)) {
          if (!inTime()) break
          found = await tryCandidate(url, lead, lookup.tried)
          if (found) break
        }
        lookup.searched = true
        if (found) source = 'search'
      } catch (error) {
        // Stays "waiting": the scheduler tries the search again on a later run.
        logger.info('Website search skipped', { leadId, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  if (found) {
    lookup.result = 'found'
    const domain = domainOf(found)
    if (domain && (await suppressionSets(lead.organization_id)).DOMAIN.has(domain)) {
      // The business opted out before (under its website): never contact it.
      await prisma.lead.update({ where: { id: lead.id }, data: { status: 'DO_NOT_CONTACT', research_status: 'DONE' } })
      return
    }
  } else if (lookup.searched) {
    lookup.result = 'not_found'
  } else if (phase === 'guess' && (await siteSearchesLeft(lead.organization_id, settings)) > 0) {
    // Guesses failed: search the web next (its own job, it has its own time budget).
    await prisma.lead.update({
      where: { id: lead.id },
      data: { audit: { ...(previous ?? {}), websiteLookup: lookup } as unknown as Prisma.InputJsonValue },
    })
    await enqueueJob({
      type: 'lead.find_site',
      organizationId: lead.organization_id,
      payload: { leadId: lead.id, phase: 'search' },
      dedupeKey: `lead.find_site:search:${lead.id}`,
      maxAttempts: 2,
    })
    return
  }

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      ...(found ? { website: found } : {}),
      audit: {
        ...(previous ?? {}),
        websiteSource: source,
        websiteLookup: lookup,
      } as unknown as Prisma.InputJsonValue,
    },
  })
  await enqueueJob({
    type: 'lead.research',
    organizationId: lead.organization_id,
    payload: { leadId: lead.id },
    dedupeKey: `lead.research:${lead.id}`,
  })
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
  await enqueueJob({
    type: 'lead.presence',
    organizationId: lead.organization_id,
    payload: { leadId: lead.id },
    dedupeKey: `lead.presence:${lead.id}`,
    maxAttempts: 2,
  })
}

// ─── Online presence: search visibility, Instagram, YouTube ──────────────────

const SERP_REFRESH_DAYS = 30

/**
 * Where the site appears in a web search for the industry in its city. One
 * search per industry × city, cached for a month and shared by every lead.
 */
async function searchVisibility(
  organizationId: string,
  settings: GrowthSettings,
  term: string | undefined,
  city: string | null,
  domain: string | null,
): Promise<SearchVisibility | null> {
  if (!term || !city || !domain) return null
  const query = `${term} ${city}`.toLowerCase()
  const flightKey = `${organizationId}|${query}`
  // Leads checked at the same moment share one search.
  let pending = serpInFlight.get(flightKey)
  if (!pending) {
    pending = freshSerp(organizationId, settings, query).finally(() => serpInFlight.delete(flightKey))
    serpInFlight.set(flightKey, pending)
  }
  const cached = await pending
  if (!cached) return null
  const top = (cached.domains as string[]).slice(0, 10)
  const ours = (d: string) => d === domain || d.endsWith(`.${domain}`) || domain.endsWith(`.${d}`)
  const index = top.findIndex(ours)
  return {
    query,
    position: index === -1 ? null : index + 1,
    competitors: [...new Set(top.filter((d) => !ours(d) && !isDirectory(`https://${d}/`)))].slice(0, 3),
    checkedAt: cached.checked_at.toISOString(),
  }
}

const serpInFlight = new Map<string, Promise<{ domains: Prisma.JsonValue; checked_at: Date } | null>>()

/** The cached results for a query, searched again when older than a month (and there's allowance). */
async function freshSerp(organizationId: string, settings: GrowthSettings, query: string) {
  const key = { organization_id_query: { organization_id: organizationId, query } }
  const cached = await prisma.leadSerp.findUnique({ where: key })
  if (cached && cached.checked_at.getTime() >= Date.now() - SERP_REFRESH_DAYS * DAY_MS) return cached
  if ((await siteSearchesLeft(organizationId, settings)) <= 0) return cached
  await countApiCall(organizationId, BRAVE_API)
  try {
    const results = await leadSources().webSearch(query, 20)
    const domains = results.map((r) => domainOf(r.url)).filter((d): d is string => Boolean(d))
    return await prisma.leadSerp.upsert({
      where: key,
      update: { domains, checked_at: new Date() },
      create: { organization_id: organizationId, query, domains },
    })
  } catch (error) {
    logger.info('Search visibility check skipped', { query, error: error instanceof Error ? error.message : String(error) })
    return cached
  }
}

async function underCap(organizationId: string, api: string, cap: number) {
  return (await apiCalls(organizationId, api)).today < cap
}

const runPresence: JobHandler = async (payload) => {
  const leadId = z.uuid().parse(payload.leadId)
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, organization_id: true, city: true, audit: true, industry: { select: { search_terms: true } } },
  })
  if (!lead) return
  const audit = lead.audit as unknown as LeadAudit | null
  if (audit?.site) {
    const settings = await growthSettings.get(lead.organization_id)
    const sources = leadSources()
    const skip = (what: string) => (error: unknown) => {
      logger.info(`${what} check skipped`, { leadId, error: error instanceof Error ? error.message : String(error) })
      return null
    }
    audit.search = await searchVisibility(
      lead.organization_id,
      settings,
      lead.industry?.search_terms[0],
      lead.city,
      domainOf(audit.site.finalUrl),
    ).catch(skip('Search visibility'))
    const handle = instagramHandle(audit.site.socials.instagram)
    if (handle && sources.instagramConfigured() && (await underCap(lead.organization_id, INSTAGRAM_API, settings.instagramDailyCap))) {
      await countApiCall(lead.organization_id, INSTAGRAM_API)
      audit.instagram = await sources.instagramProfile(handle).catch(skip('Instagram'))
    }
    const youtube = audit.site.socials.youtube
    if (youtube && sources.youtubeConfigured() && (await underCap(lead.organization_id, YOUTUBE_API, settings.youtubeDailyCap))) {
      await countApiCall(lead.organization_id, YOUTUBE_API)
      audit.youtube = await sources.youtubeChannel(youtube).catch(skip('YouTube'))
    }
    await prisma.lead.update({ where: { id: lead.id }, data: { audit: audit as unknown as Prisma.InputJsonValue } })
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
    include: { industry: { select: { checks: true, priority: true, key: true } } },
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
    websiteSettled: websiteSettled(lead.audit as unknown as LeadAudit | null),
    requireEmail: settings.requireEmail,
  })
  const keep = score.tier !== 'SKIP'
  const review = reviewLead({
    tier: score.tier,
    hasEmail: Boolean(lead.email),
    industryKey: lead.industry?.key ?? null,
    reviewCount: lead.review_count,
    audit: lead.audit as unknown as LeadAudit | null,
    bigBusinessSignals: settings.bigBusinessSignals,
  })
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      tier: score.tier,
      need_score: score.need,
      fit_score: score.fit,
      score_reasons: score.reasons,
      route: review.route,
      route_reasons: review.reasons,
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
  // A serious case is new for the team: tell the people who manage leads (once).
  if (review.route === 'TEAM' && lead.route !== 'TEAM' && lead.status !== 'DO_NOT_CONTACT') {
    const recipients = lead.assigned_to ? [lead.assigned_to] : await usersWithPermission(lead.organization_id, 'lead.manage')
    await notificationService.notify(
      lead.organization_id,
      recipients,
      {
        type: NOTIFICATION_TYPES.LEAD_TEAM,
        title: `Serious lead for the team: ${lead.name}`,
        body: review.reasons[0] ?? 'A Hot lead for personal outreach.',
        entityType: 'lead',
        entityId: lead.id,
      },
      null,
    )
  }
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
  'lead.find_site': runFindSite,
  'lead.speed': runSpeed,
  'lead.presence': runPresence,
  'lead.summary': runSummary,
}
