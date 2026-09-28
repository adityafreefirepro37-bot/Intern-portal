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
  marketingManager: 'marketing.manager@ayavacreatives.com',
  designMentor: 'design.mentor@ayavacreatives.com',
} as const

export type AccountRole = keyof typeof ACCOUNTS

/** Signs in through the real login form. */
export async function signIn(page: Page, role: AccountRole, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login')
  await page.getByLabel('Email').fill(ACCOUNTS[role])
  await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_DEV_PASSWORD ?? '')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}
