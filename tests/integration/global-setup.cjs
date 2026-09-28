const { execSync } = require('node:child_process')
const { loadEnvConfig } = require('@next/env')
const { resolveTestDatabaseUrl } = require('./test-db.cjs')

/**
 * Rebuilds the test database from scratch before the integration suite:
 * drop everything → apply every migration → run the seed. This doubles as the
 * "migrations work from a clean database" check.
 */
module.exports = async function globalSetup() {
  loadEnvConfig(process.cwd())
  const url = resolveTestDatabaseUrl()
  execSync('npx prisma migrate reset --force --skip-generate', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url, NODE_ENV: 'test' },
  })
}
