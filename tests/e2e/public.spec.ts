import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/** Behaviour that holds whether or not Supabase Auth is configured. */

test.describe('route protection', () => {
  for (const path of ['/', '/tasks', '/interns', '/users', '/settings/roles', '/profile', '/security', '/audit-logs']) {
    test(`redirects signed-out visitors from ${path} to sign-in`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(/\/login/)
      await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
      if (path !== '/') expect(new URL(page.url()).searchParams.get('next')).toBe(path)
    })
  }

  test('protected APIs return 401 with the standard envelope', async ({ request }) => {
    for (const path of [
      '/api/search?q=web',
      '/api/interns/6f1d3b52-8a4e-4c1f-9b2d-3e7a5c9d0a11',
      '/api/avatars/x/2026/y.png',
    ]) {
      const response = await request.get(path)
      expect(response.status()).toBe(401)
      expect(await response.json()).toEqual({
        success: false,
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
      })
    }
  })

  test('health check stays public and reveals nothing sensitive', async ({ request }) => {
    const response = await request.get('/api/health')
    expect(response.status()).toBe(200)
    expect(JSON.stringify(await response.json())).not.toMatch(/postgres|password|5433/i)
  })
})

test.describe('auth pages', () => {
  test('explain invalid invitation and reset links instead of showing broken forms', async ({ page }) => {
    await page.goto('/invite/not-a-real-invitation-token-0000')
    await expect(page.getByRole('heading', { name: 'Invitation unavailable' })).toBeVisible()
    await page.goto('/reset-password')
    await expect(page.getByText('This password reset link is invalid or was already used.')).toBeVisible()
    await page.goto('/reset-password?error=expired')
    await expect(page.getByText(/has expired/)).toBeVisible()
  })

  test('forgot-password gives the same answer for any email', async ({ page }) => {
    await page.goto('/forgot-password')
    await page.getByLabel('Email').fill(`nobody-${Date.now()}@example.com`)
    await page.getByRole('button', { name: 'Send reset link' }).click()
    await expect(page.getByRole('status')).toContainText('If an account exists for that email')
  })

  test('shows session-expired and signed-out notices', async ({ page }) => {
    await page.goto('/login?reason=session_expired')
    await expect(page.getByText('Your session has expired. Please sign in again.')).toBeVisible()
    await page.goto('/login?signed_out=1')
    await expect(page.getByText('You’ve been signed out.')).toBeVisible()
  })

  for (const path of ['/login', '/forgot-password', '/reset-password', '/invite/not-a-real-invitation-token-0000']) {
    test(`has no WCAG A/AA violations on ${path}`, async ({ page }) => {
      await page.goto(path)
      await page.getByRole('heading', { level: 1 }).waitFor()
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
      expect(results.violations.map((violation) => violation.id)).toEqual([])
    })
  }

  test('sign-in page fits a phone screen', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile only')
    await page.goto('/login')
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBe(0)
  })
})

test.describe('security headers', () => {
  test('send a nonce-based CSP and hardening headers', async ({ request }) => {
    const first = (await request.get('/login')).headers()
    const second = (await request.get('/login')).headers()
    const script = first['content-security-policy'].split('; ').find((d) => d.startsWith('script-src'))!
    expect(script).toMatch(/'nonce-[A-Za-z0-9+/=]+'/)
    expect(script).not.toContain('unsafe-inline')
    expect(first['content-security-policy']).not.toBe(second['content-security-policy'])
    expect(first['x-frame-options']).toBe('DENY')
    expect(first['x-content-type-options']).toBe('nosniff')
    expect(first['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(first['x-powered-by']).toBeUndefined()
  })

  test('the page runs under the CSP without violations', async ({ page }) => {
    const violations: string[] = []
    page.on('console', (message) => {
      if (/Content Security Policy/i.test(message.text())) violations.push(message.text())
    })
    await page.goto('/forgot-password')
    await page.getByLabel('Email').fill('csp-check@example.com')
    await page.getByRole('button', { name: 'Send reset link' }).click()
    await expect(page.getByRole('status')).toBeVisible()
    expect(violations).toEqual([])
  })
})
