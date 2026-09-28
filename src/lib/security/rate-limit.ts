/**
 * Rate limiting primitives. The production store is PostgreSQL-backed
 * (src/server/repositories/rate-limit.repository.ts) so limits hold across
 * multiple server instances. The in-memory store exists for unit tests only.
 */
export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

export interface RateLimitStore {
  /** Adds one hit to `key` within a fixed window and reports whether it is within `limit`. */
  increment(key: string, windowMs: number, limit: number): Promise<RateLimitResult>
  /** Current state without adding a hit. */
  peek(key: string, limit: number): Promise<RateLimitResult>
  reset(key: string): Promise<void>
}

type MemoryEntry = { count: number; resetAt: number }

/** Test-only store: state lives in one process and is lost on restart. */
export class MemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, MemoryEntry>()

  async increment(key: string, windowMs: number, limit: number): Promise<RateLimitResult> {
    const now = Date.now()
    const current = this.buckets.get(key)
    if (!current || current.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs })
      return { allowed: 1 <= limit, remaining: Math.max(0, limit - 1), retryAfterSeconds: Math.ceil(windowMs / 1000) }
    }
    current.count += 1
    return toResult(current, limit, now)
  }

  async peek(key: string, limit: number): Promise<RateLimitResult> {
    const now = Date.now()
    const current = this.buckets.get(key)
    if (!current || current.resetAt <= now) return { allowed: true, remaining: limit, retryAfterSeconds: 0 }
    return toResult(current, limit, now)
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key)
  }
}

function toResult(entry: MemoryEntry, limit: number, now: number): RateLimitResult {
  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  }
}

/** Limits for sensitive operations (per window). */
export const RATE_LIMITS = {
  /** All sign-in attempts from one IP. */
  loginIp: { windowMs: 15 * 60 * 1000, limit: 50 },
  /** Failed sign-ins for one account (any IP) — slows password guessing. */
  loginAccount: { windowMs: 15 * 60 * 1000, limit: 8 },
  passwordReset: { windowMs: 60 * 60 * 1000, limit: 5 },
  passwordChange: { windowMs: 15 * 60 * 1000, limit: 5 },
  verificationResend: { windowMs: 60 * 60 * 1000, limit: 5 },
  invitationCreate: { windowMs: 60 * 60 * 1000, limit: 30 },
  invitationAccept: { windowMs: 15 * 60 * 1000, limit: 10 },
  sensitive: { windowMs: 60 * 1000, limit: 30 },
} as const

export type RateLimitName = keyof typeof RATE_LIMITS
