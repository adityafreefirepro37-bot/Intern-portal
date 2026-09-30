import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { config } from '@/lib/config'
import { jsonError, jsonSuccess } from '@/lib/http/response'
import { announcementJobs } from '@/server/services/announcement.service'
import { documentJobs } from '@/server/services/document.service'
import { internLifecycleService } from '@/server/services/intern-lifecycle.service'
import { workJobsService } from '@/server/services/work-jobs.service'

export const dynamic = 'force-dynamic'

function authorized(request: NextRequest): boolean {
  const secret = config.jobs.cronSecret
  const header = request.headers.get('authorization') ?? ''
  if (!secret || !header.startsWith('Bearer ')) return false
  const given = Buffer.from(header.slice(7))
  const expected = Buffer.from(secret)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/**
 * POST /api/jobs/daily — scheduled maintenance (call once a day from a cron
 * service such as Vercel Cron or GitHub Actions):
 *   1. ACTIVE → ENDING_SOON for internships inside the threshold
 *   2. `onboarding.item_overdue` events for items that became overdue
 *   3. task due-soon / overdue and milestone due-soon events (notifications)
 *   4. documents past their expiry → EXPIRED, expiring-soon reminders
 *   5. scheduled announcements that are due → published (+ notifications)
 * Every step is idempotent. Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ success: false }, { status: 404 })
  try {
    const endingSoon = await internLifecycleService.markEndingSoon()
    const overdue = await internLifecycleService.emitOverdueOnboarding()
    const deadlines = await workJobsService.emitTaskDeadlines()
    const documents = await documentJobs.run()
    const announcements = await announcementJobs.publishDue()
    return jsonSuccess({
      endingSoon: endingSoon.marked,
      overdueEvents: overdue.emitted,
      ...deadlines,
      documentsExpired: documents.expired,
      documentReminders: documents.warned,
      announcementsPublished: announcements.published,
    })
  } catch (error) {
    return jsonError(error, { route: 'jobs.daily' })
  }
}
