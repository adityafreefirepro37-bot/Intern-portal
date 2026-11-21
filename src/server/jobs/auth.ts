import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import { config } from '@/lib/config'

/** `Authorization: Bearer $CRON_SECRET` (constant-time). Without a secret, scheduled endpoints stay closed. */
export function cronAuthorized(request: Request): boolean {
  const secret = config.jobs.cronSecret
  const header = request.headers.get('authorization') ?? ''
  if (!secret || !header.startsWith('Bearer ')) return false
  const given = Buffer.from(header.slice(7))
  const expected = Buffer.from(secret)
  return given.length === expected.length && timingSafeEqual(given, expected)
}
