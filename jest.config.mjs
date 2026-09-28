import nextJest from 'next/jest.js'

/**
 * Two Jest projects:
 *   unit        — pure logic, no database (npm test)
 *   integration — real PostgreSQL at TEST_DATABASE_URL, rebuilt from
 *                 migrations + seed before the run (npm run test:integration)
 * End-to-end tests use Playwright (npm run test:e2e).
 */
const createJestConfig = nextJest({ dir: './' })

const shared = {
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^server-only$': '<rootDir>/tests/stubs/server-only.cjs',
  },
}

export default async function jestConfig() {
  const unit = await createJestConfig({
    ...shared,
    displayName: 'unit',
    testMatch: ['<rootDir>/tests/unit/**/*.test.ts?(x)'],
  })()

  const integration = await createJestConfig({
    ...shared,
    displayName: 'integration',
    testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
    setupFiles: ['<rootDir>/tests/integration/setup-env.cjs'],
    setupFilesAfterEnv: ['<rootDir>/tests/integration/setup-mocks.ts'],
    globalSetup: '<rootDir>/tests/integration/global-setup.cjs',
    testTimeout: 30_000,
  })()

  return {
    projects: [unit, integration],
    collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts', '!src/app/**'],
  }
}
