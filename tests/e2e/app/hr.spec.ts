import { PrismaClient } from '@prisma/client'
import { expect as baseExpect, test, type Browser, type Page } from '@playwright/test'
import { AUTH_CONFIGURED, signIn, SKIP_REASON, type AccountRole } from '../support'

// HR pages aggregate many queries; against a remote development database a refresh can take a while.
const expect = baseExpect.configure({ timeout: 45_000 })

test.skip(!AUTH_CONFIGURED, SKIP_REASON)
test.use({ storageState: { cookies: [], origins: [] } })

/**
 * Prompt 05 end-to-end scenarios, run as one serial story on desktop:
 *   1. HR: dashboard + action centre → HR directory filters → intern HR record (personal info, contact)
 *   2. Attendance: intern checks in, takes a break, checks out; HR sees it in Today
 *   3. Correction: intern requests a correction; HR approves; intern sees it approved
 *   4. Leave: intern requests leave (working days counted); HR approves; intern sees it approved
 *   5. Document: intern uploads a required document; HR verifies it
 *   6. Ending internship: HR opens Ending internships and completes an offboarding item
 * Plus role restrictions and mobile layout for the HR pages.
 */
test.describe.configure({ mode: 'serial' })
// Each scenario signs in two people and renders several data-heavy HR pages.
test.setTimeout(180_000)

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')

async function as(browser: Browser, role: AccountRole, next?: string): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, role, next)
  return page
}

/** A weekday ≥ 5 weeks out that isn't a holiday (read from the database the app uses). */
async function leaveDay() {
  const prisma = new PrismaClient()
  try {
    const holidays = new Set(
      (await prisma.holiday.findMany({ select: { date: true } })).map((h) => h.date.toISOString().slice(0, 10)),
    )
    let date = new Date(Date.now() + 35 * 86_400_000)
    while ([0, 6].includes(date.getUTCDay()) || holidays.has(date.toISOString().slice(0, 10))) {
      date = new Date(date.getTime() + 86_400_000)
    }
    return date.toISOString().slice(0, 10)
  } finally {
    await prisma.$disconnect()
  }
}

test('scenario 1: HR dashboard, directory filters and an intern’s HR record', async ({ browser }, info) => {
  test.skip(info.project.name !== 'app-desktop', 'One story per run (shared data)')
  const page = await as(browser, 'hr', '/hr')
  await expect(page.getByRole('heading', { level: 1, name: 'HR Dashboard' })).toBeVisible()
  const figures = page.getByRole('region', { name: 'Programme figures' })
  for (const label of [
    'Total interns',
    'Active',
    'Onboarding',
    'Ending soon',
    'Completed this month',
    'Leave requests pending',
  ]) {
    await expect(figures.getByText(label, { exact: true })).toBeVisible()
  }
  await expect(page.getByRole('heading', { name: 'Requires attention' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Leave requests awaiting a decision/ })).toBeVisible()

  // HR directory (= /interns) with the HR columns and the document-completion filter.
  await page.goto('/hr/interns?documents=incomplete')
  await expect(page).toHaveURL(/\/interns\?documents=incomplete/)
  const table = page.getByRole('table', { name: 'Interns' })
  await expect(table.getByRole('columnheader', { name: 'Onboarding' })).toBeAttached()
  await expect(table.getByRole('columnheader', { name: 'Attendance (30d)' })).toBeAttached()
  await expect(table.getByRole('link', { name: 'Aanya Sharma' })).toBeVisible()

  // Intern HR record: personal information and an emergency contact.
  await table.getByRole('link', { name: 'Aanya Sharma' }).click()
  await page.getByRole('navigation', { name: 'Profile sections' }).getByRole('link', { name: 'HR record' }).click()
  await expect(page.getByRole('heading', { name: 'Personal information' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Stipend' })).toBeVisible()
  await page.getByRole('button', { name: 'Add' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill('E2E Contact')
  await dialog.getByLabel('Relationship').fill('Sibling')
  await dialog.getByLabel('Phone', { exact: true }).fill('+91 90000 11111')
  await dialog.getByLabel('Alternate phone').fill('+91 90000 22222')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('E2E Contact')).toBeVisible()
  await expect(page.getByText(/alt\. \+91 90000 22222/)).toBeVisible()
})

test('scenario 2: intern checks in, takes a break and checks out; HR sees it', async ({ browser }, info) => {
  test.skip(info.project.name !== 'app-desktop', 'One story per run (shared data)')
  const intern = await as(browser, 'intern', '/attendance')
  await expect(intern.getByRole('heading', { level: 1, name: 'Attendance' })).toBeVisible()
  await intern.getByRole('button', { name: 'Check in' }).click()
  await expect(intern.getByRole('button', { name: 'Start break' })).toBeVisible()
  await intern.getByRole('button', { name: 'Start break' }).click()
  await expect(intern.getByRole('button', { name: 'End break' })).toBeVisible()
  await intern.getByRole('button', { name: 'End break' }).click()
  // Wait for the break to end before checking out.
  await expect(intern.getByRole('button', { name: 'End break' })).toBeHidden()
  await expect(intern.getByRole('button', { name: 'Start break' })).toBeVisible()
  await intern.getByRole('button', { name: 'Check out' }).click()
  await expect(intern.getByText(/You’re done for today/)).toBeVisible()
  // The calendar labels every day in text (never colour-only).
  await expect(intern.getByRole('table', { name: /Attendance for/ })).toBeVisible()
  await expect(intern.getByRole('list', { name: 'Legend' })).toContainText('Missing check-out')

  const hr = await as(browser, 'hr', '/hr/attendance')
  const row = hr.getByRole('row', { name: /Aanya Sharma/ })
  await expect(row).toContainText('Checked out')
})

test('scenario 3: attendance correction requested by the intern and approved by HR', async ({ browser }, info) => {
  test.skip(info.project.name !== 'app-desktop', 'One story per run (shared data)')
  const intern = await as(browser, 'intern', '/attendance')
  await intern.getByRole('button', { name: 'Request correction' }).click()
  const dialog = intern.getByRole('dialog')
  await dialog.getByLabel('What happened').selectOption('WRONG_TIME')
  await dialog.getByLabel('Correct check-in').fill('09:55')
  await dialog.getByLabel('Correct check-out').fill('18:35')
  await dialog.getByLabel('Reason').fill('E2E: I tested check-out too early')
  await dialog.getByRole('button', { name: 'Send request' }).click()
  await expect(dialog).toBeHidden()
  await expect(intern.getByRole('listitem').filter({ hasText: 'E2E: I tested check-out too early' })).toContainText(
    'Pending',
  )

  const hr = await as(browser, 'hr', '/hr/attendance?view=corrections')
  await hr.getByRole('button', { name: /Approve correction for Aanya Sharma/ }).click()
  await expect(hr.getByRole('button', { name: /Approve correction for Aanya Sharma/ })).toBeHidden()

  await intern.reload()
  await expect(intern.getByText('Approved').first()).toBeVisible()
  await expect(intern.getByText('corrected')).toBeVisible()
})

test('scenario 4: leave request (working days) approved by HR', async ({ browser }, info) => {
  test.skip(info.project.name !== 'app-desktop', 'One story per run (shared data)')
  const day = await leaveDay()
  const intern = await as(browser, 'intern', '/leave')
  await expect(intern.getByRole('heading', { name: 'Balance' })).toBeVisible()
  await intern.getByRole('button', { name: 'Request leave' }).click()
  const dialog = intern.getByRole('dialog')
  await dialog.getByLabel('Leave type').selectOption({ label: 'Casual leave' })
  await dialog.getByLabel('From').fill(day)
  await dialog.getByLabel('To (inclusive)').fill(day)
  await dialog.getByLabel('Reason').fill('E2E family event')
  await dialog.getByRole('button', { name: 'Send request' }).click()
  await expect(dialog).toBeHidden()
  const mine = intern.getByRole('listitem').filter({ hasText: 'E2E family event' })
  await expect(mine).toContainText('1 working day')
  await expect(mine).toContainText('Pending')

  const hr = await as(browser, 'hr', '/hr/leave')
  const request = hr.getByRole('listitem').filter({ hasText: 'E2E family event' })
  await request.getByRole('button', { name: /Approve leave for Aanya Sharma/ }).click()
  await hr.getByRole('dialog').getByRole('button', { name: 'Approve' }).click()
  await expect(hr.getByRole('dialog')).toBeHidden()

  await intern.reload()
  await expect(intern.getByRole('listitem').filter({ hasText: 'E2E family event' })).toContainText('Approved')
})

test('scenario 5: intern uploads a required document and HR verifies it', async ({ browser }, info) => {
  test.skip(info.project.name !== 'app-desktop', 'One story per run (shared data)')
  const intern = await as(browser, 'intern', '/documents')
  const offer = intern.getByRole('listitem').filter({ hasText: 'Signed offer letter' }).first()
  await expect(offer).toContainText('Required')
  await offer.getByRole('button', { name: 'Upload' }).click()
  const dialog = intern.getByRole('dialog')
  await dialog.getByLabel('File').setInputFiles({ name: 'e2e-offer.pdf', mimeType: 'application/pdf', buffer: PDF })
  await dialog.getByRole('button', { name: 'Upload' }).click()
  await expect(dialog).toBeHidden()
  await expect(intern.getByRole('listitem').filter({ hasText: 'Signed offer letter' }).first()).toContainText(
    'Uploaded',
  )

  const hr = await as(browser, 'hr', '/hr/documents?status=PENDING&q=Aanya')
  await hr.getByRole('button', { name: /Verify Signed offer letter for Aanya Sharma/ }).click()
  await expect(hr.getByRole('button', { name: /Verify Signed offer letter for Aanya Sharma/ })).toBeHidden()

  await intern.reload()
  await expect(intern.getByRole('listitem').filter({ hasText: 'Signed offer letter' }).first()).toContainText(
    'Verified',
  )
})

test('scenario 6: ending internship — HR works through the offboarding checklist', async ({ browser }, info) => {
  test.skip(info.project.name !== 'app-desktop', 'One story per run (shared data)')
  const hr = await as(browser, 'hr', '/hr/offboarding?window=30')
  const tara = hr.getByRole('listitem').filter({ hasText: 'Tara Menon' }).first()
  await expect(tara).toContainText('Open tasks')
  await expect(tara).toContainText('Certificate')
  await tara.getByRole('link', { name: /Checklist 2\/5/ }).click()
  await expect(hr.getByRole('heading', { name: 'Offboarding: Tara Menon' })).toBeVisible()
  await hr.getByLabel('Status of Collect exit feedback').selectOption('DONE')
  await hr.getByLabel('Note for Collect exit feedback').fill('Form received')
  await hr
    .getByRole('listitem')
    .filter({ hasText: 'Collect exit feedback' })
    .getByRole('button', { name: 'Save' })
    .click()
  await expect(hr.getByText(/Done by .* — Form received/)).toBeVisible()
})

test.describe('HR role restrictions', () => {
  const cases: [AccountRole, string, RegExp][] = [
    ['intern', '/hr', /don’t have access|do not have access|Access denied/i],
    ['intern', '/hr/attendance', /don’t have access|do not have access|Access denied/i],
    ['intern', '/hr/settings', /don’t have access|do not have access|Access denied/i],
    ['mentor', '/hr/leave', /don’t have access|do not have access|Access denied/i],
    ['manager', '/hr/documents', /don’t have access|do not have access|Access denied/i],
    ['manager', '/hr/requests', /don’t have access|do not have access|Access denied/i],
  ]
  for (const [role, path, message] of cases) {
    test(`${role} cannot open ${path}`, async ({ browser }, info) => {
      test.skip(info.project.name !== 'app-desktop', 'Desktop only')
      const page = await as(browser, role, path)
      await expect(page.getByText(message).first()).toBeVisible()
    })
  }

  test('interns cannot download HR exports', async ({ browser }, info) => {
    test.skip(info.project.name !== 'app-desktop', 'Desktop only')
    const page = await as(browser, 'intern', '/attendance')
    const response = await page.request.get('/api/hr/export/attendance')
    expect(response.status()).toBe(403)
  })
})

async function noOverflow(page: Page, paths: string[]) {
  for (const path of paths) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect({ path, overflow }).toEqual({ path, overflow: 0 })
  }
}

test('HR pages fit a phone screen without horizontal scrolling', async ({ page }, info) => {
  test.skip(info.project.name !== 'app-mobile', 'Mobile only')
  test.setTimeout(300_000)
  await signIn(page, 'hr', '/hr')
  await noOverflow(page, [
    '/hr',
    '/hr/attendance',
    '/hr/leave',
    '/hr/documents',
    '/hr/requests',
    '/hr/offboarding',
    '/hr/calendar',
    '/hr/analytics',
    '/hr/settings',
    '/announcements',
  ])
})

test('intern HR pages fit a phone screen without horizontal scrolling', async ({ page }, info) => {
  test.skip(info.project.name !== 'app-mobile', 'Mobile only')
  test.setTimeout(300_000)
  await signIn(page, 'intern', '/attendance')
  await noOverflow(page, ['/attendance', '/leave', '/documents', '/requests'])
})
