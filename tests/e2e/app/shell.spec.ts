import { expect, test } from '@playwright/test'
import { AUTH_CONFIGURED, SKIP_REASON } from '../support'

test.skip(!AUTH_CONFIGURED, SKIP_REASON)

test.describe('desktop shell', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop only')

  test('collapses the sidebar and remembers it', async ({ page }) => {
    await page.goto('/')
    const sidebar = page.getByRole('complementary', { name: 'Sidebar' })
    await expect(sidebar.getByText('Learning Hub')).toBeVisible()

    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()

    await page.getByRole('button', { name: 'Expand sidebar' }).click()
    await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible()
  })

  test('navigates with the sidebar and marks the current page', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Projects' }).click()
    await expect(page).toHaveURL(/\/projects$/)
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Projects' }),
    ).toHaveAttribute('aria-current', 'page')
  })

  test('searches with the command menu', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('heading', { level: 1 }).waitFor()
    await page.keyboard.press('Control+k')
    const input = page.getByRole('combobox', { name: 'Search or jump to' })
    await expect(input).toBeFocused()
    await input.fill('website')
    const option = page.getByRole('option', { name: /Ayava Website Revamp/ })
    await expect(option).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/projects\?highlight=/)
  })
})

test.describe('mobile shell', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile only')

  test('uses bottom navigation and a menu drawer', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeHidden()

    const quickNav = page.getByRole('navigation', { name: 'Quick navigation' })
    await expect(quickNav).toBeVisible()
    await quickNav.getByRole('link', { name: 'Tasks' }).click()
    await expect(page).toHaveURL(/\/tasks$/)

    await quickNav.getByRole('button', { name: 'More' }).click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    await drawer.getByRole('link', { name: 'Teams' }).click()
    await expect(page).toHaveURL(/\/teams$/)
    await expect(drawer).toBeHidden()
  })

  test('has no horizontal page overflow', async ({ page }) => {
    for (const path of ['/', '/tasks', '/interns', '/projects', '/audit-logs']) {
      await page.goto(path)
      await page.getByRole('heading', { level: 1 }).waitFor()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect({ path, overflow }).toEqual({ path, overflow: 0 })
    }
  })
})
