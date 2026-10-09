import { expect as baseExpect, test, type Browser, type Page } from '@playwright/test'
import { AUTH_CONFIGURED, signIn, SKIP_REASON, type AccountRole } from '../support'

// Learning and performance pages run several queries against a remote development database.
const expect = baseExpect.configure({ timeout: 45_000 })

test.skip(!AUTH_CONFIGURED, SKIP_REASON)
test.use({ storageState: { cookies: [], origins: [] } })

/**
 * Prompt 06 end-to-end stories (desktop, serial; they change shared data):
 *   Learning: HR builds a course (lesson + true/false quiz), publishes and
 *   assigns it to the intern; the intern completes the lesson, passes the quiz
 *   and the course shows as completed.
 *   Performance: the intern submits this week's check-in and their self-review;
 *   the manager gives feedback and submits the manager stage of a review, the
 *   mentor submits theirs and HR signs off, which completes and locks it.
 * Needs a freshly seeded database (`npm run db:seed`) for the review stages.
 */
test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

async function as(browser: Browser, role: AccountRole, next?: string): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, role, next)
  return page
}

async function saveDialog(page: Page) {
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
}

test('learning: HR builds and assigns a course; the intern completes it', async ({ browser }, info) => {
  test.skip(info.project.name !== 'app-desktop', 'One story per run (shared data)')
  const title = `E2E Course ${Date.now().toString(36)}`

  // HR creates the course.
  const hr = await as(browser, 'hr', '/learning/manage')
  await expect(hr.getByRole('heading', { level: 1, name: 'Manage learning' })).toBeVisible()
  await hr.getByRole('button', { name: 'New course' }).click()
  await hr.getByRole('dialog').getByLabel('Title').fill(title)
  await hr.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(hr).toHaveURL(/\/learning\/manage\/courses\//)
  await expect(hr.getByRole('heading', { level: 1, name: title })).toBeVisible()

  // A lesson in Module 1.
  await hr.getByRole('button', { name: 'Lesson', exact: true }).first().click()
  await hr.getByRole('dialog').getByLabel('Title').fill('Welcome lesson')
  await hr.getByRole('dialog').getByLabel('Lesson text').fill('# Hello\nThis is the lesson.\n\n- one\n- two')
  await saveDialog(hr)
  await expect(hr.getByText('Welcome lesson')).toBeVisible()

  // A course-level quiz with one true/false question.
  await hr.getByRole('button', { name: 'Quiz', exact: true }).click()
  await hr.getByRole('dialog').getByLabel('Title').fill('Final check')
  await saveDialog(hr)
  await expect(hr.getByText('Quiz: Final check')).toBeVisible()
  await hr.getByRole('button', { name: 'Question', exact: true }).click()
  const questionDialog = hr.getByRole('dialog')
  await questionDialog.getByLabel('Question', { exact: true }).fill('The sky is blue.')
  await questionDialog.getByLabel('Type').selectOption('TRUE_FALSE')
  await questionDialog.getByRole('radio', { name: 'True' }).check()
  await saveDialog(hr)
  await expect(hr.getByText('1. The sky is blue.')).toBeVisible()
  await hr.getByRole('button', { name: 'Publish quiz' }).click()
  await expect(hr.getByRole('button', { name: 'Publish quiz' })).toBeHidden()
  await hr.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(hr.getByText('Published', { exact: true })).toBeVisible()

  // Assign it to the intern from the course page.
  await hr.getByRole('link', { name: 'Preview' }).click()
  await hr.getByRole('button', { name: 'Assign' }).click()
  const assign = hr.getByRole('dialog')
  await assign.getByLabel('Find people').fill('Aanya')
  await assign.getByRole('checkbox', { name: /Aanya Sharma/ }).check()
  await assign.getByRole('button', { name: 'Assign' }).click()
  await expect(assign).toBeHidden()

  // The intern learns.
  const intern = await as(browser, 'intern', '/learning')
  await expect(intern.getByRole('heading', { level: 1, name: 'Learning Hub' })).toBeVisible()
  await intern.getByRole('link', { name: title }).first().click()
  await intern.getByRole('link', { name: 'Start course' }).click()
  await expect(intern.getByRole('heading', { level: 1, name: 'Welcome lesson' })).toBeVisible()
  await expect(intern.getByRole('heading', { level: 2, name: 'Hello' })).toBeVisible()
  await intern.getByRole('button', { name: 'Mark lesson complete' }).click()
  await expect(intern.getByText('Completed', { exact: true })).toBeVisible()

  await intern.getByRole('link', { name: 'Back to course' }).click()
  await intern.getByRole('link', { name: 'Quiz: Final check' }).click()
  await intern.getByRole('button', { name: 'Start quiz' }).click()
  await expect(intern).toHaveURL(/\/learning\/quizzes\/attempts\//)
  await intern.getByRole('radio', { name: 'True' }).check()
  await intern.getByRole('button', { name: 'Submit answers' }).click()
  await expect(intern.getByText('Passed', { exact: true })).toBeVisible()
  await expect(intern.getByText('100%')).toBeVisible()

  await intern.getByRole('link', { name: title }).first().click()
  await expect(intern.getByRole('heading', { name: 'Your progress' })).toBeVisible()
  await expect(intern.getByText('Completed', { exact: true }).first()).toBeVisible()
})

test('performance: check-in, self-review, feedback and a review through every stage', async ({ browser }, info) => {
  test.skip(info.project.name !== 'app-desktop', 'One story per run (shared data)')

  // Intern: weekly check-in (skipped if already submitted this week) and self-review.
  const intern = await as(browser, 'intern', '/performance/checkins')
  await expect(intern.getByRole('heading', { level: 1, name: 'Weekly check-in' })).toBeVisible()
  const thisWeek = intern.getByRole('heading', { name: 'This week' })
  if (await thisWeek.isVisible()) {
    await intern.getByLabel('What did you accomplish this week?').first().fill('Finished the onboarding checklist.')
    await intern.getByLabel('What are your priorities for next week?').first().fill('Start the landing page.')
    await intern.getByRole('button', { name: 'Submit check-in' }).first().click()
    await expect(intern.getByText(/This week’s check-in is/)).toBeVisible()
  }

  await intern.goto('/performance/reviews')
  await intern.getByRole('link', { name: 'Aanya Sharma' }).first().click()
  const selfPart = intern.getByRole('heading', { name: 'Your part: Self-review' })
  if (await selfPart.isVisible()) {
    await intern.getByLabel('What are you most proud of so far?').fill('Shipping my first page.')
    await intern.getByLabel('Where would you like more support?').fill('Code reviews.')
    await intern.getByRole('radiogroup', { name: 'Rate your confidence in your core role skills' }).getByText('Meets expectations').click()
    await intern.getByRole('button', { name: 'Submit self-review' }).click()
    await expect(selfPart).toBeHidden()
  }
  await expect(intern.getByText(/answers are shared with you when the review is completed|Other answers you can see|Answers/).first()).toBeVisible()

  // Manager: feedback for Ishaan, then the manager stage of his review.
  const manager = await as(browser, 'manager', '/performance/feedback?view=interns')
  await manager.getByRole('button', { name: 'Give feedback' }).first().click()
  const give = manager.getByRole('dialog')
  await give.getByLabel('Intern').selectOption({ label: 'Ishaan Verma' })
  await give.getByLabel('Type').selectOption('POSITIVE')
  await give.getByLabel('Feedback', { exact: true }).fill('Great energy in the client call this week — keep it up.')
  await give.getByRole('button', { name: 'Save' }).click()
  await expect(give).toBeHidden()
  await expect(manager.getByText('Great energy in the client call this week')).toBeVisible()

  async function submitStaffStage(page: Page, part: string) {
    await page.goto('/performance/reviews')
    await page.getByRole('link', { name: 'Ishaan Verma' }).first().click()
    await expect(page.getByRole('heading', { name: `Your part: ${part}` })).toBeVisible()
    for (const prompt of ['Quality of work', 'Communication', 'Ownership']) {
      await page.getByRole('radiogroup', { name: prompt }).getByText('Exceeds expectations').click()
    }
    await page.getByLabel('Evidence for: Quality of work').fill('Approved campaign tasks this month.')
    await page.getByRole('checkbox', { name: 'Reliability' }).check()
    if (part === 'Manager') {
      await page.getByLabel('Summary of performance this period').fill('Strong month; next focus is sharing drafts earlier.')
      await page.getByRole('radiogroup', { name: 'On track to complete the internship successfully?' }).getByText('Yes').click()
    }
    await page.getByRole('button', { name: `Submit ${part.toLowerCase()}` }).click()
    await expect(page.getByRole('heading', { name: `Your part: ${part}` })).toBeHidden()
  }
  await submitStaffStage(manager, 'Manager')
  // The manager now sees the submitted self-review but not yet the mentor's answers.
  await expect(manager.getByText('Self-review').first()).toBeVisible()

  const mentor = await as(browser, 'mentor')
  await submitStaffStage(mentor, 'Mentor')

  // HR signs off; the review completes and locks.
  const hr = await as(browser, 'hr', '/performance/reviews?status=HR_REVIEW')
  await hr.getByRole('link', { name: 'Ishaan Verma' }).first().click()
  await expect(hr.getByRole('heading', { name: 'Your part: HR' })).toBeVisible()
  await hr.getByLabel('HR notes (visible to HR only)').fill('Reviewed; no concerns.')
  await hr.getByRole('button', { name: 'Submit hr' }).click()
  await expect(hr.getByRole('button', { name: 'Reopen' })).toBeVisible()
  await expect(hr.getByText('Completed', { exact: true }).first()).toBeVisible()
})
