import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import { logger } from '@/lib/logging'

/**
 * A small database-backed job queue (table `background_jobs`). Work is enqueued
 * by services and run by the scheduled worker (POST /api/jobs/worker, every few
 * minutes). Jobs are claimed with FOR UPDATE SKIP LOCKED, so overlapping worker
 * runs never take the same job. A failed job is retried with backoff
 * (1, 4, 9… minutes) until `max_attempts`, then left FAILED with its error.
 */

export interface JobContext {
  id: string
  organizationId: string | null
  attempts: number
}

export type JobHandler = (payload: Record<string, unknown>, job: JobContext) => Promise<void>

export interface EnqueueInput {
  type: string
  payload?: Record<string, unknown>
  organizationId?: string | null
  /** At most one queued/running job per key; a duplicate enqueue is ignored. */
  dedupeKey?: string
  runAfter?: Date
  maxAttempts?: number
}

/** Running jobs not finished after this long (a crashed worker) are released. */
const STALE_LOCK_MS = 10 * 60_000

export async function enqueueJob(input: EnqueueInput): Promise<boolean> {
  const rows = await prisma.$executeRaw`
    INSERT INTO "background_jobs" ("organization_id", "type", "payload", "dedupe_key", "run_after", "max_attempts")
    VALUES (${input.organizationId ?? null}::uuid, ${input.type}, ${JSON.stringify(input.payload ?? {})}::jsonb,
            ${input.dedupeKey ?? null}, ${input.runAfter ?? new Date()}, ${input.maxAttempts ?? 3})
    ON CONFLICT ("dedupe_key") WHERE "dedupe_key" IS NOT NULL AND "status" IN ('QUEUED', 'RUNNING') DO NOTHING`
  return rows > 0
}

export async function enqueueJobs(inputs: EnqueueInput[]): Promise<number> {
  let added = 0
  for (const input of inputs) if (await enqueueJob(input)) added++
  return added
}

interface ClaimedJob {
  id: string
  organization_id: string | null
  type: string
  payload: Prisma.JsonValue
  attempts: number
  max_attempts: number
}

async function releaseStale() {
  const cutoff = new Date(Date.now() - STALE_LOCK_MS)
  await prisma.$executeRaw`
    UPDATE "background_jobs"
       SET "status" = CASE WHEN "attempts" >= "max_attempts" THEN 'FAILED'::"BackgroundJobStatus" ELSE 'QUEUED'::"BackgroundJobStatus" END,
           "locked_at" = NULL,
           "last_error" = 'The worker stopped before this job finished',
           "finished_at" = CASE WHEN "attempts" >= "max_attempts" THEN now() ELSE NULL END
     WHERE "status" = 'RUNNING' AND "locked_at" < ${cutoff}`
}

async function claim(limit: number, types: string[]): Promise<ClaimedJob[]> {
  return prisma.$queryRaw<ClaimedJob[]>`
    UPDATE "background_jobs" j
       SET "status" = 'RUNNING', "locked_at" = now(), "attempts" = j."attempts" + 1
     WHERE j."id" IN (
       SELECT "id" FROM "background_jobs"
        WHERE "status" = 'QUEUED' AND "run_after" <= now() AND "type" = ANY(${types}::text[])
        ORDER BY "run_after"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
    RETURNING j."id"::text AS "id", j."organization_id"::text AS "organization_id", j."type", j."payload",
              j."attempts", j."max_attempts"`
}

async function finish(job: ClaimedJob, error: unknown) {
  if (!error) {
    await prisma.backgroundJob.update({ where: { id: job.id }, data: { status: 'DONE', locked_at: null, finished_at: new Date(), last_error: null } })
    return
  }
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500)
  const final = job.attempts >= job.max_attempts
  await prisma.backgroundJob.update({
    where: { id: job.id },
    data: {
      status: final ? 'FAILED' : 'QUEUED',
      locked_at: null,
      last_error: message,
      finished_at: final ? new Date() : null,
      run_after: new Date(Date.now() + job.attempts * job.attempts * 60_000),
    },
  })
  if (final) logger.warn('Background job failed', { type: job.type, jobId: job.id, error: message })
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${Math.round(ms / 1000)} s`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export interface RunOptions {
  handlers: Record<string, JobHandler>
  /** Stop starting new batches after this long. */
  budgetMs: number
  /** Jobs run in parallel per batch. */
  concurrency?: number
  /** A single job is abandoned (and retried later) after this long. */
  jobTimeoutMs?: number
}

export async function runJobs(options: RunOptions) {
  const started = Date.now()
  const concurrency = options.concurrency ?? 6
  const jobTimeoutMs = options.jobTimeoutMs ?? 45_000
  const types = Object.keys(options.handlers)
  const stats = { done: 0, failed: 0, batches: 0 }
  await releaseStale()
  // Start a batch only when it can finish inside the budget.
  while (Date.now() - started + jobTimeoutMs <= options.budgetMs || stats.batches === 0) {
    const jobs = await claim(concurrency, types)
    if (!jobs.length) break
    stats.batches++
    await Promise.all(
      jobs.map(async (job) => {
        const handler = options.handlers[job.type]!
        let error: unknown = null
        try {
          const payload = (job.payload && typeof job.payload === 'object' && !Array.isArray(job.payload) ? job.payload : {}) as Record<string, unknown>
          await withTimeout(handler(payload, { id: job.id, organizationId: job.organization_id, attempts: job.attempts }), jobTimeoutMs)
        } catch (e) {
          error = e ?? new Error('Job failed')
        }
        await finish(job, error)
        if (error) stats.failed++
        else stats.done++
      }),
    )
  }
  return { ...stats, ms: Date.now() - started }
}

/** Housekeeping for the daily job: finished jobs are kept 7 days, failed ones 30. */
export async function pruneJobs() {
  const day = 86_400_000
  const done = await prisma.backgroundJob.deleteMany({ where: { status: 'DONE', finished_at: { lt: new Date(Date.now() - 7 * day) } } })
  const failed = await prisma.backgroundJob.deleteMany({ where: { status: 'FAILED', finished_at: { lt: new Date(Date.now() - 30 * day) } } })
  return { done: done.count, failed: failed.count }
}
