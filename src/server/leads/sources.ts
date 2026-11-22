import 'server-only'
import { resolve4, resolve6, resolveMx } from 'node:dns/promises'
import { z } from 'zod'
import { config } from '@/lib/config'
import type { InstagramProfile, SpeedResult, YouTubeChannel } from '@/lib/leads/audit'
import { safeFetch, type FetchedPage } from './safe-fetch'

/**
 * External data sources for Growth: TomTom Search (free developer key, no card),
 * Google Places API (New) text search, OpenStreetMap (Overpass, free), PageSpeed
 * Insights (speed + Lighthouse SEO / accessibility), Brave Search (finding a
 * business's own website, search visibility), the Instagram Graph API and the
 * YouTube Data API (public profiles the site links to) and the business
 * websites themselves. Each is a small client behind an
 * interface so tests swap in fakes (setLeadSourcesForTests).
 */

export interface FoundBusiness {
  externalId: string
  name: string
  category: string | null
  address: string | null
  phone: string | null
  website: string | null
  email: string | null
  mapsUrl: string | null
  rating: number | null
  reviewCount: number | null
  businessStatus: string | null
  latitude: number | null
  longitude: number | null
}

export interface SearchPage {
  businesses: FoundBusiness[]
  nextPageToken: string | null
}

export interface LeadSources {
  placesConfigured(): boolean
  placesTextSearch(query: string, pageToken: string | null): Promise<SearchPage>
  tomtomConfigured(): boolean
  /** City centre (one TomTom call; the pipeline caches it). */
  tomtomGeocode(city: string): Promise<{ lat: number; lon: number } | null>
  /** Up to 100 businesses matching `term` within ~15 km of the point; the page token is the next offset. */
  tomtomSearch(term: string, near: { lat: number; lon: number }, pageToken: string | null): Promise<SearchPage>
  /** `attempt` (1, 2, 3…) picks the Overpass server, so a retry goes to another one. */
  osmSearch(city: string, tags: string[], attempt?: number): Promise<FoundBusiness[]>
  webSearchConfigured(): boolean
  /** Web results for a query (Brave Search API, India; up to 20). */
  webSearch(query: string, count?: number): Promise<{ url: string; title: string }[]>
  instagramConfigured(): boolean
  /** A public Instagram business / creator profile, or null when there's none under that name. */
  instagramProfile(handle: string): Promise<InstagramProfile | null>
  youtubeConfigured(): boolean
  /** The channel a YouTube link points to, or null when it can't be resolved cheaply. */
  youtubeChannel(url: string): Promise<YouTubeChannel | null>
  /** Whether a host name exists in DNS (cheap check before opening a guessed address). */
  hostResolves(host: string): Promise<boolean>
  /** Whether a domain accepts email (has MX records): only such addresses are kept. */
  hasMailServer(domain: string): Promise<boolean>
  pageSpeed(url: string): Promise<SpeedResult>
  /** A business web page (SSRF-safe; see safe-fetch.ts). */
  fetchPage(url: string, options?: { timeoutMs?: number; accept?: string }): Promise<FetchedPage>
}

const placeSchema = z.object({
  id: z.string(),
  displayName: z.object({ text: z.string() }).partial().optional(),
  formattedAddress: z.string().optional(),
  primaryTypeDisplayName: z.object({ text: z.string() }).partial().optional(),
  nationalPhoneNumber: z.string().optional(),
  internationalPhoneNumber: z.string().optional(),
  websiteUri: z.string().optional(),
  googleMapsUri: z.string().optional(),
  rating: z.number().optional(),
  userRatingCount: z.number().optional(),
  businessStatus: z.string().optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }).partial().optional(),
})

const searchResponseSchema = z.object({ places: z.array(placeSchema).optional(), nextPageToken: z.string().optional() })

// Only the fields used (they decide the SKU: website / phone / rating make it "Text Search Enterprise").
const PLACES_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.primaryTypeDisplayName',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
  'places.location',
  'nextPageToken',
].join(',')

async function googleError(response: Response, what: string): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string; status?: string } } | null
  return new Error(
    `${what} failed (${response.status}${body?.error?.status ? ` ${body.error.status}` : ''}): ${body?.error?.message?.slice(0, 200) ?? response.statusText}`,
  )
}

/** Instagram Graph API version (supported for about two years after release). */
const GRAPH_VERSION = 'v22.0'

const TOMTOM_PAGE = 100
/** TomTom serves at most 2,000 results per query (offset + limit). */
const TOMTOM_MAX_OFFSET = 1900
const TOMTOM_RADIUS_M = 15_000

const tomtomResultSchema = z.object({
  id: z.string(),
  type: z.string().optional(),
  poi: z
    .object({
      name: z.string().optional(),
      phone: z.string().optional(),
      url: z.string().optional(),
      categories: z.array(z.string()).optional(),
    })
    .optional(),
  address: z.object({ freeformAddress: z.string().optional() }).partial().optional(),
  position: z.object({ lat: z.number(), lon: z.number() }).partial().optional(),
})

const tomtomResponseSchema = z.object({
  summary: z
    .object({ numResults: z.number().optional(), offset: z.number().optional(), totalResults: z.number().optional() })
    .partial()
    .optional(),
  results: z.array(tomtomResultSchema).default([]),
})

async function tomtomGet(path: string, params: Record<string, string>) {
  const key = config.leads.tomtomApiKey
  if (!key) throw new Error('TOMTOM_API_KEY is not set')
  const query = new URLSearchParams({ ...params, key })
  const response = await fetch(`https://api.tomtom.com/search/2/${path}?${query}`, {
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      errorText?: string
      detailedError?: { message?: string }
    } | null
    throw new Error(
      `TomTom search failed (${response.status}): ${(body?.detailedError?.message ?? body?.errorText ?? response.statusText).slice(0, 200)}`,
    )
  }
  return tomtomResponseSchema.parse(await response.json())
}

/** A Google Maps search link, so reviewers can open the business's listing (reviews, photos). */
function mapsSearchUrl(name: string, address: string | null) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([name, address].filter(Boolean).join(' '))}`
}

/** Public Overpass servers: the main one is often overloaded, so retries move down the list. */
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

const braveResponseSchema = z.object({
  web: z
    .object({ results: z.array(z.object({ url: z.string(), title: z.string().default('') })).default([]) })
    .optional(),
})

const osmElementSchema = z.object({
  type: z.string(),
  id: z.number(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  center: z.object({ lat: z.number(), lon: z.number() }).optional(),
  tags: z.record(z.string(), z.string()).optional(),
})

function osmQuery(city: string, tags: string[]): string {
  const name = city.replace(/["\\]/g, '')
  const filters = tags
    .map((tag) => tag.split('='))
    .filter(
      (parts): parts is [string, string] =>
        parts.length === 2 && /^[a-z_:]+$/.test(parts[0]!) && /^[a-z_]+$/.test(parts[1]!),
    )
    .map(([key, value]) => `  nwr["${key}"="${value}"]["name"](area.a);`)
    .join('\n')
  return `[out:json][timeout:25];\narea["boundary"="administrative"]["name"="${name}"]->.a;\n(\n${filters}\n);\nout center tags 300;`
}

const realSources: LeadSources = {
  fetchPage: (url, options) => safeFetch(url, options),

  placesConfigured: () => Boolean(config.leads.googleApiKey),

  async placesTextSearch(query, pageToken) {
    const key = config.leads.googleApiKey
    if (!key) throw new Error('GOOGLE_MAPS_API_KEY is not set')
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key, 'x-goog-fieldmask': PLACES_FIELD_MASK },
      body: JSON.stringify({
        textQuery: query,
        pageSize: 20,
        regionCode: 'IN',
        languageCode: 'en',
        ...(pageToken ? { pageToken } : {}),
      }),
    })
    if (!response.ok) throw await googleError(response, 'Google Places search')
    const data = searchResponseSchema.parse(await response.json())
    return {
      nextPageToken: data.nextPageToken ?? null,
      businesses: (data.places ?? [])
        .filter((p) => p.displayName?.text)
        .map((p) => ({
          externalId: p.id,
          name: p.displayName!.text!,
          category: p.primaryTypeDisplayName?.text ?? null,
          address: p.formattedAddress ?? null,
          phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? null,
          website: p.websiteUri ?? null,
          email: null,
          mapsUrl: p.googleMapsUri ?? null,
          rating: p.rating ?? null,
          reviewCount: p.userRatingCount ?? null,
          businessStatus: p.businessStatus ?? null,
          latitude: p.location?.latitude ?? null,
          longitude: p.location?.longitude ?? null,
        })),
    }
  },

  tomtomConfigured: () => Boolean(config.leads.tomtomApiKey),

  async tomtomGeocode(city) {
    const data = await tomtomGet(`geocode/${encodeURIComponent(city)}.json`, { countrySet: 'IN', limit: '1' })
    const position = data.results[0]?.position
    return position?.lat !== undefined && position.lon !== undefined ? { lat: position.lat, lon: position.lon } : null
  },

  async tomtomSearch(term, near, pageToken) {
    const offset = Number(pageToken ?? 0) || 0
    const data = await tomtomGet(`poiSearch/${encodeURIComponent(term)}.json`, {
      countrySet: 'IN',
      lat: String(near.lat),
      lon: String(near.lon),
      radius: String(TOMTOM_RADIUS_M),
      limit: String(TOMTOM_PAGE),
      ofs: String(offset),
      language: 'en-GB',
    })
    const total = data.summary?.totalResults ?? 0
    const next = offset + TOMTOM_PAGE
    return {
      nextPageToken:
        data.results.length === TOMTOM_PAGE && next < total && next <= TOMTOM_MAX_OFFSET ? String(next) : null,
      businesses: data.results
        .filter((r) => r.poi?.name)
        .map((r) => {
          const address = r.address?.freeformAddress ?? null
          return {
            externalId: r.id,
            name: r.poi!.name!,
            category: r.poi?.categories?.[0] ?? null,
            address,
            phone: r.poi?.phone ?? null,
            website: r.poi?.url ?? null,
            email: null,
            mapsUrl: mapsSearchUrl(r.poi!.name!, address),
            rating: null,
            reviewCount: null,
            businessStatus: null,
            latitude: r.position?.lat ?? null,
            longitude: r.position?.lon ?? null,
          }
        }),
    }
  },

  async osmSearch(city, tags, attempt = 1) {
    if (!tags.length) return []
    const server = OVERPASS_URLS[(Math.max(1, attempt) - 1) % OVERPASS_URLS.length]!
    const response = await fetch(server, {
      method: 'POST',
      signal: AbortSignal.timeout(40_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'AyavaGrowth/1.0 (business directory research)' },
      body: new URLSearchParams({ data: osmQuery(city, tags) }),
    })
    if (!response.ok) throw new Error(`OpenStreetMap search failed (${response.status} from ${new URL(server).host})`)
    const data = z.object({ elements: z.array(osmElementSchema).default([]) }).parse(await response.json())
    return data.elements
      .filter((e) => e.tags?.name)
      .map((e) => {
        const t = e.tags!
        const address = [t['addr:housenumber'], t['addr:street'], t['addr:suburb'], t['addr:city']]
          .filter(Boolean)
          .join(', ')
        return {
          externalId: `${e.type}/${e.id}`,
          name: t.name!,
          category:
            tags
              .find((tag) => t[tag.split('=')[0]!] === tag.split('=')[1])
              ?.split('=')[1]
              ?.replace(/_/g, ' ') ?? null,
          address: address || null,
          phone: t.phone ?? t['contact:phone'] ?? t.mobile ?? null,
          website: t.website ?? t['contact:website'] ?? t.url ?? null,
          email: t.email ?? t['contact:email'] ?? null,
          mapsUrl: `https://www.openstreetmap.org/${e.type}/${e.id}`,
          rating: null,
          reviewCount: null,
          businessStatus: null,
          latitude: e.lat ?? e.center?.lat ?? null,
          longitude: e.lon ?? e.center?.lon ?? null,
        }
      })
  },

  webSearchConfigured: () => Boolean(config.leads.braveApiKey),

  async webSearch(query, count = 10) {
    const key = config.leads.braveApiKey
    if (!key) throw new Error('BRAVE_SEARCH_API_KEY is not set')
    const params = new URLSearchParams({ q: query, country: 'IN', count: String(Math.min(20, count)), safesearch: 'moderate' })
    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      signal: AbortSignal.timeout(15_000),
      headers: { accept: 'application/json', 'x-subscription-token': key },
    })
    if (!response.ok) throw new Error(`Brave search failed (${response.status})`)
    const data = braveResponseSchema.parse(await response.json())
    return data.web?.results ?? []
  },

  instagramConfigured: () => Boolean(config.leads.instagramToken && config.leads.instagramBusinessId),

  async instagramProfile(handle) {
    const { instagramToken: token, instagramBusinessId: id } = config.leads
    if (!token || !id) throw new Error('Instagram is not configured')
    if (!/^[A-Za-z0-9_.]{1,30}$/.test(handle)) return null
    const fields = `business_discovery.username(${handle}){username,followers_count,media_count,media.limit(6){timestamp,like_count,comments_count}}`
    const params = new URLSearchParams({ fields, access_token: token })
    const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(id)}?${params}`, {
      signal: AbortSignal.timeout(15_000),
    })
    const data = (await response.json().catch(() => null)) as {
      business_discovery?: {
        username?: string
        followers_count?: number
        media_count?: number
        media?: { data?: { timestamp?: string; like_count?: number; comments_count?: number }[] }
      }
      error?: { code?: number; error_subcode?: number; message?: string }
    } | null
    if (!response.ok || !data?.business_discovery) {
      // 110 / 100: no business or creator account under that name (personal accounts aren't visible).
      if (data?.error?.code === 110 || data?.error?.code === 100) return null
      throw new Error(`Instagram lookup failed (${response.status}): ${data?.error?.message?.slice(0, 160) ?? 'no data'}`)
    }
    const profile = data.business_discovery
    const media = profile.media?.data ?? []
    const followers = profile.followers_count ?? 0
    const interactions = media.map((m) => (m.like_count ?? 0) + (m.comments_count ?? 0))
    return {
      handle: profile.username ?? handle,
      followers,
      posts: profile.media_count ?? 0,
      lastPostAt: media[0]?.timestamp ?? null,
      engagementPct:
        followers > 0 && interactions.length
          ? Math.round((interactions.reduce((a, b) => a + b, 0) / interactions.length / followers) * 1000) / 10
          : null,
    }
  },

  youtubeConfigured: () => Boolean(config.leads.youtubeApiKey),

  async youtubeChannel(url) {
    const key = config.leads.youtubeApiKey
    if (!key) throw new Error('YOUTUBE_API_KEY is not set')
    const handle = url.match(/youtube\.com\/@([A-Za-z0-9_.-]+)/i)?.[1]
    const channelId = url.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]{20,})/i)?.[1]
    const user = url.match(/youtube\.com\/user\/([A-Za-z0-9_.-]+)/i)?.[1]
    const lookup: Record<string, string> | null = handle
      ? { forHandle: `@${handle}` }
      : channelId
        ? { id: channelId }
        : user
          ? { forUsername: user }
          : null
    if (!lookup) return null // /c/ custom names need a 100-unit search: skipped.
    const get = async (path: string, params: Record<string, string>) => {
      const response = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...params, key })}`, {
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw await googleError(response, 'YouTube lookup')
      return response.json() as Promise<{ items?: Record<string, unknown>[] }>
    }
    const channels = await get('channels', { part: 'statistics,contentDetails', ...lookup })
    const channel = channels.items?.[0] as
      | {
          statistics?: { subscriberCount?: string; videoCount?: string; hiddenSubscriberCount?: boolean }
          contentDetails?: { relatedPlaylists?: { uploads?: string } }
        }
      | undefined
    if (!channel) return null
    const videos = Number(channel.statistics?.videoCount ?? 0)
    const uploads = channel.contentDetails?.relatedPlaylists?.uploads
    let lastUploadAt: string | null = null
    if (uploads && videos > 0) {
      const latest = await get('playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: '1' })
      lastUploadAt = ((latest.items?.[0] as { contentDetails?: { videoPublishedAt?: string } } | undefined)?.contentDetails?.videoPublishedAt) ?? null
    }
    return {
      url,
      subscribers: channel.statistics?.hiddenSubscriberCount ? null : Number(channel.statistics?.subscriberCount ?? 0),
      videos,
      lastUploadAt,
    }
  },

  async hostResolves(host) {
    const found = (lookup: Promise<string[]>) => lookup.then((a) => a.length > 0).catch(() => false)
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 4_000))
    return Promise.race([
      Promise.all([found(resolve4(host)), found(resolve6(host))]).then(([v4, v6]) => v4 || v6),
      timeout,
    ])
  },

  async hasMailServer(domain) {
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 4_000))
    return Promise.race([
      resolveMx(domain)
        .then((records) => records.some((r) => r.exchange && r.exchange !== '.'))
        .catch(() => false),
      timeout,
    ])
  },

  async pageSpeed(url) {
    const params = new URLSearchParams({ url, strategy: 'mobile' })
    for (const category of ['performance', 'seo', 'accessibility', 'best-practices']) params.append('category', category)
    // Works without a key too (shared, rate-limited quota): a refusal only drops the speed signal.
    if (config.leads.pagespeedApiKey) params.set('key', config.leads.pagespeedApiKey)
    const response = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, {
      signal: AbortSignal.timeout(40_000),
    })
    if (!response.ok) throw await googleError(response, 'PageSpeed check')
    const data = (await response.json()) as {
      lighthouseResult?: {
        categories?: Record<'performance' | 'seo' | 'accessibility' | 'best-practices', { score?: number | null } | undefined>
        audits?: Record<string, { numericValue?: number }>
      }
    }
    const categories = data.lighthouseResult?.categories
    const score = categories?.performance?.score
    if (typeof score !== 'number') throw new Error('PageSpeed returned no score')
    const audits = data.lighthouseResult?.audits ?? {}
    const pct = (value: number | null | undefined) => (typeof value === 'number' ? Math.round(value * 100) : null)
    return {
      performance: Math.round(score * 100),
      seo: pct(categories?.seo?.score),
      accessibility: pct(categories?.accessibility?.score),
      bestPractices: pct(categories?.['best-practices']?.score),
      lcpMs: audits['largest-contentful-paint']?.numericValue
        ? Math.round(audits['largest-contentful-paint'].numericValue)
        : null,
      cls: audits['cumulative-layout-shift']?.numericValue ?? null,
    }
  },
}

let active: LeadSources = realSources

export function leadSources(): LeadSources {
  return active
}

/** Tests only: replace the external sources (pass null to restore). */
export function setLeadSourcesForTests(sources: LeadSources | null) {
  active = sources ?? realSources
}

export { osmQuery as buildOsmQueryForTests }
