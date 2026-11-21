import 'server-only'
import { z } from 'zod'
import { config } from '@/lib/config'
import type { SpeedResult } from '@/lib/leads/audit'
import { safeFetch, type FetchedPage } from './safe-fetch'

/**
 * External data sources for Growth: Google Places API (New) text search,
 * OpenStreetMap (Overpass, free), PageSpeed Insights and the business websites themselves. Each is a small
 * client behind an interface so tests swap in fakes (setLeadSourcesForTests).
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
  osmSearch(city: string, tags: string[]): Promise<FoundBusiness[]>
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
  return new Error(`${what} failed (${response.status}${body?.error?.status ? ` ${body.error.status}` : ''}): ${body?.error?.message?.slice(0, 200) ?? response.statusText}`)
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

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
    .filter((parts): parts is [string, string] => parts.length === 2 && /^[a-z_:]+$/.test(parts[0]!) && /^[a-z_]+$/.test(parts[1]!))
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
      body: JSON.stringify({ textQuery: query, pageSize: 20, regionCode: 'IN', languageCode: 'en', ...(pageToken ? { pageToken } : {}) }),
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

  async osmSearch(city, tags) {
    if (!tags.length) return []
    const response = await fetch(OVERPASS_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(35_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'site-audit/1.0' },
      body: new URLSearchParams({ data: osmQuery(city, tags) }),
    })
    if (!response.ok) throw new Error(`OpenStreetMap search failed (${response.status})`)
    const data = z.object({ elements: z.array(osmElementSchema).default([]) }).parse(await response.json())
    return data.elements
      .filter((e) => e.tags?.name)
      .map((e) => {
        const t = e.tags!
        const address = [t['addr:housenumber'], t['addr:street'], t['addr:suburb'], t['addr:city']].filter(Boolean).join(', ')
        return {
          externalId: `${e.type}/${e.id}`,
          name: t.name!,
          category: tags.find((tag) => t[tag.split('=')[0]!] === tag.split('=')[1])?.split('=')[1]?.replace(/_/g, ' ') ?? null,
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

  async pageSpeed(url) {
    const params = new URLSearchParams({ url, strategy: 'mobile', category: 'performance' })
    if (config.leads.googleApiKey) params.set('key', config.leads.googleApiKey)
    const response = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, { signal: AbortSignal.timeout(40_000) })
    if (!response.ok) throw await googleError(response, 'PageSpeed check')
    const data = (await response.json()) as {
      lighthouseResult?: { categories?: { performance?: { score?: number | null } }; audits?: Record<string, { numericValue?: number }> }
    }
    const score = data.lighthouseResult?.categories?.performance?.score
    if (typeof score !== 'number') throw new Error('PageSpeed returned no score')
    const audits = data.lighthouseResult?.audits ?? {}
    return {
      performance: Math.round(score * 100),
      lcpMs: audits['largest-contentful-paint']?.numericValue ? Math.round(audits['largest-contentful-paint'].numericValue) : null,
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
