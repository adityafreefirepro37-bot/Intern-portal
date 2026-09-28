import { expect, test } from '@playwright/test'
import { AUTH_CONFIGURED, SKIP_REASON } from '../support'

test.skip(!AUTH_CONFIGURED, SKIP_REASON)

/** Every primary route renders inside the shell without errors. */
const ROUTES: { path: string; heading: RegExp }[] = [
  { path: '/', heading: /good (morning|afternoon|evening)/i },
  { path: '/tasks', heading: /^tasks$/i },
  { path: '/projects', heading: /^projects$/i },
  { path: '/calendar', heading: /^calendar$/i },
  { path: '/interns', heading: /^interns$/i },
  { path: '/teams', heading: /^teams$/i },
  { path: '/learning', heading: /^learning hub$/i },
  { path: '/attendance', heading: /^attendance$/i },
  { path: '/leave', heading: /^leave$/i },
  { path: '/documents', heading: /^documents$/i },
  { path: '/announcements', heading: /^announcements$/i },
  { path: '/messages', heading: /^messages$/i },
  { path: '/ai', heading: /^ayava ai$/i },
  { path: '/analytics', heading: /^analytics$/i },
  { path: '/audit-logs', heading: /^audit logs$/i },
  { path: '/settings', heading: /^settings$/i },
]

test.describe('primary routes', () => {
  for (const route of ROUTES) {
    test(`renders ${route.path}`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))

      const response = await page.goto(route.path)
      expect(response?.status()).toBe(200)
      await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible()
      await expect(page.locator('main#main')).toBeVisible()
      expect(errors).toEqual([])
    })
  }

  test('shows a not-found page for unknown routes', async ({ page }) => {
    const response = await page.goto('/does-not-exist')
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  })
})

test.describe('overview dashboard', () => {
  test('shows figures from the database', async ({ page }) => {
    await page.goto('/')
    const stats = page.getByRole('region', { name: 'Today’s overview' })
    await expect(stats.getByText('Active interns', { exact: true })).toBeVisible()
    await expect(stats.getByText('Open tasks', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Upcoming deadlines' })).toBeVisible()
  })

  test('marks unbuilt quick actions with their phase instead of faking them', async ({ page }) => {
    await page.goto('/')
    const createTask = page.getByText('Create task')
    await expect(createTask).toBeVisible()
    await expect(page.locator('[aria-disabled="true"]', { hasText: 'Create task' })).toContainText('Phase 04')
  })
})

test.describe('lists', () => {
  test('filters tasks by status through the URL', async ({ page }) => {
    await page.goto('/tasks')
    await page
      .getByRole('navigation', { name: 'Filter tasks by status' })
      .getByRole('link', { name: 'In review' })
      .click()
    await expect(page).toHaveURL(/status=IN_REVIEW/)
    const rows = page.locator('tbody tr')
    await expect(rows.first()).toBeVisible()
    for (const badge of await page.locator('tbody tr td:nth-child(2)').allInnerTexts()) {
      expect(badge.trim()).toBe('In review')
    }
  })
})
