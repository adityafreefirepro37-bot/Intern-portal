import 'server-only'
import { LEAD_JOB_HANDLERS, scheduleLeadWork } from '../leads/pipeline'
import { OUTREACH_JOB_HANDLERS, scheduleOutreach } from '../outreach/engine'
import { runJobs } from './queue'

/** Every job type the worker runs. */
export const JOB_HANDLERS = { ...LEAD_JOB_HANDLERS, ...OUTREACH_JOB_HANDLERS }

/**
 * One worker run (POST /api/jobs/worker every few minutes, or `npm run jobs:worker`):
 * queue the next Growth searches inside today's allowance and the outreach work
 * (drafts, sending in business hours, inbox checks), then run queued jobs until
 * the time budget is used.
 */
export async function runWorker(budgetMs = 50_000) {
  const leads = await scheduleLeadWork()
  const outreach = await scheduleOutreach()
  const scheduled = { queued: leads.queued + outreach.queued }
  const jobs = await runJobs({ handlers: JOB_HANDLERS, budgetMs, concurrency: 8, jobTimeoutMs: 45_000 })
  return { scheduled, jobs }
}
