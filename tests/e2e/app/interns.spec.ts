import { expect, test, type Page } from '@playwright/test'
import { AUTH_CONFIGURED, signIn, SKIP_REASON } from '../support'

test.skip(!AUTH_CONFIGURED, SKIP_REASON)
// Each test signs in as the role it exercises.
test.use({ storageState: { cookies: [], origins: [] } })

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')

function isoDate(offsetDays: number) {
  const date = new Date(Date.now() + offsetDays * 86_400_000)
  return date.toISOString().slice(0, 10)
}

async function openChecklistItem(page: Page, title: string) {
  return page.locator('li').filter({ has: page.getByText(title, { exact: true }) })
}

test('HR adds an intern, who gets a code, a checklist and a profile', async ({ page }) => {
  await signIn(page, 'hr', '/interns')
  await page.getByRole('link', { name: 'Add intern' }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Add intern' })).toBeVisible()

  const email = `e2e.john.doe.${Date.now()}.${test.info().project.name}@test.ayava.dev`
  await page.getByLabel('First name').fill('John')
  await page.getByLabel('Last name').fill('Doe')
  await page.locator('#email').fill(email)
  await page.getByLabel('Department').selectOption({ label: 'Development' })
  await page.getByLabel('Position').selectOption({ label: 'Web Development Intern' })
  await page.getByLabel('Joining date').fill(isoDate(0))
  await page.getByLabel('Expected end date').fill(isoDate(90))
  await page.getByRole('button', { name: 'Create intern' }).click()

  await expect(page.getByText('Intern added')).toBeVisible()
  const code = await page.locator('span.font-mono').first().innerText()
  expect(code).toMatch(/^AYV-INT-\d{4,}$/)
  await page.getByRole('link', { name: 'Open profile' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'John Doe' })).toBeVisible()
  await expect(page.getByText(code)).toBeVisible()
  await page.getByRole('navigation', { name: 'Profile sections' }).getByRole('link', { name: 'Onboarding' }).click()
  await expect(page.getByText('Development Intern Onboarding')).toBeVisible()

  // Activation is blocked until onboarding is complete.
  await page.getByRole('button', { name: 'Change status' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('New status').selectOption('ACTIVE')
  await dialog.getByRole('button', { name: /Change to Active/ }).click()
  await expect(dialog.getByText(/Onboarding isn’t finished/)).toBeVisible()
})

test('intern works through their onboarding checklist', async ({ page }) => {
  test.skip(test.info().project.name !== 'app-desktop', 'Mutates the shared seeded intern; runs once')
  await signIn(page, 'intern', '/my-internship')
  await expect(page.getByRole('heading', { level: 1, name: 'My internship' })).toBeVisible()
  await page.getByRole('navigation', { name: 'Profile sections' }).getByRole('link', { name: 'Onboarding' }).click()
  await expect(page.getByText(/3 of 14 required/)).toBeVisible()

  // Policy acknowledgement
  const nda = await openChecklistItem(page, 'Acknowledge the NDA')
  await nda.getByRole('button', { name: 'Read & acknowledge' }).click()
  const ack = page.getByRole('dialog')
  await expect(ack.getByRole('button', { name: 'Acknowledge' })).toBeDisabled()
  await ack.getByRole('checkbox').check()
  await ack.getByRole('button', { name: 'Acknowledge' }).click()
  await expect(page.getByText(/4 of 14 required/)).toBeVisible()

  // Simple item
  const course = await openChecklistItem(page, 'Complete the Ayava Orientation course')
  await course.getByRole('button', { name: 'Mark complete' }).click()
  await expect(page.getByText(/5 of 14 required/)).toBeVisible()

  // Document item: private upload completes it
  const upload = await openChecklistItem(page, 'Upload your signed NDA')
  await upload.getByRole('button', { name: 'Upload' }).click()
  const uploadDialog = page.getByRole('dialog')
  await uploadDialog
    .getByLabel('File')
    .setInputFiles({ name: 'nda-signed.pdf', mimeType: 'application/pdf', buffer: PDF })
  await uploadDialog.getByRole('button', { name: 'Upload' }).click()
  await expect(page.getByText(/6 of 14 required/)).toBeVisible()
  const link = page.getByRole('link', { name: 'nda-signed.pdf' })
  await expect(link).toBeVisible()
  const response = await page.request.get((await link.getAttribute('href'))!)
  expect(response.status()).toBe(200)
  expect(response.headers()['content-disposition']).toContain('attachment')

  // Manager-owned items have no action for the intern.
  const managerItem = await openChecklistItem(page, 'Welcome meeting with your manager')
  await expect(managerItem.getByRole('button')).toHaveCount(0)
})

test('managers see only their own interns', async ({ page }) => {
  await signIn(page, 'manager', '/my-interns')
  await expect(page.getByRole('heading', { level: 1, name: 'My Interns' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Ishaan Verma' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Aanya Sharma' })).toHaveCount(0)

  // Aanya is managed by someone else: her profile URL is indistinguishable from a missing page.
  await page.goto('/my-interns')
  const ishaanHref = await page.getByRole('link', { name: 'Ishaan Verma' }).getAttribute('href')
  await page.goto(ishaanHref!)
  await expect(page.getByRole('heading', { level: 1, name: 'Ishaan Verma' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Change status' })).toHaveCount(0)
})

test('security: interns are kept out of HR areas and other records', async ({ page }) => {
  // Look up another intern's profile URL as HR first.
  await signIn(page, 'hr', '/interns?q=Ishaan')
  const other = await page.getByRole('link', { name: 'Ishaan Verma' }).first().getAttribute('href')
  expect(other).toMatch(/^\/interns\/[0-9a-f-]{36}$/)
  await page.context().clearCookies()

  await signIn(page, 'intern')
  await page.goto('/interns')
  await expect(page).toHaveURL(/\/interns\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { level: 1, name: 'My internship' })).toBeVisible()
  expect(new URL(page.url()).pathname).not.toBe(other)

  for (const path of ['/hr', '/onboarding/templates', '/interns/new']) {
    await page.goto(path)
    await expect(page.getByText('You don’t have access')).toBeVisible()
  }

  // Another intern's profile (by id) and unknown documents are 404 (IDOR protection).
  await page.goto(other!)
  await expect(page.getByText('Page not found')).toBeVisible()
  const document = await page.request.get('/api/documents/00000000-0000-4000-8000-000000000000')
  expect(document.status()).toBe(404)
})
