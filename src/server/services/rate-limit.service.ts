import { createHash } from 'node:crypto'
import { AppError } from '@/lib/errors'
import { RATE_LIMITS, type RateLimitName, type RateLimitStore } from '@/lib/security/rate-limit'
import { PostgresRateLimitStore } from '../repositories/rate-limit.repository'

let store: RateLimitStore = new PostgresRateLimitStore()

/** Keys are hashed so raw IPs and email addresses are never stored. */
function bucketKey(name: RateLimitName, identifier: string): string {
  const digest = createHash('sha256').update(identifier.toLowerCase()).digest('hex').slice(0, 40)
  return `${name}:${digest}`
}

export class RateLimitedError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super('RATE_LIMITED', `Too many attempts. Please try again in ${formatWait(retryAfterSeconds)}.`)
    this.name = 'RateLimitedError'
  }
}

function formatWait(seconds: number): string {
  if (seconds < 90) return `${seconds} seconds`
  return `${Math.ceil(seconds / 60)} minutes`
}

export const rateLimitService = {
  /** Counts one attempt; throws RateLimitedError when the limit is exceeded. */
  async consume(name: RateLimitName, identifier: string): Promise<void> {
    const { windowMs, limit } = RATE_LIMITS[name]
    const result = await store.increment(bucketKey(name, identifier), windowMs, limit)
    if (!result.allowed) throw new RateLimitedError(result.retryAfterSeconds)
  },

  /** Throws if the limit is already exhausted, without counting an attempt. */
  async check(name: RateLimitName, identifier: string): Promise<void> {
    const result = await store.peek(bucketKey(name, identifier), RATE_LIMITS[name].limit)
    if (!result.allowed || result.remaining <= 0) throw new RateLimitedError(Math.max(result.retryAfterSeconds, 1))
  },

  async reset(name: RateLimitName, identifier: string): Promise<void> {
    await store.reset(bucketKey(name, identifier))
  },

  /** Test seam. */
  useStoreForTesting(next: RateLimitStore) {
    store = next
  },
}
