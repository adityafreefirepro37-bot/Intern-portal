/**
 * Runs the background worker once (same code as POST /api/jobs/worker): queues the
 * next Growth searches inside today's allowance and runs queued jobs.
 *
 *   npm run jobs:worker
 */
import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd())

async function main() {
  const { runWorker } = await import('../src/server/jobs/worker')
  const { prisma } = await import('../src/lib/db/client')
  try {
    const result = await runWorker(Number(process.env.WORKER_BUDGET_MS ?? 120_000))
    console.log(`Searches queued: ${result.scheduled.queued}. Jobs done: ${result.jobs.done}, failed: ${result.jobs.failed} (${Math.round(result.jobs.ms / 1000)} s).`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
