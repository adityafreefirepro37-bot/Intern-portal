// Runs before each integration test file (before any module imports Prisma):
// point the application at the disposable test database. A worker runs
// several files, so the URL may already have been switched by a previous one.
const { resolveTestDatabaseUrl } = require('./test-db.cjs')

if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
  const url = resolveTestDatabaseUrl()
  process.env.DATABASE_URL = url
  process.env.DIRECT_URL = url
}
process.env.LOG_LEVEL = 'error'
