import { NextResponse, type NextRequest } from 'next/server'
import { jsonError, jsonSuccess } from '@/lib/http/response'
import { aiJobs } from '@/server/ai/settings.service'
import { cronAuthorized } from '@/server/jobs/auth'
import { pruneJobs } from '@/server/jobs/queue'
import { announcementJobs } from '@/server/services/announcement.service'
import { checkinJobs } from '@/server/services/checkin.service'
import { documentJobs } from '@/server/services/document.service'
import { goalJobs } from '@/server/services/goal.service'
import { internLifecycleService } from '@/server/services/intern-lifecycle.service'
import { learningJobs } from '@/server/services/learning-analytics.service'
import { notificationDeliveryService } from '@/server/services/notification-delivery.service'
import { assessmentJobs } from '@/server/services/assessment.service'
import { reviewJobs } from '@/server/services/performance-review.service'
import { workJobsService } from '@/server/services/work-jobs.service'

export const dynamic = 'force-dynamic'

/**
 * POST /api/jobs/daily — scheduled maintenance, once a day (Supabase pg_cron via
 * `npm run scheduler:setup`, or any cron service):
 *   1. ACTIVE → ENDING_SOON for internships inside the threshold
 *   2. `onboarding.item_overdue` events for items that became overdue
 *   3. task due-soon / overdue and milestone due-soon events (notifications)
 *   4. documents past their expiry → EXPIRED, expiring-soon reminders
 *   5. scheduled announcements that are due → published (+ notifications)
 *   6. learning deadlines (due in 3 days / overdue), goal target-date reminders
 *   7. weekly check-in reminders (Monday: open, Friday: due) and overdue reviews
 *   8. AI retention: old conversations and usage records, expired proposals
 *   9. Notification emails still waiting (each run sends up to 200)
 *  10. Assessments: submit attempts whose time ran out; delete recordings past retention
 *  11. Background jobs: finished ones kept 7 days, failed ones 30
 * Every step is idempotent. Requires `Authorization: Bearer $CRON_SECRET`.
 */
export async function POST(request: NextRequest) {
  if (!cronAuthorized(request)) return NextResponse.json({ success: false }, { status: 404 })
  try {
    const endingSoon = await internLifecycleService.markEndingSoon()
    const overdue = await internLifecycleService.emitOverdueOnboarding()
    const deadlines = await workJobsService.emitTaskDeadlines()
    const documents = await documentJobs.run()
    const announcements = await announcementJobs.publishDue()
    const learning = await learningJobs.emitDeadlines()
    const goals = await goalJobs.emitDeadlines()
    const checkins = await checkinJobs.emitReminders()
    const reviews = await reviewJobs.emitOverdue()
    const ai = await aiJobs.applyRetention()
    const emails = await notificationDeliveryService.flush(200)
    const assessments = await assessmentJobs.maintenance()
    const backgroundJobs = await pruneJobs()
    return jsonSuccess({
      endingSoon: endingSoon.marked,
      overdueEvents: overdue.emitted,
      ...deadlines,
      documentsExpired: documents.expired,
      documentReminders: documents.warned,
      announcementsPublished: announcements.published,
      ...learning,
      ...goals,
      ...checkins,
      ...reviews,
      aiRetention: ai,
      notificationEmails: emails,
      assessments,
      backgroundJobs,
    })
  } catch (error) {
    return jsonError(error, { route: 'jobs.daily' })
  }
}
