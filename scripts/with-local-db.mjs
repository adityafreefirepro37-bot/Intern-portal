#!/usr/bin/env node
/**
 * Runs a command against the local development PostgreSQL (npm run db:local)
 * instead of the database in .env.
 *
 * Each query to a hosted database costs a network round trip (hundreds of
 * milliseconds from a home connection), so pages that run dozens of queries
 * take seconds. Locally a query takes about a millisecond. Sign-in still uses
 * the Supabase project from .env; files go to local storage (.local/uploads).
 *
 *   npm run db:local:setup     migrate + seed the local database (once)
 *   npm run dev:local          next dev against the local database
 *
 * Environment:
 *   LOCAL_DATABASE_URL   default: the npm run db:local database on port 5433
 *
 * Only this process's environment changes; .env is never written.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import net from 'node:net'
import path from 'node:path'

if (process.env.NODE_ENV === 'production') {
  console.error('with-local-db is a development tool and refuses to run with NODE_ENV=production.')
  process.exit(1)
}

// The project root is where it's run from (npm runs scripts there).
const root = process.cwd()
const require = createRequire(path.join(root, 'package.json'))
require('@next/env').loadEnvConfig(root)

const command = process.argv.slice(2).join(' ')
if (!command) {
  console.error('Usage: node scripts/with-local-db.mjs <command…>')
  process.exit(1)
}

const url = new URL(
  process.env.LOCAL_DATABASE_URL ?? 'postgresql://ayava:ayava-local-dev@localhost:5433/ayava_intern_os?schema=public',
)
const reachable = await new Promise((resolve) => {
  const socket = net.connect(Number(url.port || 5432), url.hostname, () => {
    socket.destroy()
    resolve(true)
  })
  socket.setTimeout(3000, () => {
    socket.destroy()
    resolve(false)
  })
  socket.on('error', () => resolve(false))
})
if (!reachable) {
  console.error(`No PostgreSQL at ${url.hostname}:${url.port}. Start it first with: npm run db:local`)
  process.exit(1)
}

process.env.DATABASE_URL = url.toString()
process.env.DIRECT_URL = url.toString()
process.env.STORAGE_PROVIDER = 'local'
// Project binaries (next, prisma, tsx) also when launched without npm.
process.env.PATH = `${path.join(root, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH}`

console.log(`Database: ${url.hostname}:${url.port}/${url.pathname.slice(1)} (local)`)
const child = spawn(command, { cwd: root, stdio: 'inherit', shell: true, env: process.env })
child.on('exit', (code) => process.exit(code ?? 0))
