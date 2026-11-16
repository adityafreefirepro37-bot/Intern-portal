import { PrismaPg } from '@prisma/adapter-pg'
import { Prisma, PrismaClient } from '@prisma/client'
import { Pool, type PoolConfig } from 'pg'

/**
 * Builds Prisma clients that run queries through node-postgres (the
 * `driverAdapters` preview feature). Prisma's own engine, behind a transaction
 * pooler (`?pgbouncer=true`), wraps every statement in BEGIN / DEALLOCATE ALL /
 * query / COMMIT: four network round trips per query. node-postgres sends
 * unnamed statements, so each query is one round trip on any pooler.
 * PRISMA_DRIVER_ADAPTER=off falls back to the engine's own connections.
 */

/** Prisma-only connection-string parameters that node-postgres doesn't understand. */
const PRISMA_PARAMS = [
  'pgbouncer',
  'connection_limit',
  'pool_timeout',
  'connect_timeout',
  'schema',
  'statement_cache_size',
  'socket_timeout',
  'sslmode',
  'sslaccept',
]

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** node-postgres pool settings equivalent to a Prisma DATABASE_URL. */
export function poolConfigFromUrl(databaseUrl: string): PoolConfig {
  const url = new URL(databaseUrl)
  const params = url.searchParams
  // connection_limit=1 is advice for Prisma's own engine on serverless; through a
  // transaction pooler a handful of connections per instance is cheap, and lets a
  // page's parallel queries actually run in parallel.
  const max = Number(process.env.DATABASE_POOL_MAX ?? 5)
  const poolTimeoutSeconds = Number(params.get('pool_timeout') ?? 15)
  const sslmode = params.get('sslmode')
  const schema = params.get('schema')
  for (const name of PRISMA_PARAMS) params.delete(name)

  // Prisma's default (sslmode=prefer) encrypts without verifying the certificate;
  // keep that for hosted databases, and plain connections for a local one.
  let ssl: PoolConfig['ssl']
  if (sslmode === 'disable' || (!sslmode && LOCAL_HOSTS.has(url.hostname))) ssl = false
  else if (sslmode === 'verify-full' || sslmode === 'verify-ca') ssl = { rejectUnauthorized: true }
  else ssl = { rejectUnauthorized: false }

  // The adapter (5.22) sends DateTime values without an offset, so Postgres reads them in the
  // session timezone: a server set to e.g. Asia/Kolkata (a local PostgreSQL on an Indian
  // machine) would store every timestamp 5½ hours off. Start sessions in UTC. Connections
  // through Supabase's pooler (Supavisor) are left as they were — its servers already run in
  // UTC — rather than relying on the pooler forwarding startup options.
  const supavisor = /\.pooler\.supabase\.com$/i.test(url.hostname)
  const startupOptions = [
    ...(supavisor ? [] : ['-c TimeZone=UTC']),
    ...(schema && schema !== 'public' ? [`-c search_path=${schema}`] : []),
  ]

  return {
    connectionString: url.toString(),
    ssl,
    max: Number.isFinite(max) && max > 0 ? max : 5,
    connectionTimeoutMillis: (Number.isFinite(poolTimeoutSeconds) && poolTimeoutSeconds > 0 ? poolTimeoutSeconds : 15) * 1000,
    idleTimeoutMillis: 30_000,
    // Idle connections don't keep a script or test run alive (a server stays up on its own).
    allowExitOnIdle: true,
    ...(startupOptions.length ? { options: startupOptions.join(' ') } : {}),
  }
}

export function createPrismaClient(options: { url?: string; log?: Prisma.PrismaClientOptions['log'] } = {}) {
  const url = options.url ?? process.env.DATABASE_URL
  const log = options.log ?? (process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'])
  if (!url || process.env.PRISMA_DRIVER_ADAPTER === 'off') {
    return new PrismaClient({ log, ...(options.url ? { datasources: { db: { url: options.url } } } : {}) })
  }
  const pool = new Pool(poolConfigFromUrl(url))
  // An idle connection the pooler closed must not crash the process; the pool replaces it.
  pool.on('error', () => {})
  return new PrismaClient({ adapter: new PrismaPg(pool), log })
}
