/**
 * Runs the daily maintenance jobs once (same code as POST /api/jobs/daily):
 *   - ACTIVE → ENDING_SOON for internships inside the threshold
 *   - `onboarding.item_overdue` events for items that became overdue
 *
 *   npm run jobs:daily
 *
 * Safe to run repeatedly: both steps are idempotent.
 */
import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd())

async function main() {
  const { internLifecycleService } = await import('../src/server/services/intern-lifecycle.service')
  const { prisma } = await import('../src/lib/db/client')
  try {
    const endingSoon = await internLifecycleService.markEndingSoon()
    const overdue = await internLifecycleService.emitOverdueOnboarding()
    console.log(`Ending soon: ${endingSoon.marked} intern(s) updated. Overdue events: ${overdue.emitted}.`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
