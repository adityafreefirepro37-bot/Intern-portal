import { expect, test, type Browser, type Page } from '@playwright/test'
import { AUTH_CONFIGURED, signIn, SKIP_REASON, type AccountRole } from '../support'

/**
 * Phase 08 stories through the real UI:
 *   1. Manager schedules a meeting with the intern; the intern sees the invitation and accepts.
 *   2. The intern posts in #general; the mentor sees it appear without reloading.
 *   3. Notification settings save.
 */
test.skip(!AUTH_CONFIGURED, SKIP_REASON)
test.use({ storageState: { cookies: [], origins: [] } })
test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

const stamp = Date.now().toString(36)

async function as(browser: Browser, role: AccountRole, next?: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, role, next)
  return page
}

function inDays(days: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + days * 86_400_000))
}

test('a meeting invitation reaches the intern, who accepts', async ({ browser }) => {
  const title = `E2E sync ${stamp}`
  const manager = await as(browser, 'manager', '/calendar')
  await manager.getByRole('button', { name: 'Schedule meeting' }).click()
  const dialog = manager.getByRole('dialog', { name: 'Schedule a meeting' })
  await dialog.getByLabel('Title').fill(title)
  await dialog.getByLabel('Date').fill(inDays(9))
  await dialog.getByLabel('Starts').fill('15:00')
  await dialog.getByLabel('Ends').fill('15:30')
  await dialog.getByLabel('Search invitees').fill('Aanya')
  await dialog.getByRole('checkbox', { name: /Aanya Sharma/ }).check()
  await dialog.getByRole('button', { name: 'Schedule' }).click()
  await expect(manager.getByRole('heading', { level: 1, name: title })).toBeVisible()

  const intern = await as(browser, 'intern', '/calendar')
  await expect(intern.getByText(/waiting for your reply/)).toBeVisible()
  await intern.getByRole('link', { name: new RegExp(title) }).first().click()
  await intern.getByRole('button', { name: 'Accept' }).click()
  await expect(intern.getByText('Your reply: Going')).toBeVisible()
})

test('a message in #general shows up for others live', async ({ browser }) => {
  const text = `Hello from e2e ${stamp}`
  const mentor = await as(browser, 'mentor', '/messages/general')
  const intern = await as(browser, 'intern', '/messages/general')
  await intern.getByLabel('Message #general').fill(text)
  await intern.getByRole('button', { name: 'Send' }).click()
  await expect(intern.getByRole('log').getByText(text)).toBeVisible()
  // Polling picks it up within a few seconds.
  await expect(mentor.getByRole('log').getByText(text)).toBeVisible({ timeout: 15_000 })
})

test('notification settings save', async ({ page }) => {
  await signIn(page, 'intern', '/notifications?view=settings')
  const email = page.getByRole('checkbox', { name: 'Tasks by email' })
  await email.check()
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByText('Notification settings saved.')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Tasks by email' })).toBeChecked()
  await page.getByRole('checkbox', { name: 'Tasks by email' }).uncheck()
  await page.getByRole('button', { name: 'Save settings' }).click()
})
