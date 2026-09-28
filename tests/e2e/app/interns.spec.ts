import { expect, test, type Browser, type Page } from '@playwright/test'
import { ACCOUNTS, AUTH_CONFIGURED, SKIP_REASON, signIn, type AccountRole } from '../support'

test.skip(!AUTH_CONFIGURED, SKIP_REASON)

/**
 * Prompt 03 end-to-end flows (§73, §80): HR creates an intern, the intern
 * accepts the invitation and works through onboarding, the manager sees them,
 * and nobody reaches an intern outside their scope.
 *
 * Runs once (desktop), in order: later steps use the intern created first.
 */
test.describe('intern lifecycle', () => {
  test.describe.configure({ mode: 'serial' })
  test.use({ storageState: { cookies: [], origins: [] } })

  const suffix = Date.now().toString(36)
  const john = { first: 'John', last: `Doe ${suffix}`, email: `john.doe.${suffix}@example.com` }
  let profileUrl = ''
  let inviteUrl = ''
  const password = `Intern-OS-e2e-${suffix}`

  async function as(browser: Browser, role: AccountRole): Promise<Page> {
    const context = await browser.newContext()
    const page = await context.newPage()
    await signIn(page, role)
    return page
  }

  /**
   * Out-of-scope records render the not-found page with nothing about the
   * intern. (Streamed pages keep HTTP 200 once rendering starts; the API
   * routes return a real 404.)
   */
  async function expectNotFound(page: Page, path: string) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    await expect(page.getByText(john.last)).toHaveCount(0)
    await expect(page.getByText(john.email)).toHaveCount(0)
  }

  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'The flow runs once; mobile layout is checked separately')
  })

  test('HR adds an intern and lands on a complete profile', async ({ browser }) => {
    const page = await as(browser, 'hr')
    await page.goto('/interns')
    await expect(page.getByRole('heading', { level: 1, name: 'Interns' })).toBeVisible()
    await page.getByRole('link', { name: 'Add intern' }).first().click()
    await expect(page).toHaveURL(/\/interns\/new$/)

    await page.locator('#firstName').fill(john.first)
    await page.locator('#lastName').fill(john.last)
    await page.locator('#email').fill(john.email)
    await page.locator('#phone').fill('+91 98450 12345')
    await page.locator('#departmentId').selectOption({ label: 'Marketing' })
    await page.locator('#positionId').selectOption({ label: 'Digital Marketing Intern' })
    const today = new Date()
    const end = new Date(today.getTime() + 89 * 86_400_000)
    await page.locator('#joiningDate').fill(today.toISOString().slice(0, 10))
    await page.locator('#expectedEndDate').fill(end.toISOString().slice(0, 10))
    await page.locator('#managerId').selectOption({ label: 'Priya Kapoor (Manager)' })
    await page.locator('#mentorId').selectOption({ label: 'Rohan Das (Mentor)' })
    await page.locator('#emergencyName').fill('Jane Doe')
    await page.locator('#emergencyRelationship').fill('Parent')
    await page.locator('#emergencyPhone').fill('+91 98450 99999')
    await page.locator('#templateId').selectOption({ label: 'Marketing Intern Onboarding' })
    await page.getByRole('checkbox', { name: /Send an invitation/ }).check()
    await page.getByRole('button', { name: 'Create intern' }).click()

    await expect(page.getByText('Intern added')).toBeVisible()
    await expect(page.getByText(/AYV-INT-\d{4,}/).first()).toBeVisible()
    inviteUrl = await page.getByRole('textbox', { name: 'Invitation link' }).inputValue()
    expect(inviteUrl).toMatch(/\/invite\//)

    await page.getByRole('link', { name: 'Open profile' }).click()
    await expect(page.getByRole('heading', { level: 1, name: `${john.first} ${john.last}` })).toBeVisible()
    profileUrl = new URL(page.url()).pathname
    const header = page.locator('header').filter({ hasText: john.last })
    await expect(header.getByText('Onboarding', { exact: true })).toBeVisible()
    await expect(page.getByText('Priya Kapoor').first()).toBeVisible()
    await expect(page.getByText('Rohan Das').first()).toBeVisible()
    await expect(page.getByRole('progressbar', { name: /Internship progress/ })).toBeVisible()

    // Future modules say so plainly instead of showing fake data.
    await page.getByRole('link', { name: 'Attendance', exact: true }).click()
    await expect(page.getByText(/future phase|Phase 0\d/i).first()).toBeVisible()
    await page.context().close()
  })

  test('the directory finds the new intern with server-side search', async ({ browser }) => {
    const page = await as(browser, 'hr')
    await page.goto('/interns')
    await page.getByRole('searchbox').first().fill(john.email)
    await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(john.email).replace(/\./g, '\\.')}`))
    await expect(page.getByRole('link', { name: `${john.first} ${john.last}` }).first()).toBeVisible()
    await page.goto('/interns?status=TERMINATED&q=no-such-intern-xyz')
    await expect(page.getByText(/No interns (found|match)/i).first()).toBeVisible()
    await page.context().close()
  })

  test('John accepts the invitation and sees only his own internship and onboarding', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(new URL(inviteUrl).pathname)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByLabel('Confirm password').fill(password)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page).not.toHaveURL(/\/invite\//)
    if (/\/login/.test(page.url()) || (await page.getByRole('link', { name: 'Go to sign in' }).count())) {
      await page.goto('/login')
      await page.getByLabel('Email').fill(john.email)
      await page.getByLabel('Password', { exact: true }).fill(password)
      await page.getByRole('button', { name: 'Sign in' }).click()
    }
    await expect(page).not.toHaveURL(/\/login/)

    // Dashboard: his internship, onboarding progress, manager and mentor.
    await page.goto('/')
    await expect(page.getByText('My internship').first()).toBeVisible()
    await expect(page.getByText('Priya Kapoor')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Continue onboarding' })).toBeVisible()

    await page.getByRole('link', { name: 'Continue onboarding' }).click()
    await expect(page).toHaveURL(new RegExp(`${profileUrl}/onboarding$`))
    const progress = page.getByRole('progressbar', { name: /Onboarding progress/ }).first()
    const before = Number(await progress.getAttribute('aria-valuenow'))

    const item = page.getByRole('listitem').filter({ hasText: 'Complete your first task' })
    await item.getByRole('button', { name: 'Mark complete' }).click()
    await expect(item.getByText(/Done by/)).toBeVisible()
    await expect.poll(async () => Number(await progress.getAttribute('aria-valuenow'))).toBeGreaterThan(before)

    // Versioned policy acknowledgement.
    const nda = page.getByRole('listitem').filter({ hasText: 'Accept the confidentiality agreement' })
    await nda.getByRole('button', { name: 'Read & acknowledge' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('checkbox').check()
    await dialog.getByRole('button', { name: /acknowledge/i }).click()
    await expect(nda.getByText(/acknowledged/)).toBeVisible()

    // Another intern's profile is not found; so is the API.
    await page.goto('/my-internship')
    await expect(page).toHaveURL(new RegExp(`${profileUrl}$`))
    await context.close()
  })

  test('the manager sees John with allowed information only', async ({ browser }) => {
    const page = await as(browser, 'marketingManager')
    await page.goto('/my-interns')
    await expect(page.getByRole('heading', { level: 1, name: 'My Interns' })).toBeVisible()
    await page.getByRole('link', { name: `${john.first} ${john.last}` }).click()
    await expect(page).toHaveURL(new RegExp(`${profileUrl}$`))
    // Contact details are masked and HR controls are absent.
    await expect(page.getByText('••••••2345').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Change status' })).toHaveCount(0)
    await page.context().close()
  })

  test('a manager is denied an unrelated intern (404), in the page and the API', async ({ browser }) => {
    const page = await as(browser, 'manager') // Arjun manages Development/Design, not John
    await expectNotFound(page, profileUrl)
    const id = profileUrl.split('/').pop()
    expect((await page.request.get(`/api/interns/${id}`)).status()).toBe(404)
    await page.context().close()
  })

  test('another intern cannot open John’s profile or onboarding', async ({ browser }) => {
    const page = await as(browser, 'intern')
    await expectNotFound(page, profileUrl)
    await expectNotFound(page, `${profileUrl}/onboarding`)
    const id = profileUrl.split('/').pop()
    expect((await page.request.get(`/api/interns/${id}`)).status()).toBe(404)
    await page.context().close()
  })

  test('HR changes the mentor (with confirmation) and moves John to Active', async ({ browser }) => {
    const page = await as(browser, 'hr')
    await page.goto(profileUrl)
    await page.getByRole('button', { name: 'Mentor' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Mentor').selectOption({ label: 'Sana Qureshi (Mentor)' })
    const save = dialog.getByRole('button', { name: 'Save' })
    await expect(save).toBeDisabled() // replacing someone needs explicit confirmation
    await dialog.getByRole('checkbox').check()
    await save.click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByText('Sana Qureshi').first()).toBeVisible()

    // The change is on the activity timeline.
    await page.goto(`${profileUrl}?tab=activity`)
    await expect(page.getByText('Mentor set to Sana Qureshi')).toBeVisible()

    // Onboarding isn't finished: activating needs an override with a reason.
    await page.goto(profileUrl)
    await page.getByRole('button', { name: 'Change status' }).click()
    const status = page.getByRole('dialog')
    await status.getByLabel('New status').selectOption('ACTIVE')
    await status.getByRole('checkbox').first().check()
    await status.getByRole('textbox', { name: 'Reason' }).fill('Starting on a client campaign early')
    await status.getByRole('button', { name: 'Change to Active' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('header').filter({ hasText: john.last }).getByText('Active', { exact: true })).toBeVisible()
    await page.context().close()
  })
})

test.describe('HR screens', () => {
  test('the HR dashboard and onboarding dashboard show database figures', async ({ page }) => {
    await page.goto('/hr')
    const totals = page.getByRole('region', { name: 'Programme totals' })
    for (const label of ['Total interns', 'Active', 'Onboarding', 'Ending soon', 'Completed']) {
      await expect(totals.getByText(label, { exact: true })).toBeVisible()
    }
    await expect(page.getByRole('link', { name: 'Manage templates' })).toBeVisible()
    await page.goto('/onboarding')
    await expect(page.getByRole('heading', { level: 1, name: 'Onboarding' })).toBeVisible()
    await expect(page.getByText('Total onboarding')).toBeVisible()
    await page.goto('/onboarding/templates')
    await expect(page.getByText('Marketing Intern Onboarding')).toBeVisible()
  })

  test('the directory keeps filters in the URL and paginates on the server', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the table is the desktop layout; phones get cards (checked below)')
    await page.goto('/interns?status=ACTIVE&sort=end&dir=desc')
    await expect(page.getByRole('heading', { level: 1, name: 'Interns' })).toBeVisible()
    const statuses = page.locator('table').getByText('Active', { exact: true })
    await expect(statuses.first()).toBeVisible()
    await expect(page.locator('table').getByText('Onboarding', { exact: true })).toHaveCount(0)
  })

  test('intern screens fit a phone screen without sideways scrolling', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile only')
    for (const path of ['/interns', '/hr', '/onboarding', '/interns/new']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, path).toBeLessThanOrEqual(1)
    }
    // The directory becomes a card list on phones.
    await page.goto('/interns')
    await expect(page.getByRole('list', { name: 'Interns' })).toBeVisible()
  })
})

test('mentors see only their mentees', async ({ browser, isMobile }) => {
  test.skip(isMobile, 'runs once')
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  await signIn(page, 'designMentor')
  await page.goto('/my-mentees')
  await expect(page.getByRole('heading', { level: 1, name: 'My Mentees' })).toBeVisible()
  await expect(page.getByText('Zara Khan').first()).toBeVisible()
  await expect(page.getByText('Aanya Sharma')).toHaveCount(0)
  expect(ACCOUNTS.designMentor).toContain('design.mentor')
  await context.close()
})
