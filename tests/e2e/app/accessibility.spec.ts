import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { AUTH_CONFIGURED, SKIP_REASON } from '../support'

test.skip(!AUTH_CONFIGURED, SKIP_REASON)

/** Automated WCAG 2.1 A/AA checks (contrast, labels, landmarks, ARIA) on key pages. */
const PAGES = [
  '/',
  '/tasks',
  '/projects',
  '/interns',
  '/interns/new',
  '/hr',
  '/onboarding',
  '/onboarding/templates',
  '/teams',
  '/learning',
  '/announcements',
  '/audit-logs',
  '/calendar',
  '/users',
  '/settings/roles',
  '/profile',
  '/security',
]

for (const path of PAGES) {
  test(`has no detectable WCAG A/AA violations on ${path}`, async ({ page }) => {
    await page.goto(path)
    await page.getByRole('heading', { level: 1 }).first().waitFor()
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    const summary = results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
    }))
    expect(summary).toEqual([])
  })
}

test('intern profile tabs and onboarding checklist are accessible', async ({ page }) => {
  await page.goto('/interns?q=AYV-INT-0004')
  await page.getByRole('link', { name: 'Neel Joshi' }).first().click()
  await page.getByRole('heading', { level: 1 }).first().waitFor()
  for (const tab of ['', '?tab=internship', '?tab=onboarding', '?tab=documents', '?tab=activity']) {
    await page.goto(`${new URL(page.url()).pathname}${tab}`)
    await page.getByRole('heading', { level: 1 }).first().waitFor()
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(results.violations.map((v) => `${tab || 'overview'}: ${v.id} ${v.nodes[0]?.target.join(' ')}`)).toEqual([])
  }
})

test('command menu dialog is accessible', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop keyboard shortcut')
  await page.goto('/')
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox', { name: 'Search or jump to' }).waitFor()
  const results = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations.map((violation) => violation.id)).toEqual([])
})
