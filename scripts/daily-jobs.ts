/**
 * Runs the daily maintenance jobs once (same code as POST /api/jobs/daily):
 *   - ACTIVE → ENDING_SOON for internships inside the threshold
 *   - `onboarding.item_overdue` events for items that became overdue
 *   - task due-soon / overdue and milestone due-soon events
 *   - expired documents and expiry reminders
 *   - scheduled announcements that are due
 *
 *   npm run jobs:daily
 *
 * Safe to run repeatedly: both steps are idempotent.
 */
import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd())

async function main() {
  const { internLifecycleService } = await import('../src/server/services/intern-lifecycle.service')
  const { workJobsService } = await import('../src/server/services/work-jobs.service')
  const { documentJobs } = await import('../src/server/services/document.service')
  const { announcementJobs } = await import('../src/server/services/announcement.service')
  const { prisma } = await import('../src/lib/db/client')
  try {
    const endingSoon = await internLifecycleService.markEndingSoon()
    const overdue = await internLifecycleService.emitOverdueOnboarding()
    const deadlines = await workJobsService.emitTaskDeadlines()
    const documents = await documentJobs.run()
    const announcements = await announcementJobs.publishDue()
    console.log(`Ending soon: ${endingSoon.marked} intern(s) updated. Overdue onboarding events: ${overdue.emitted}.`)
    console.log(
      `Tasks due tomorrow: ${deadlines.dueSoon}. Newly overdue: ${deadlines.overdue}. Milestones due: ${deadlines.milestonesDue}.`,
    )
    console.log(
      `Documents expired: ${documents.expired}. Expiry reminders: ${documents.warned}. Announcements published: ${announcements.published}.`,
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
