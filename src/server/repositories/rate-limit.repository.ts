import 'server-only'
import { prisma } from '@/lib/db/client'
import type { RateLimitResult, RateLimitStore } from '@/lib/security/rate-limit'

/**
 * PostgreSQL fixed-window counters. A single atomic UPSERT increments the
 * bucket or starts a new window, so concurrent requests on any number of
 * instances are counted correctly.
 */
export class PostgresRateLimitStore implements RateLimitStore {
  async increment(key: string, windowMs: number, limit: number): Promise<RateLimitResult> {
    const now = new Date()
    const nextReset = new Date(now.getTime() + windowMs)
    const rows = await prisma.$queryRaw<{ count: number; reset_at: Date }[]>`
      INSERT INTO "rate_limit_buckets" ("key", "count", "reset_at")
      VALUES (${key}, 1, ${nextReset})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "rate_limit_buckets"."reset_at" <= ${now} THEN 1 ELSE "rate_limit_buckets"."count" + 1 END,
        "reset_at" = CASE WHEN "rate_limit_buckets"."reset_at" <= ${now} THEN ${nextReset} ELSE "rate_limit_buckets"."reset_at" END
      RETURNING "count", "reset_at"`
    const row = rows[0]

    // Opportunistic cleanup of long-expired buckets (about 1% of calls).
    if (Math.random() < 0.01) {
      await prisma.rateLimitBucket
        .deleteMany({ where: { reset_at: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } })
        .catch(() => undefined)
    }
    return toResult(Number(row.count), row.reset_at, limit, now)
  }

  async peek(key: string, limit: number): Promise<RateLimitResult> {
    const now = new Date()
    const row = await prisma.rateLimitBucket.findUnique({ where: { key } })
    if (!row || row.reset_at <= now) return { allowed: true, remaining: limit, retryAfterSeconds: 0 }
    return toResult(row.count, row.reset_at, limit, now)
  }

  async reset(key: string): Promise<void> {
    await prisma.rateLimitBucket.deleteMany({ where: { key } })
  }
}

function toResult(count: number, resetAt: Date, limit: number, now: Date): RateLimitResult {
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)),
  }
}
