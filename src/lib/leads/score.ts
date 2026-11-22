import { SEVERITY_WEIGHT, type Finding } from './audit'

/**
 * Lead score: how much a business needs Ayava (need, from the audit findings)
 * and how good a prospect it is (fit). Tier = HOT / WARM / SKIP. Pure function;
 * every point comes with a reason the lead page shows.
 */

export interface ScoreInput {
  findings: Finding[]
  industryPriority: number
  rating: number | null
  reviewCount: number | null
  hasEmail: boolean
  hasPhone: boolean
  businessStatus: string | null
  /** False while the website is unknown (the listing had none and the web search hasn't run): no tier yet. */
  websiteSettled?: boolean
  /** Outreach is automatic by email, so a lead without a published email can't be worked (default true). */
  requireEmail?: boolean
}

export interface LeadScore {
  need: number
  fit: number
  tier: 'HOT' | 'WARM' | 'SKIP'
  reasons: string[]
}

export const SCORE_THRESHOLDS = { hot: { need: 40, fit: 55 }, warm: { need: 20, fit: 40 } } as const

export function scoreLead(input: ScoreInput): LeadScore {
  const reasons: string[] = []
  const need = Math.min(
    100,
    input.findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0),
  )
  const high = input.findings.filter((f) => f.severity === 'high').length
  reasons.push(`Need ${need}: ${input.findings.length} problem${input.findings.length === 1 ? '' : 's'} found (${high} serious)`)

  let fit = input.industryPriority === 1 ? 40 : input.industryPriority === 2 ? 30 : 20
  reasons.push(`Industry priority ${input.industryPriority}: +${fit}`)

  if (input.rating !== null) {
    const points = input.rating >= 4 ? 15 : input.rating >= 3.5 ? 10 : 5
    fit += points
    reasons.push(`Rating ${input.rating.toFixed(1)}: +${points}`)
  }
  if (input.reviewCount !== null && input.reviewCount > 0) {
    // Reviews are a proxy for size: more customers, more budget.
    const points = input.reviewCount >= 50 ? 20 : input.reviewCount >= 10 ? 12 : 6
    fit += points
    reasons.push(`${input.reviewCount} reviews: +${points}`)
  }
  const reach = Math.min(25, (input.hasEmail ? 15 : 0) + (input.hasPhone ? 10 : 0))
  if (reach) {
    fit += reach
    reasons.push(`Reachable (${[input.hasEmail && 'email', input.hasPhone && 'phone'].filter(Boolean).join(' + ')}): +${reach}`)
  }
  fit = Math.min(100, fit)

  let tier: LeadScore['tier']
  if (input.businessStatus && input.businessStatus !== 'OPERATIONAL') {
    tier = 'SKIP'
    reasons.push(`Skipped: business is ${input.businessStatus.toLowerCase().replace(/_/g, ' ')}`)
  } else if (input.websiteSettled === false) {
    // A website found later may publish an email: decide then.
    tier = 'SKIP'
    reasons.push('Waiting: website not found yet (searched again automatically)')
  } else if ((input.requireEmail ?? true) && !input.hasEmail) {
    tier = 'SKIP'
    reasons.push('Skipped: no published email address to contact them')
  } else if (!input.hasEmail && !input.hasPhone) {
    tier = 'SKIP'
    reasons.push('Skipped: no email or phone to reach them')
  } else if (need >= SCORE_THRESHOLDS.hot.need && fit >= SCORE_THRESHOLDS.hot.fit) {
    tier = 'HOT'
  } else if (need >= SCORE_THRESHOLDS.warm.need && fit >= SCORE_THRESHOLDS.warm.fit) {
    tier = 'WARM'
  } else {
    tier = 'SKIP'
    reasons.push(need < SCORE_THRESHOLDS.warm.need ? 'Skipped: few problems to fix' : 'Skipped: weak fit')
  }
  return { need, fit, tier, reasons }
}
