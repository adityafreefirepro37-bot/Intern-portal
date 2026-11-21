import { NextResponse, type NextRequest } from 'next/server'
import { jsonError, jsonSuccess } from '@/lib/http/response'
import { cronAuthorized } from '@/server/jobs/auth'
import { runWorker } from '@/server/jobs/worker'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/jobs/worker — the background worker, called every few minutes by the
 * scheduler (Supabase pg_cron; `npm run scheduler:setup`). Queues the next Growth
 * searches inside today's Google allowance and runs queued jobs for up to ~50 s.
 * Requires `Authorization: Bearer $CRON_SECRET`; 404 without it.
 */
export async function POST(request: NextRequest) {
  if (!cronAuthorized(request)) return NextResponse.json({ success: false }, { status: 404 })
  try {
    return jsonSuccess(await runWorker())
  } catch (error) {
    return jsonError(error, { route: 'jobs.worker' })
  }
}
