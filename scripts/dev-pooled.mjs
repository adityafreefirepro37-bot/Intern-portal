#!/usr/bin/env node
/**
 * Development server against a hosted (Supabase) database.
 *
 * DATABASE_URL in .env is the transaction pooler with connection_limit=1, which
 * suits serverless (one request per instance). A long-running `next dev` serves
 * concurrent requests, so with one connection they queue (Prisma P2024), and
 * the transaction pooler adds latency to every query. This starts `next dev`
 * on the session pooler (DIRECT_URL) with a few connections instead.
 *
 * Only this process's environment changes; .env is never written.
 *
 *   npm run dev:pooled
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

// The project root is where it's run from (npm runs scripts there).
const root = process.cwd()
const require = createRequire(path.join(root, 'package.json'))
require('@next/env').loadEnvConfig(root)

const source = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!source) {
  console.error('Set DATABASE_URL (and DIRECT_URL) in .env first.')
  process.exit(1)
}
const url = new URL(source)
if (process.env.DIRECT_URL) url.searchParams.delete('pgbouncer')
url.searchParams.set('connection_limit', '5')
if (!url.searchParams.has('connect_timeout')) url.searchParams.set('connect_timeout', '15')
process.env.DATABASE_URL = url.toString()

console.log(`Database: ${url.hostname}:${url.port} (connection_limit=5)`)
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '-p', '3000'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})
child.on('exit', (code) => process.exit(code ?? 0))
