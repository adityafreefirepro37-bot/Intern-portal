import { expect, test } from '@playwright/test'
import { AUTH_CONFIGURED, SKIP_REASON, signIn } from '../support'

test.skip(!AUTH_CONFIGURED, SKIP_REASON)

/** Flows that need their own session start from a clean browser state. */
test.describe('sessions', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('rejects a wrong password with a generic message', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill('intern@ayavacreatives.com')
    await page.getByLabel('Password', { exact: true }).fill('definitely-not-the-password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByText('Incorrect email or password.')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('returns to the requested page after sign-in, never off-site', async ({ page }) => {
    await signIn(page, 'admin', '/projects')
    await expect(page).toHaveURL(/\/projects$/)
    await page.context().clearCookies()
    await page.goto('/login?next=//evil.example.com')
    await page.getByLabel('Email').fill('admin@ayavacreatives.com')
    await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_DEV_PASSWORD ?? '')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL('http://localhost:3000/')
  })

  test('logout ends access, including via the back button and other tabs', async ({ page, context }) => {
    await signIn(page, 'intern')
    await page.goto('/tasks')
    const other = await context.newPage()
    await other.goto('/profile')
    await expect(other.getByRole('heading', { name: 'Profile' })).toBeVisible()

    await page.getByRole('button', { name: /Account menu/ }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login\?signed_out=1/)

    await page.goBack()
    await page.reload()
    await expect(page).toHaveURL(/\/login/)
    await other.reload()
    await expect(other).toHaveURL(/\/login/)
    expect((await page.request.get('/api/search?q=web')).status()).toBe(401)
  })

  test('an intern sees their own areas and is denied administration', async ({ page, isMobile }) => {
    await signIn(page, 'intern')
    // On phones the full navigation lives in the menu drawer.
    if (isMobile)
      await page.getByRole('navigation', { name: 'Quick navigation' }).getByRole('button', { name: 'More' }).click()
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('link', { name: 'My Tasks' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Audit Logs' })).toHaveCount(0)

    await page.goto('/users')
    await expect(page.getByRole('heading', { name: 'You don’t have access' })).toBeVisible()
    await page.goto('/audit-logs')
    await expect(page.getByRole('heading', { name: 'You don’t have access' })).toBeVisible()
    // Direct API access is enforced server-side too.
    const response = await page.request.get('/api/interns/00000000-0000-4000-8000-000000000000')
    expect(response.status()).toBe(403)
  })

  test('a manager gets 404 for an intern outside their scope (IDOR)', async ({ page }) => {
    await signIn(page, 'manager')
    const response = await page.request.get('/api/interns/00000000-0000-4000-8000-000000000000')
    expect(response.status()).toBe(404)
    expect(await response.json()).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } })
  })
})

test.describe('account pages', () => {
  test('profile edits only personal fields; organization fields are read-only', async ({ page }) => {
    await page.goto('/profile')
    await expect(page.getByLabel('First name')).toBeEditable()
    await expect(page.getByText('Read-only. Ask HR if something here needs to change.')).toBeVisible()
    await page.getByLabel('Phone').fill('+91 98765 43210')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('status')).toContainText('Profile updated')
  })

  test('security page lists this device as the current session', async ({ page }) => {
    await page.goto('/security')
    await expect(page.getByText('This device')).toBeVisible()
    await expect(page.getByText('Authenticator-app 2FA will be offered in Phase 09')).toBeVisible()
  })

  test('user management and roles are available to the super admin', async ({ page }) => {
    await page.goto('/users')
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Invite user' })).toBeVisible()
    await page.goto('/settings/roles')
    await expect(page.getByRole('heading', { name: 'Intern' })).toBeVisible()
  })
})
