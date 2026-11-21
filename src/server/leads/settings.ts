import 'server-only'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { DEFAULT_CITIES } from '@/lib/leads/catalog'

/**
 * Growth settings per organization (row `settings.key = 'growth'`). The caps
 * keep paid APIs inside their free allowance: TomTom Search (free developer
 * key) returns up to 100 businesses per call; Google Text Search with website /
 * phone / rating is an "Enterprise" SKU with 1,000 free calls a month, each
 * returning up to 20 businesses.
 */

export const GROWTH_SETTINGS_KEY = 'growth'

export const growthSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  cities: z
    .array(z.string().trim().min(2).max(60))
    .max(40)
    .default([...DEFAULT_CITIES]),
  tomtomEnabled: z.boolean().default(true),
  tomtomDailyCap: z.number().int().min(0).max(2000).default(60),
  tomtomMonthlyCap: z.number().int().min(0).max(50000).default(2000),
  googleEnabled: z.boolean().default(true),
  osmEnabled: z.boolean().default(true),
  placesDailyCap: z.number().int().min(0).max(200).default(30),
  placesMonthlyCap: z.number().int().min(0).max(5000).default(950),
  newLeadsDailyCap: z.number().int().min(0).max(5000).default(300),
  aiSummaries: z.boolean().default(true),
  /** Verified facts about Ayava the AI may cite (results, portfolio). Nothing else is claimed. */
  proof: z.array(z.string().trim().min(3).max(300)).max(30).default([]),
  /** Days a business's private audit page stays open. */
  auditPageDays: z.number().int().min(7).max(365).default(90),
})

export type GrowthSettings = z.infer<typeof growthSettingsSchema>

export const growthSettings = {
  async get(organizationId: string): Promise<GrowthSettings> {
    const row = await prisma.setting.findUnique({
      where: { organization_id_key: { organization_id: organizationId, key: GROWTH_SETTINGS_KEY } },
    })
    const parsed = growthSettingsSchema.safeParse(row?.value ?? {})
    return parsed.success ? parsed.data : growthSettingsSchema.parse({})
  },

  async save(organizationId: string, value: GrowthSettings) {
    const data = growthSettingsSchema.parse(value)
    await prisma.setting.upsert({
      where: { organization_id_key: { organization_id: organizationId, key: GROWTH_SETTINGS_KEY } },
      update: { value: data },
      create: { organization_id: organizationId, key: GROWTH_SETTINGS_KEY, value: data },
    })
    return data
  },
}

/** Today's date (UTC) as stored in `lead_api_usage.day`. */
export function usageDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

export async function apiCalls(organizationId: string, api: string, now = new Date()) {
  const day = usageDay(now)
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const [today, month] = await Promise.all([
    prisma.leadApiUsage.findUnique({
      where: { organization_id_day_api: { organization_id: organizationId, day, api } },
      select: { calls: true },
    }),
    prisma.leadApiUsage.aggregate({
      where: { organization_id: organizationId, api, day: { gte: monthStart } },
      _sum: { calls: true },
    }),
  ])
  return { today: today?.calls ?? 0, month: month._sum.calls ?? 0 }
}

export async function countApiCall(organizationId: string, api: string, now = new Date()) {
  const day = usageDay(now)
  await prisma.leadApiUsage.upsert({
    where: { organization_id_day_api: { organization_id: organizationId, day, api } },
    update: { calls: { increment: 1 } },
    create: { organization_id: organizationId, day, api, calls: 1 },
  })
}

export const PLACES_API = 'places_text_search'
export const TOMTOM_API = 'tomtom_search'
export const PAGESPEED_API = 'pagespeed'

const GEO_KEY = 'growth_geo'

/** City centres for TomTom searches, cached so each city is geocoded once. */
export const cityPositions = {
  async get(organizationId: string): Promise<Record<string, { lat: number; lon: number } | null>> {
    const row = await prisma.setting.findUnique({
      where: { organization_id_key: { organization_id: organizationId, key: GEO_KEY } },
    })
    return (row?.value ?? {}) as Record<string, { lat: number; lon: number } | null>
  },
  async set(organizationId: string, city: string, position: { lat: number; lon: number } | null) {
    const all = { ...(await this.get(organizationId)), [city]: position }
    await prisma.setting.upsert({
      where: { organization_id_key: { organization_id: organizationId, key: GEO_KEY } },
      update: { value: all },
      create: { organization_id: organizationId, key: GEO_KEY, value: all },
    })
  },
}
