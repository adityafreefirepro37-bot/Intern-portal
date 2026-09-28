import { createHash } from 'node:crypto'

/** Stable organization id for Ayava Creatives (referenced by seeds and tests). */
export const AYAVA_ORGANIZATION_ID = '6f1d3b52-8a4e-4c1f-9b2d-3e7a5c9d0a11'

const NAMESPACE = AYAVA_ORGANIZATION_ID.replace(/-/g, '')

/**
 * Deterministic RFC 4122 v5 UUID for a seed record, so re-running the seed
 * updates the same rows instead of creating duplicates.
 */
export function seedId(name: string): string {
  const hash = createHash('sha1').update(Buffer.from(NAMESPACE, 'hex')).update(name).digest()
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

const DAY = 24 * 60 * 60 * 1000

/** A timestamp `offset` days from `base`, at `hourUtc` (default 12:00 UTC ≈ 17:30 IST). */
export function daysFrom(base: Date, offset: number, hourUtc = 12): Date {
  const date = new Date(base.getTime() + offset * DAY)
  date.setUTCHours(hourUtc, 0, 0, 0)
  return date
}

/** A calendar date (UTC midnight) `offset` days from `base`. */
export function dateFrom(base: Date, offset: number): Date {
  const date = new Date(base.getTime() + offset * DAY)
  date.setUTCHours(0, 0, 0, 0)
  return date
}
