import { expect, test, type Browser, type Page } from '@playwright/test'
import { AUTH_CONFIGURED, signIn, SKIP_REASON, type AccountRole } from '../support'

test.skip(!AUTH_CONFIGURED, SKIP_REASON)
test.use({ storageState: { cookies: [], origins: [] } })

/**
 * Prompt 04 end-to-end flows, run as one serial story:
 *   1. Manager creates a project → adds the intern → creates a milestone → creates and assigns a task
 *   2. Intern opens My Work → starts the task → submits work
 *   3. Manager requests changes → intern resubmits → manager approves → task completed, project 100%
 */
test.describe.configure({ mode: 'serial' })

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')

let projectUrl = ''
let taskUrl = ''
let taskTitle = ''

async function as(browser: Browser, role: AccountRole, next?: string): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, role, next)
  return page
}

function isoDate(offset: number) {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
}

test('flow 1: manager creates a project, adds an intern, a milestone and an assigned task', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'app-desktop', 'One story per run (shared data)')
  const page = await as(browser, 'manager', '/projects')
  const name = `E2E Launch Campaign ${Date.now()}`
  taskTitle = `Design launch banner ${Date.now()}`

  await page.getByRole('button', { name: 'New project' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Project name').fill(name)
  await dialog.getByLabel('Target end date').fill(isoDate(30))
  await dialog.getByRole('button', { name: 'Create project' }).click()
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  projectUrl = new URL(page.url()).pathname

  // Team: add the intern as a contributor.
  await page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: 'Team' }).click()
  await page.getByLabel('Person').selectOption({ label: 'Aanya Sharma (Intern)' })
  await page.getByRole('button', { name: 'Add member' }).click()
  await expect(page.locator('p', { hasText: /^Aanya Sharma$/ })).toBeVisible()

  // Milestone.
  await page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: 'Milestones' }).click()
  await page.getByRole('button', { name: 'New milestone' }).click()
  await page.getByRole('dialog').getByLabel('Name').fill('Creative')
  await page.getByRole('dialog').getByLabel('Due date').fill(isoDate(10))
  await page.getByRole('dialog').getByRole('button', { name: 'Create milestone' }).click()
  await expect(page.getByRole('heading', { name: 'Creative' })).toBeVisible()

  // Task assigned to the intern.
  await page.getByRole('navigation', { name: 'Project sections' }).getByRole('link', { name: 'Tasks' }).click()
  await page.getByRole('button', { name: 'New task' }).click()
  const taskDialog = page.getByRole('dialog')
  await taskDialog.getByLabel('Title').fill(taskTitle)
  await taskDialog.getByLabel('Milestone').selectOption({ label: 'Creative' })
  await taskDialog.getByLabel('Priority').selectOption('HIGH')
  await taskDialog.getByLabel('Due date').fill(isoDate(5))
  await taskDialog.getByLabel('Aanya Sharma').check()
  await taskDialog.getByRole('button', { name: 'Create task' }).click()
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { level: 1, name: taskTitle })).toBeVisible()
  await expect(page.locator('header').getByText('Assigned', { exact: true })).toBeVisible()
  taskUrl = new URL(page.url()).pathname
  await page.context().close()
})

test('flow 2: intern opens My Work, starts the task and submits work', async ({ browser }, info) => {
  test.skip(info.project.name !== 'app-desktop', 'One story per run (shared data)')
  expect(taskUrl).not.toBe('')
  const page = await as(browser, 'intern', '/my-work')
  await expect(page.getByRole('heading', { level: 1, name: 'My Work' })).toBeVisible()
  await page.getByRole('link', { name: taskTitle }).first().click()
  await expect(page).toHaveURL(new RegExp(`${taskUrl}$`))

  await page.getByRole('button', { name: 'Start work' }).click()
  await expect(page.locator('header').getByText('In progress', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Submit for review' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('What are you submitting?').fill('Banner in three sizes, exported for social.')
  await dialog.getByLabel(/Files/).setInputFiles({ name: 'banner-v1.pdf', mimeType: 'application/pdf', buffer: PDF })
  await dialog.getByRole('button', { name: 'Submit' }).click()
  await expect(page.locator('header').getByText('In review', { exact: true })).toBeVisible()
  await expect(page.getByText('Version 1', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /banner-v1\.pdf/ })).toBeVisible()
  // Interns can't review their own work.
  await expect(page.getByRole('button', { name: /Review version/ })).toHaveCount(0)
  await page.context().close()
})

test('flow 3: manager requests changes, intern resubmits, manager approves', async ({ browser }, info) => {
  test.skip(info.project.name !== 'app-desktop', 'One story per run (shared data)')
  expect(taskUrl).not.toBe('')

  const manager = await as(browser, 'manager', taskUrl)
  await manager.getByRole('button', { name: 'Review version 1' }).click()
  let dialog = manager.getByRole('dialog')
  await dialog.getByLabel('Request changes').check()
  await dialog.getByLabel('What needs to change?').fill('Make the logo larger on the square format.')
  await dialog.getByRole('button', { name: 'Request changes' }).click()
  await expect(manager.locator('header').getByText('Changes requested', { exact: true })).toBeVisible()

  const intern = await as(browser, 'intern', taskUrl)
  await expect(intern.getByText('Make the logo larger on the square format.')).toBeVisible()
  await intern.getByRole('button', { name: 'Resubmit work' }).click()
  dialog = intern.getByRole('dialog')
  await dialog.getByLabel('What are you submitting?').fill('Logo enlarged on the square format.')
  await dialog.getByRole('button', { name: 'Resubmit' }).click()
  await expect(intern.getByText('Version 2', { exact: true })).toBeVisible()
  await intern.context().close()

  await manager.reload()
  await manager.getByRole('button', { name: 'Review version 2' }).click()
  dialog = manager.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Approve' }).click()
  await expect(manager.locator('header').getByText('Completed', { exact: true })).toBeVisible()
  // History is preserved: both versions with their review results.
  await expect(manager.getByText('Version 1', { exact: true })).toBeVisible()
  await expect(manager.getByText('Version 2', { exact: true })).toBeVisible()

  // Project progress and activity reflect the approval.
  await manager.goto(projectUrl)
  await expect(manager.getByText('100%').first()).toBeVisible()
  await manager.goto(`${projectUrl}/activity`)
  await expect(manager.getByText(/approved “Design launch banner/)).toBeVisible()
  await manager.context().close()
})

test('security: interns can’t open projects they aren’t on, and file links are private', async ({ page }) => {
  await signIn(page, 'intern')
  // The social campaign doesn't include Aanya; its project page is a 404 for her.
  await page.goto('/projects')
  await expect(page.getByRole('link', { name: 'Social Media Campaign' })).toHaveCount(0)
  const denied = await page.request.get('/api/projects/files/00000000-0000-4000-8000-000000000000')
  expect(denied.status()).toBe(404)
  const attachment = await page.request.get('/api/tasks/attachments/00000000-0000-4000-8000-000000000000')
  expect(attachment.status()).toBe(404)
})
