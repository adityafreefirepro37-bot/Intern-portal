/**
 * Schedules the portal's background work from Supabase (free, inside the database):
 *   ayava-daily   POST <url>/api/jobs/daily   every day at 06:00 IST
 *   ayava-worker  POST <url>/api/jobs/worker  every 5 minutes (Growth lead research)
 *
 *   npm run scheduler:setup -- --url https://your-portal.example.com
 *   npm run scheduler:setup -- --status
 *   npm run scheduler:setup -- --remove
 *
 * Uses pg_cron + pg_net. CRON_SECRET (from .env) is stored in Supabase Vault, never in
 * the job's SQL. The same CRON_SECRET must be set in the hosting environment (Vercel).
 * Run against the production database (DIRECT_URL / DATABASE_URL in .env).
 */
import { loadEnvConfig } from '@next/env'
import { Client } from 'pg'

loadEnvConfig(process.cwd())

const JOBS = [
  { name: 'ayava-daily', schedule: '30 0 * * *', path: '/api/jobs/daily' },
  { name: 'ayava-worker', schedule: '*/5 * * * *', path: '/api/jobs/worker' },
]

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function command(path: string): string {
  const secret = "(select decrypted_secret from vault.decrypted_secrets where name = 'ayava_cron_secret')"
  const url = "(select decrypted_secret from vault.decrypted_secrets where name = 'ayava_app_url')"
  return `select net.http_post(url := ${url} || '${path}', headers := jsonb_build_object('Authorization', 'Bearer ' || ${secret}, 'Content-Type', 'application/json'), body := '{}'::jsonb, timeout_milliseconds := 65000)`
}

async function upsertSecret(client: Client, name: string, value: string) {
  const existing = await client.query('select id from vault.secrets where name = $1', [name])
  if (existing.rows.length) await client.query('select vault.update_secret($1, $2)', [existing.rows[0].id, value])
  else await client.query('select vault.create_secret($1, $2)', [value, name])
}

async function status(client: Client) {
  const jobs = await client.query("select jobname, schedule, active from cron.job where jobname like 'ayava-%' order by jobname")
  if (!jobs.rows.length) console.log('No portal jobs are scheduled.')
  for (const j of jobs.rows) console.log(`  ${j.jobname.padEnd(14)} ${j.schedule.padEnd(12)} ${j.active ? 'active' : 'paused'}`)
  const runs = await client.query(
    "select j.jobname, d.status, d.start_time from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname like 'ayava-%' order by d.start_time desc limit 6",
  )
  for (const r of runs.rows) console.log(`  last: ${r.jobname} ${r.status} at ${new Date(r.start_time).toISOString()}`)
  const http = await client.query("select status_code, created from net._http_response order by created desc limit 3").catch(() => ({ rows: [] }))
  for (const r of http.rows) console.log(`  http: ${r.status_code} at ${new Date(r.created).toISOString()}`)
}

async function main() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL is not set')
  const client = new Client({ connectionString, ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? undefined : { rejectUnauthorized: false } })
  await client.connect()
  try {
    if (process.argv.includes('--status')) return await status(client)
    if (process.argv.includes('--remove')) {
      for (const job of JOBS) await client.query('select cron.unschedule(jobname) from cron.job where jobname = $1', [job.name])
      console.log('Portal jobs removed.')
      return
    }
    const url = (arg('url') ?? process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
    if (!/^https:\/\//.test(url) || /localhost|127\.0\.0\.1/.test(url)) throw new Error('Pass the live portal address: --url https://…')
    const secret = process.env.CRON_SECRET ?? ''
    if (secret.length < 24) throw new Error('Set CRON_SECRET (24+ characters) in .env — and the same value in Vercel')

    await client.query('create extension if not exists pg_cron')
    await client.query('create extension if not exists pg_net')
    await upsertSecret(client, 'ayava_cron_secret', secret)
    await upsertSecret(client, 'ayava_app_url', url)
    for (const job of JOBS) await client.query('select cron.schedule($1, $2, $3)', [job.name, job.schedule, command(job.path)])
    console.log(`Scheduled for ${url}:`)
    await status(client)
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
