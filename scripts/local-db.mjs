#!/usr/bin/env node
/**
 * Local development PostgreSQL (development only).
 *
 * Runs a real PostgreSQL server from the `embedded-postgres` npm package so the
 * project can be developed without installing PostgreSQL or Docker. Data lives
 * in `.local/postgres` (git-ignored). Production and staging must use a managed
 * PostgreSQL (e.g. Supabase) via DATABASE_URL.
 *
 *   npm run db:local           start the server (Ctrl+C to stop)
 *
 * Environment:
 *   LOCAL_DB_PORT      default 5433 (avoids clashing with a system PostgreSQL)
 *   LOCAL_DB_USER      default "ayava"
 *   LOCAL_DB_PASSWORD  default "ayava-local-dev"
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'

if (process.env.NODE_ENV === 'production') {
  console.error('local-db is a development tool and refuses to run with NODE_ENV=production.')
  process.exit(1)
}

const port = Number(process.env.LOCAL_DB_PORT ?? 5433)
const user = process.env.LOCAL_DB_USER ?? 'ayava'
const password = process.env.LOCAL_DB_PASSWORD ?? 'ayava-local-dev'
const databaseDir = path.resolve('.local', 'postgres')
const databases = ['ayava_intern_os', 'ayava_intern_os_test']

const pg = new EmbeddedPostgres({
  databaseDir,
  user,
  password,
  port,
  persistent: true,
  // Force UTF-8 regardless of the host OS code page (Windows defaults to WIN1252).
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
})

async function main() {
  const isNew = !existsSync(path.join(databaseDir, 'PG_VERSION'))
  if (isNew) {
    console.log(`Initialising local PostgreSQL cluster in ${databaseDir}`)
    await pg.initialise()
  }

  await pg.start()

  const client = pg.getPgClient()
  await client.connect()
  for (const name of databases) {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])
    if (!rowCount) {
      await pg.createDatabase(name)
      console.log(`Created database ${name}`)
    }
  }
  await client.end()

  console.log(`Local PostgreSQL ready on port ${port}`)
  console.log(`  DATABASE_URL=postgresql://${user}:<LOCAL_DB_PASSWORD>@localhost:${port}/ayava_intern_os`)
  console.log('Press Ctrl+C to stop.')
}

async function shutdown() {
  try {
    await pg.stop()
  } finally {
    process.exit(0)
  }
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

main().catch(async (error) => {
  console.error('Failed to start local PostgreSQL:', error instanceof Error ? error.message : error)
  try {
    await pg.stop()
  } catch {
    // already stopped
  }
  process.exit(1)
})
