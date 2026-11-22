import type { LeadAudit } from './audit'

/**
 * The review after scoring: who contacts the lead. Hot leads that look like a
 * big business go to the team for personal outreach; other Hot and Warm leads
 * with a published email get the automatic email sequence. Skipped leads get no
 * route. Pure function; every decision comes with its reasons.
 */

/** Industries where one client is worth a personal approach. */
export const HIGH_VALUE_INDUSTRIES = new Set([
  'real_estate',
  'healthcare',
  'hospitality_travel',
  'fintech_finance',
  'fashion_luxury',
  'schools_colleges',
  'automotive',
  'adventure_resorts',
  'jewellery',
  'study_abroad',
])

export interface ReviewInput {
  tier: 'HOT' | 'WARM' | 'SKIP'
  hasEmail: boolean
  industryKey: string | null
  reviewCount: number | null
  audit: LeadAudit | null
  /** Size signals needed for "big business" (default 2). */
  bigBusinessSignals?: number
}

export interface LeadReview {
  route: 'AUTO' | 'TEAM' | null
  reasons: string[]
}

/** Signs a business is large: each one found is a reason. */
export function sizeSignals(input: Pick<ReviewInput, 'industryKey' | 'reviewCount' | 'audit'>): string[] {
  const out: string[] = []
  const audit = input.audit
  if (input.reviewCount !== null && input.reviewCount >= 100) out.push(`${input.reviewCount} Google reviews`)
  if (audit?.instagram && audit.instagram.followers >= 5000) out.push(`${audit.instagram.followers.toLocaleString('en-IN')} Instagram followers`)
  if (audit?.youtube?.subscribers != null && audit.youtube.subscribers >= 2000) out.push(`${audit.youtube.subscribers.toLocaleString('en-IN')} YouTube subscribers`)
  if (audit?.sitemapPages != null && audit.sitemapPages >= 50) out.push(`${audit.sitemapPages} pages on the website`)
  if (audit?.site && (audit.site.metaPixel || audit.site.googleAds)) out.push('already pays for ads (tracking on the site)')
  if (input.industryKey && HIGH_VALUE_INDUSTRIES.has(input.industryKey)) out.push('high-value industry')
  return out
}

export function reviewLead(input: ReviewInput): LeadReview {
  if (input.tier === 'SKIP') return { route: null, reasons: [] }
  const signals = sizeSignals(input)
  const needed = input.bigBusinessSignals ?? 2
  if (input.tier === 'HOT' && signals.length >= needed)
    return { route: 'TEAM', reasons: [`Team: a Hot lead that looks like a big business (${signals.join(', ')})`] }
  if (!input.hasEmail) return { route: 'TEAM', reasons: ['Team: no published email, so it needs a call'] }
  return {
    route: 'AUTO',
    reasons: [`Automatic email: ${input.tier === 'HOT' ? 'Hot' : 'Warm'} lead${signals.length ? ` (${signals.join(', ')})` : ''}`],
  }
}
