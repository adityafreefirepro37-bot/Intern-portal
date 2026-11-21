import 'server-only'
import { LEAD_JOB_HANDLERS, scheduleLeadWork } from '../leads/pipeline'
import { runJobs } from './queue'

/** Every job type the worker runs. */
export const JOB_HANDLERS = { ...LEAD_JOB_HANDLERS }

/**
 * One worker run (POST /api/jobs/worker every few minutes, or `npm run jobs:worker`):
 * queue the next Growth searches inside today's allowance, then run queued jobs
 * until the time budget is used.
 */
export async function runWorker(budgetMs = 50_000) {
  const scheduled = await scheduleLeadWork()
  const jobs = await runJobs({ handlers: JOB_HANDLERS, budgetMs, concurrency: 8, jobTimeoutMs: 45_000 })
  return { scheduled, jobs }
}
