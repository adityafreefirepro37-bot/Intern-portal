/**
 * Resolves the integration-test database URL and refuses anything that does
 * not look like a dedicated test database, because the suite resets it.
 */
function resolveTestDatabaseUrl() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set. Integration tests need a dedicated, disposable database.')
  }
  const name = new URL(url).pathname.replace(/^\//, '')
  if (!/test/i.test(name)) {
    throw new Error(`Refusing to use "${name}" for integration tests: the database name must contain "test".`)
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) {
    throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL.')
  }
  return url
}

module.exports = { resolveTestDatabaseUrl }
