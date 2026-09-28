import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { ACCOUNTS, AUTH_CONFIGURED, SKIP_REASON } from '../support'

const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
test.skip(!AUTH_CONFIGURED || !serviceKey, SKIP_REASON)

/**
 * Exercises the real Supabase recovery flow without sending email: the admin
 * API generates the same one-time link the reset email would contain.
 * Uses the mentor account and restores its password afterwards.
 */
test.describe('password reset through the emailed link', () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  test.describe.configure({ mode: 'serial' })

  const admin = () =>
    createClient(process.env.SUPABASE_URL!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } })

  test.afterAll(async () => {
    const { data } = await admin().auth.admin.listUsers({ perPage: 1000 })
    const mentor = data.users.find((user) => user.email === ACCOUNTS.mentor)
    if (mentor) await admin().auth.admin.updateUserById(mentor.id, { password: process.env.SEED_DEV_PASSWORD })
  })

  test('sets a new password, signs in with it, and rejects a reused link', async ({ page, isMobile }) => {
    test.skip(isMobile, 'runs once')
    const { data, error } = await admin().auth.admin.generateLink({ type: 'recovery', email: ACCOUNTS.mentor })
    expect(error).toBeNull()
    const tokenHash = data.properties!.hashed_token

    await page.goto(`/auth/confirm?token_hash=${tokenHash}&type=recovery&next=/reset-password`)
    await expect(page).toHaveURL(/\/reset-password$/)
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()

    // Weak password is rejected with a clear message.
    await page.getByLabel('New password', { exact: true }).fill('password123')
    await page.getByLabel('Confirm new password').fill('password123')
    await page.getByRole('button', { name: 'Set new password' }).click()
    await expect(page.getByText(/too common|stronger password/i).first()).toBeVisible()

    const next = `e2e reset ${Date.now()} ok`
    await page.getByLabel('New password', { exact: true }).fill(next)
    await page.getByLabel('Confirm new password').fill(next)
    await page.getByRole('button', { name: 'Set new password' }).click()
    await expect(page).toHaveURL(/\/\?password_reset=1/)

    // The new password works; the old one no longer does.
    await page.context().clearCookies()
    await page.goto('/login')
    await page.getByLabel('Email').fill(ACCOUNTS.mentor)
    await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_DEV_PASSWORD ?? '')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByText('Incorrect email or password.')).toBeVisible()
    await page.getByLabel('Password', { exact: true }).fill(next)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).not.toHaveURL(/\/login/)

    // One-time link: using it again fails.
    await page.context().clearCookies()
    await page.goto(`/auth/confirm?token_hash=${tokenHash}&type=recovery&next=/reset-password`)
    await expect(page.getByText(/invalid or was already used|has expired/)).toBeVisible()
  })
})
