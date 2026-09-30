import { PrismaClient } from '@prisma/client'
import { expect, type Page } from '@playwright/test'

/** Signed-in end-to-end tests need real Supabase Auth and linked seed accounts. */
export const AUTH_CONFIGURED = Boolean(
  process.env.SUPABASE_URL &&
  (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY) &&
  process.env.SEED_DEV_PASSWORD,
)

export const SKIP_REASON =
  'Signed-in E2E needs SUPABASE_URL, SUPABASE_ANON_KEY and SEED_DEV_PASSWORD (then run `npm run db:seed` to link accounts)'

export const ACCOUNTS = {
  admin: 'admin@ayavacreatives.com',
  hr: 'hr@ayavacreatives.com',
  manager: 'manager@ayavacreatives.com',
  mentor: 'mentor@ayavacreatives.com',
  intern: 'intern@ayavacreatives.com',
} as const

export type AccountRole = keyof typeof ACCOUNTS

let prisma: PrismaClient | null = null

/**
 * A full run signs in far more often than a person could (desktop + mobile ×
 * every role), so the app's per-IP/per-account login limits would trip
 * mid-run. Clear only the login buckets before each sign-in, as the global
 * setup does once per run. Rate limiting itself is covered by integration tests.
 * Never runs against a deployed (https) target.
 */
async function resetSignInLimits() {
  if (process.env.E2E_BASE_URL?.startsWith('https://')) return
  prisma ??= new PrismaClient()
  await prisma.rateLimitBucket.deleteMany({
    where: { OR: [{ key: { startsWith: 'loginIp:' } }, { key: { startsWith: 'loginAccount:' } }] },
  })
}

/** Signs in through the real login form. */
export async function signIn(page: Page, role: AccountRole, next?: string) {
  await resetSignInLimits()
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login')
  await page.getByLabel('Email').fill(ACCOUNTS[role])
  await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_DEV_PASSWORD ?? '')
  await page.getByRole('button', { name: 'Sign in' }).click()
  // Sign-in round-trips to Supabase Auth and renders the destination; allow for a cold dev server.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 45_000 })
}
