#!/usr/bin/env node
/**
 * Runs the whole Playwright suite — including the signed-in flows — without a
 * Supabase project (npm run test:e2e:local [playwright args]).
 *
 *   1. starts the mock Auth server (tests/e2e/mock-auth/server.mjs)
 *   2. rebuilds a separate `<database>_e2e` database (migrations + seed) and
 *      links the development accounts to the mock
 *   3. runs Playwright against a dev server on E2E_PORT (default 3100), so an
 *      already-running `npm run dev` on :3000 is never reused by mistake
 *
 * The database comes from E2E_DATABASE_URL, or DATABASE_URL with an `_e2e`
 * suffix — never the development database itself. Development/test only.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

if (process.env.NODE_ENV === 'production') {
  console.error('test:e2e:local is a development tool and refuses to run with NODE_ENV=production.')
  process.exit(1)
}

// A separate database, rebuilt on every run, so test interns never land in the development data.
const baseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? readEnvFile('DATABASE_URL')
if (!baseUrl) {
  console.error('Set DATABASE_URL (or E2E_DATABASE_URL) — see .env.example.')
  process.exit(1)
}
const databaseUrl = process.env.E2E_DATABASE_URL ? baseUrl : withDatabaseSuffix(baseUrl, '_e2e')

const mockPort = process.env.MOCK_AUTH_PORT ?? '54329'
const appPort = process.env.E2E_PORT ?? '3100'
const env = {
  ...process.env,
  MOCK_AUTH_PORT: mockPort,
  E2E_PORT: appPort,
  NEXT_PUBLIC_APP_URL: `http://localhost:${appPort}`,
  SUPABASE_URL: `http://127.0.0.1:${mockPort}`,
  SUPABASE_ANON_KEY: 'mock-anon-key',
  SUPABASE_PUBLISHABLE_KEY: '',
  SUPABASE_SERVICE_ROLE_KEY: 'mock-service-role-key',
  SUPABASE_SECRET_KEY: '',
  SEED_DEV_PASSWORD: process.env.SEED_DEV_PASSWORD || 'E2E-local-password-2026',
  DATABASE_URL: databaseUrl,
  DIRECT_URL: databaseUrl,
}

function readEnvFile(key) {
  try {
    const line = readFileSync('.env', 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${key}=`))
    return line?.slice(key.length + 1).replace(/^"|"$/g, '')
  } catch {
    return undefined
  }
}

function withDatabaseSuffix(url, suffix) {
  const parsed = new URL(url)
  const name = parsed.pathname.replace(/^\//, '')
  parsed.pathname = `/${name.endsWith(suffix) ? name : `${name}${suffix}`}`
  return parsed.toString()
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: 'inherit', shell: process.platform === 'win32' })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

async function waitFor(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

const mock = spawn(process.execPath, ['tests/e2e/mock-auth/server.mjs'], { env, stdio: 'inherit' })
const stop = () => mock.kill()
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

let code = 1
try {
  await waitFor(`http://127.0.0.1:${mockPort}/health`)
  // Drop, migrate and seed (the seed links the development accounts to the mock).
  code = await run('npx', ['prisma', 'migrate', 'reset', '--force', '--skip-generate'])
  if (code === 0) code = await run('npx', ['playwright', 'test', ...process.argv.slice(2)])
} catch (error) {
  console.error(error)
} finally {
  stop()
}
process.exit(code)
