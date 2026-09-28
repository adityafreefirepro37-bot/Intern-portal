import { loadEnvConfig } from '@next/env'
import { defineConfig, devices } from '@playwright/test'

loadEnvConfig(process.cwd())

/**
 * End-to-end tests (npm run test:e2e).
 *
 *  public-*  Sign-in pages, route protection, headers — always run.
 *  app-*     Signed-in flows. They log in through the real UI with Supabase
 *            Auth, so they need SUPABASE_URL/SUPABASE_ANON_KEY and the seeded
 *            development accounts linked via SEED_DEV_PASSWORD (see
 *            docs/authentication.md). Without those they are skipped.
 *
 * Browser: Playwright's Chromium (`npx playwright install chromium`), an
 * installed browser via PLAYWRIGHT_CHANNEL=msedge / chrome, or a binary via
 * PLAYWRIGHT_EXECUTABLE_PATH.
 *
 * Without a Supabase project, `npm run test:e2e:local` runs everything against
 * a mock Auth server (tests/e2e/mock-auth).
 */
const channel = process.env.PLAYWRIGHT_CHANNEL || undefined
// A specific browser binary (e.g. a preinstalled Chromium in CI containers).
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined
const port = Number(process.env.E2E_PORT ?? 3000)
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`
const signedIn = { storageState: 'playwright/.auth/admin.json' }

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  globalSetup: './tests/e2e/global-setup.ts',
  // The dev server compiles routes on first use; allow for that on network-bound steps.
  expect: { timeout: 15_000 },
  use: { baseURL, trace: 'on-first-retry', ...(executablePath ? { launchOptions: { executablePath } } : {}) },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { channel } },
    { name: 'public-desktop', testMatch: /public.*\.spec\.ts/, use: { ...devices['Desktop Chrome'], channel } },
    { name: 'public-mobile', testMatch: /public.*\.spec\.ts/, use: { ...devices['Pixel 7'], channel } },
    {
      name: 'app-desktop',
      testMatch: /app\/.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], channel, ...signedIn },
    },
    {
      name: 'app-mobile',
      testMatch: /app\/.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Pixel 7'], channel, ...signedIn },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run dev -- --port ${port}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
})
