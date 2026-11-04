import { expect, test, type Page } from '@playwright/test'
import { AUTH_CONFIGURED, signIn, SKIP_REASON } from '../support'

/**
 * AYAVA AI stories through the real UI.
 *
 * Always run: page access by role and the knowledge base (uploads are indexed
 * for keyword search even without a provider).
 *
 * Chat stories need a provider, real or a local stand-in: set E2E_AI=1 and start
 * the dev server with AI_PROVIDER / AI_API_KEY (or AI_PROVIDER=compatible plus
 * AI_BASE_URL). They assert the app's behaviour, not a model's exact wording.
 */
test.skip(!AUTH_CONFIGURED, SKIP_REASON)
test.use({ storageState: { cookies: [], origins: [] } })
test.describe.configure({ mode: 'serial' })

const AI = process.env.E2E_AI === '1'
const stamp = Date.now().toString(36)

async function ask(page: Page, question: string) {
  await page.getByLabel('Ask AYAVA AI', { exact: true }).fill(question)
  await page.getByRole('button', { name: 'Send' }).click()
}

const answers = (page: Page) => page.getByRole('log', { name: 'Conversation with AYAVA AI' })

test.describe('access', () => {
  test('everyone with ai.use gets the workspace; settings are for administrators', async ({ page }) => {
    await signIn(page, 'intern', '/ai')
    await expect(page.getByRole('heading', { level: 1, name: 'AYAVA AI' })).toBeVisible()
    await expect(page.getByLabel('Ask AYAVA AI', { exact: true })).toBeVisible()
    await page.goto('/ai/settings')
    await expect(page.getByText(/don’t have access|do not have access/i)).toBeVisible()
  })

  test('administrators see provider status and usage counts, never the key', async ({ page }) => {
    await signIn(page, 'admin', '/ai/settings')
    await expect(page.getByRole('heading', { level: 1, name: 'AI settings' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /usage, last 30 days/i })).toBeVisible()
    await expect(page.locator('body')).not.toContainText(/nvapi-|AI_API_KEY=/)
  })
})

test.describe('knowledge base', () => {
  const publicTitle = `E2E Remote Work Policy ${stamp}`
  const hrTitle = `E2E HR Private Policy ${stamp}`
  const word = `flamingo${stamp}`

  async function addDocument(page: Page, title: string, visibility: string, role?: string) {
    await page.goto('/knowledge')
    await page.getByRole('button', { name: 'Add document' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(title)
    await dialog.getByLabel('Who can see it').selectOption(visibility)
    if (role) await dialog.getByLabel('Role').selectOption({ label: role })
    await dialog.getByLabel('Paste text').check()
    await dialog.getByLabel('Document text').fill(`# Remote work\n\nInterns may work remotely on ${word} days after telling their mentor.`)
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('listitem').filter({ hasText: title }).getByText('Ready')).toBeVisible({ timeout: 45_000 })
  }

  test('an administrator adds documents and they finish processing', async ({ page }) => {
    await signIn(page, 'admin', '/knowledge')
    await addDocument(page, publicTitle, 'ORGANIZATION')
    await addDocument(page, hrTitle, 'ROLE', 'HR')
  })

  test('an intern finds the shared document but not the HR-only one', async ({ page }) => {
    await signIn(page, 'intern', `/knowledge?q=${word}`)
    await expect(page.getByRole('link', { name: publicTitle })).toBeVisible()
    await expect(page.getByRole('link', { name: hrTitle })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add document' })).toHaveCount(0)
  })

  test('HR finds both', async ({ page }) => {
    await signIn(page, 'hr', `/knowledge?q=${word}`)
    await expect(page.getByRole('link', { name: publicTitle })).toBeVisible()
    await expect(page.getByRole('link', { name: hrTitle })).toBeVisible()
  })

  test('answers cite an allowed document', async ({ page }) => {
    test.skip(!AI, 'Needs a provider (E2E_AI=1)')
    await signIn(page, 'intern', '/ai')
    await ask(page, `What is the policy for ${word} days?`)
    await expect(answers(page).getByText('Sources')).toBeVisible({ timeout: 60_000 })
    await expect(answers(page).getByRole('link', { name: new RegExp(publicTitle) })).toBeVisible()
    await expect(answers(page)).not.toContainText(hrTitle)
  })
})

test.describe('chat', () => {
  test.skip(!AI, 'Needs a provider (E2E_AI=1)')

  test('an intern asks what to work on and gets an answer, and can rate it', async ({ page }) => {
    await signIn(page, 'intern', '/ai')
    await ask(page, 'What should I work on today?')
    await expect(page.getByRole('button', { name: 'Copy answer' })).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Helpful', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Helpful', exact: true })).toHaveAttribute('aria-pressed', 'true')
  })

  test('HR decisions are refused with a pointer to the right page', async ({ page }) => {
    await signIn(page, 'hr', '/ai')
    await ask(page, 'Approve the pending leave request')
    await expect(answers(page).getByText(/I can’t do that/)).toBeVisible({ timeout: 30_000 })
    await expect(answers(page).getByRole('link', { name: 'Leave' })).toHaveAttribute('href', '/hr/leave')
  })

  test('a proposed task is created only after confirmation', async ({ page }) => {
    await signIn(page, 'manager', '/ai')
    await ask(page, 'Create a task to prepare the launch checklist')
    const card = page.getByRole('group', { name: /AI proposal/ })
    await expect(card).toBeVisible({ timeout: 60_000 })
    const title = `E2E AI task ${stamp}`
    await card.getByLabel('Task').fill(title)
    await card.getByRole('button', { name: 'Confirm' }).click()
    await expect(page.getByRole('link', { name: 'Open it' })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('link', { name: 'Open it' }).click()
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  })

  test('cancelling a proposal changes nothing', async ({ page }) => {
    await signIn(page, 'manager', '/ai')
    await ask(page, 'Create a task to order new laptops')
    const card = page.getByRole('group', { name: /AI proposal/ })
    await expect(card).toBeVisible({ timeout: 60_000 })
    await card.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('Cancelled. Nothing was changed.')).toBeVisible()
  })

  test('conversations are listed and can be reopened', async ({ page }) => {
    await signIn(page, 'mentor', '/ai')
    const question = `Explain recursion ${stamp}`
    await ask(page, question)
    await expect(page.getByRole('button', { name: 'Copy answer' })).toBeVisible({ timeout: 60_000 })
    await page.goto('/ai')
    await page.getByRole('navigation', { name: 'AI conversations' }).getByRole('link', { name: question }).click()
    await expect(answers(page).getByText(question)).toBeVisible()
  })
})
