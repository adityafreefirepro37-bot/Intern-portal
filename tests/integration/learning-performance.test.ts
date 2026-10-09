import { setAuthProviderForTesting } from '@/lib/auth/provider'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { addDays, formatDateOnly, todayIn } from '@/lib/interns/dates'
import { weekStart } from '@/lib/performance/rules'
import type { RequestContext } from '@/server/context'
import { domainEvents } from '@/server/events/domain-events'
import { AUDIT_ACTIONS } from '@/server/services/audit-actions'
import { checkinService } from '@/server/services/checkin.service'
import { feedbackService } from '@/server/services/feedback.service'
import { goalService } from '@/server/services/goal.service'
import { internService } from '@/server/services/intern.service'
import { learningAssignmentService } from '@/server/services/learning-assignment.service'
import { learningCatalogService } from '@/server/services/learning-catalog.service'
import { learningService } from '@/server/services/learning.service'
import { performanceReviewService } from '@/server/services/performance-review.service'
import { quizService } from '@/server/services/quiz.service'
import { searchService } from '@/server/services/search.service'
import { seedId } from '../../prisma/seed/ids'
import { contextFor, meta, prisma, uniqueSuffix, useFakeAuth } from './helpers'

/**
 * Phase 06 security and workflow checks against the seeded database
 * (prisma/seed/learning-performance.ts): quiz answer leakage, score
 * manipulation, completion bypass, assignment review scope, review privacy and
 * stages, feedback visibility, goals, check-ins, cross-organization access and
 * required training for new interns.
 */

const course = (k: string) => seedId(`p6:course:${k}`)
const lesson = (k: string, m: number, l: number) => seedId(`p6:lesson:${k}:${m}:${l}`)
const quiz = (k: string) => seedId(`p6:quiz:${k}`)
const question = (k: string, i: number) => seedId(`p6:question:${k}:${i}`)
const option = (k: string, i: number, o: number) => seedId(`p6:option:${k}:${i}:${o}`)
const rq = (section: string, i: number) => seedId(`p6:rq:${section}:${i}`)

let intern: RequestContext // Aanya — onboarding, manager Vikram, mentor Priya
let ishaan: RequestContext // manager Arjun, mentor Rohan
let zara: RequestContext
let tara: RequestContext
let hr: RequestContext
let manager: RequestContext // Arjun
let mentor: RequestContext // Rohan
let devManager: RequestContext // Vikram
let devMentor: RequestContext // Priya

beforeAll(async () => {
  useFakeAuth()
  ;[intern, ishaan, zara, tara, hr, manager, mentor, devManager, devMentor] = await Promise.all([
    contextFor('intern@ayavacreatives.com'),
    contextFor('ishaan.verma@demo.ayavacreatives.com'),
    contextFor('zara.khan@demo.ayavacreatives.com'),
    contextFor('tara.menon@demo.ayavacreatives.com'),
    contextFor('hr@ayavacreatives.com'),
    contextFor('manager@ayavacreatives.com'),
    contextFor('mentor@ayavacreatives.com'),
    contextFor('vikram.rao@demo.ayavacreatives.com'),
    contextFor('priya.kulkarni@demo.ayavacreatives.com'),
  ])
})

afterAll(async () => {
  setAuthProviderForTesting(null)
  domainEvents.reset()
  await prisma.$disconnect()
})

describe('quizzes', () => {
  it('never sends correct answers before submission', async () => {
    const { attemptId } = await quizService.start(intern, quiz('security'))
    const take = await quizService.take(intern, attemptId)
    const payload = JSON.stringify(take)
    expect(payload).not.toMatch(/is_correct|accepted_answers|acceptedAnswers|explanation|two-factor/i)
    expect(take.submitted).toBe(false)
    // Starting again resumes the same open attempt.
    expect((await quizService.start(intern, quiz('security'))).attemptId).toBe(attemptId)
  })

  it('grades on the server: no client score, forged options ignored, single submit', async () => {
    const { attemptId } = await quizService.start(intern, quiz('security'))
    await expect(
      quizService.submit(intern, { attemptId, answers: [], score: 100, passed: true }),
    ).rejects.toBeInstanceOf(ValidationError)
    const result = await quizService.submit(intern, {
      attemptId,
      answers: [
        { questionId: question('security', 0), selectedOptionIds: [option('security', 0, 0), seedId('forged')] },
        { questionId: question('security', 1), selectedOptionIds: [option('security', 1, 0)] },
        { questionId: question('security', 2), text: 'no idea' },
      ],
    })
    expect(result).toMatchObject({ passed: false, percentage: 0 })
    await expect(quizService.submit(intern, { attemptId, answers: [] })).rejects.toBeInstanceOf(ConflictError)
    const stored = await prisma.quizAttempt.findUniqueOrThrow({ where: { id: attemptId } })
    expect(stored).toMatchObject({ status: 'SUBMITTED', score: 0, passed: false })
  })

  it('reveals answers per policy and only to the learner (or reviewers in scope)', async () => {
    const attempt = await prisma.quizAttempt.findFirstOrThrow({
      where: { user_id: intern.actor.userId, quiz_id: quiz('security'), status: 'SUBMITTED' },
    })
    const own = await quizService.result(intern, attempt.id)
    expect(own.open).toBe(false)
    // Another learner's attempt is not found.
    await expect(quizService.result(ishaan, attempt.id)).rejects.toBeInstanceOf(NotFoundError)
    // The intern's mentor can see the result.
    await expect(quizService.result(devMentor, attempt.id)).resolves.toMatchObject({ open: false })
    // …but a mentor of other interns cannot.
    await expect(quizService.result(mentor, attempt.id)).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('course completion', () => {
  it('cannot be bypassed: locks, enrollment and requirements are enforced on the server', async () => {
    // Lesson 3 is locked until lesson 2 is done (Aanya has only completed lesson 1).
    await expect(learningService.completeLesson(intern, lesson('security', 1, 0))).rejects.toBeInstanceOf(ValidationError)
    // Not enrolled in AI Fundamentals.
    await expect(learningService.completeLesson(intern, lesson('ai', 0, 0))).rejects.toBeInstanceOf(ValidationError)

    for (const [m, l] of [
      [0, 1],
      [1, 0],
      [1, 1],
    ]) {
      await learningService.completeLesson(intern, lesson('security', m, l))
    }
    // All lessons done, but the required quiz hasn't been passed yet.
    let enrollment = await prisma.courseEnrollment.findUniqueOrThrow({
      where: { course_id_user_id: { course_id: course('security'), user_id: intern.actor.userId } },
    })
    expect(enrollment.status).toBe('IN_PROGRESS')
    expect(enrollment.progress_percentage).toBeLessThan(100)

    const { attemptId } = await quizService.start(intern, quiz('security'))
    const result = await quizService.submit(intern, {
      attemptId,
      answers: [
        { questionId: question('security', 0), selectedOptionIds: [option('security', 0, 1)] },
        { questionId: question('security', 1), selectedOptionIds: [option('security', 1, 1)] },
        { questionId: question('security', 2), text: '  Two-Factor   Authentication ' },
      ],
    })
    expect(result).toMatchObject({ passed: true, percentage: 100 })
    enrollment = await prisma.courseEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } })
    expect(enrollment).toMatchObject({ status: 'COMPLETED', progress_percentage: 100 })
    expect(await prisma.auditLog.count({ where: { resource_id: enrollment.id, action: AUDIT_ACTIONS.LEARNING_COMPLETED } })).toBe(1)
  })

  it('only lets managers assign within their scope', async () => {
    await expect(
      learningService.assign(mentor, { courseId: course('ai'), userIds: [intern.actor.userId] }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(learningService.assign(intern, { courseId: course('ai'), userIds: [intern.actor.userId] })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    const { created } = await learningService.assign(devMentor, { courseId: course('ai'), userIds: [intern.actor.userId] })
    expect(created).toBe(1)
  })
})

describe('learning assignments', () => {
  const submissionId = () => seedId('p6:submission:ishaan:content')

  it('is reviewed only by reviewers in scope, never by the submitter, within the rubric points', async () => {
    await expect(learningAssignmentService.submission(devMentor, submissionId())).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      learningAssignmentService.review(devMentor, { submissionId: submissionId(), decision: 'APPROVE', points: 5 }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      learningAssignmentService.review(ishaan, { submissionId: submissionId(), decision: 'APPROVE', points: 5 }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      learningAssignmentService.review(mentor, { submissionId: submissionId(), decision: 'APPROVE', points: 11 }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(learningAssignmentService.review(mentor, { submissionId: submissionId(), decision: 'APPROVE' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await learningAssignmentService.review(mentor, { submissionId: submissionId(), decision: 'APPROVE', points: 9 })
    await expect(
      learningAssignmentService.review(mentor, { submissionId: submissionId(), decision: 'APPROVE', points: 9 }),
    ).rejects.toBeInstanceOf(ConflictError)
    // Approval completes the course (lessons done, quiz passed).
    const enrollment = await prisma.courseEnrollment.findUniqueOrThrow({
      where: { course_id_user_id: { course_id: course('content'), user_id: ishaan.actor.userId } },
    })
    expect(enrollment.status).toBe('COMPLETED')
  })

  it('keeps drafts private and lets learners resubmit after changes are requested', async () => {
    const assignmentId = seedId('p6:assignment:frontend')
    await expect(learningAssignmentService.saveDraft(intern, { assignmentId, text: 'notes' })).resolves.toBeUndefined()
    const draft = await prisma.learningAssignmentSubmission.findUniqueOrThrow({
      where: { assignment_id_user_id: { assignment_id: assignmentId, user_id: intern.actor.userId } },
    })
    await expect(learningAssignmentService.submission(devMentor, draft.id)).rejects.toBeInstanceOf(NotFoundError)
    await learningAssignmentService.submit(intern, { assignmentId, message: 'Version one' })
    await learningAssignmentService.review(devMentor, { submissionId: draft.id, decision: 'REQUEST_CHANGES', comment: 'Add labels' })
    const { version } = await learningAssignmentService.submit(intern, { assignmentId, message: 'Version two' })
    expect(version).toBe(2)
    const versions = await prisma.learningSubmissionVersion.findMany({ where: { submission_id: draft.id }, orderBy: { version_number: 'asc' } })
    expect(versions.map((v) => [v.version_number, v.status])).toEqual([
      [1, 'CHANGES_REQUESTED'],
      [2, 'RESUBMITTED'],
    ])
  })
})

describe('performance reviews', () => {
  const review = (k: string) => seedId(`p6:review:${k}`)

  it('hides answers by stage and role', async () => {
    // Ishaan's review is at the manager stage with the self-review submitted.
    const asManager = await performanceReviewService.get(manager, review('ishaan'))
    const selfAnswers = asManager.sections.flatMap((s) => s.questions.flatMap((q) => q.answers)).filter((a) => a.respondent === 'SELF')
    expect(selfAnswers.length).toBeGreaterThan(0)
    expect(asManager.myRespondent).toBe('MANAGER')
    // The mentor can't write yet; the intern sees only their own answers.
    expect((await performanceReviewService.get(mentor, review('ishaan'))).myRespondent).toBeNull()
    const asIntern = await performanceReviewService.get(ishaan, review('ishaan'))
    expect(new Set(asIntern.sections.flatMap((s) => s.questions.flatMap((q) => q.answers.map((a) => a.respondent))))).toEqual(
      new Set(['SELF']),
    )
    // Tara's completed review: she sees manager and mentor answers but never HR notes.
    const taraView = await performanceReviewService.get(tara, review('tara'))
    const respondents = new Set(taraView.sections.flatMap((s) => s.questions.flatMap((q) => q.answers.map((a) => a.respondent))))
    expect(respondents.has('MANAGER')).toBe(true)
    expect(respondents.has('HR')).toBe(false)
    const managerView = await performanceReviewService.get(manager, review('tara'))
    expect(managerView.sections.some((s) => s.questions.some((q) => q.answers.some((a) => a.respondent === 'HR')))).toBe(false)
    const hrView = await performanceReviewService.get(hr, review('tara'))
    expect(hrView.sections.some((s) => s.questions.some((q) => q.answers.some((a) => a.respondent === 'HR')))).toBe(true)
    // Other interns and out-of-scope staff can't open it at all.
    await expect(performanceReviewService.get(intern, review('ishaan'))).rejects.toBeInstanceOf(NotFoundError)
    await expect(performanceReviewService.get(devMentor, review('ishaan'))).rejects.toBeInstanceOf(NotFoundError)
  })

  it('runs self → manager → mentor → HR, then locks; corrections keep history', async () => {
    const id = review('intern')
    await expect(performanceReviewService.saveAnswers(devManager, { reviewId: id, answers: [], submit: true })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    await expect(
      performanceReviewService.saveAnswers(intern, { reviewId: id, answers: [{ questionId: rq('self', 0), text: 'Proud' }], submit: true }),
    ).rejects.toBeInstanceOf(ValidationError)
    // A question from another respondent's section is rejected.
    await expect(
      performanceReviewService.saveAnswers(intern, { reviewId: id, answers: [{ questionId: rq('hr', 0), text: 'x' }] }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(
      await performanceReviewService.saveAnswers(intern, {
        reviewId: id,
        submit: true,
        answers: [
          { questionId: rq('self', 0), text: 'Shipped my first page' },
          { questionId: rq('self', 1), text: 'Code reviews' },
          { questionId: rq('self', 2), rating: 3 },
        ],
      }),
    ).toMatchObject({ submitted: true, status: 'MANAGER_REVIEW' })

    const staffAnswers = [
      { questionId: rq('skills', 0), rating: 4, evidence: 'Approved submissions' },
      { questionId: rq('skills', 1), rating: 4 },
      { questionId: rq('skills', 2), rating: 3 },
      { questionId: rq('skills', 3), selected: ['Curiosity'] },
    ]
    await expect(
      performanceReviewService.saveAnswers(devManager, {
        reviewId: id,
        submit: true,
        answers: [{ questionId: rq('skills', 0), rating: 7 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(
      await performanceReviewService.saveAnswers(devManager, {
        reviewId: id,
        submit: true,
        answers: [...staffAnswers, { questionId: rq('overall', 0), text: 'Good start' }, { questionId: rq('overall', 1), bool: true }],
      }),
    ).toMatchObject({ status: 'MENTOR_REVIEW' })
    // The intern still can't see the manager's answers.
    const mid = await performanceReviewService.get(intern, id)
    expect(mid.sections.some((s) => s.questions.some((q) => q.answers.some((a) => a.respondent === 'MANAGER')))).toBe(false)

    expect(await performanceReviewService.saveAnswers(devMentor, { reviewId: id, submit: true, answers: staffAnswers })).toMatchObject({
      status: 'HR_REVIEW',
    })
    expect(
      await performanceReviewService.saveAnswers(hr, { reviewId: id, submit: true, answers: [{ questionId: rq('hr', 0), text: 'OK' }] }),
    ).toMatchObject({ status: 'COMPLETED' })
    const locked = await prisma.performanceReview.findUniqueOrThrow({ where: { id } })
    expect(locked.locked_at).not.toBeNull()
    await expect(performanceReviewService.saveAnswers(hr, { reviewId: id, answers: [] })).rejects.toBeInstanceOf(ConflictError)

    const answer = await prisma.performanceReviewAnswer.findFirstOrThrow({
      where: { review_id: id, respondent: 'MANAGER', question_id: rq('skills', 2) },
    })
    await expect(
      performanceReviewService.correctAnswer(devManager, { answerId: answer.id, rating: 4, reason: 'Typo in rating' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await performanceReviewService.correctAnswer(hr, { answerId: answer.id, rating: 4, reason: 'Typo in rating' })
    const revision = await prisma.performanceReviewRevision.findFirstOrThrow({ where: { answer_id: answer.id } })
    expect(revision.before).toMatchObject({ rating: 3 })
    expect(revision.after).toMatchObject({ rating: 4 })
    expect(await prisma.auditLog.count({ where: { resource_id: id, action: AUDIT_ACTIONS.REVIEW_CORRECTED } })).toBe(1)

    await performanceReviewService.reopen(hr, { reviewId: id, stage: 'HR_REVIEW', reason: 'Add HR notes' })
    const reopened = await prisma.performanceReview.findUniqueOrThrow({ where: { id } })
    expect(reopened).toMatchObject({ status: 'HR_REVIEW', locked_at: null, reopen_reason: 'Add HR notes' })
    expect(reopened.stage_submitted).not.toContain('HR')
  })
})

describe('feedback visibility', () => {
  const bodies = (rows: { body: string }[]) => rows.map((r) => r.body).join('\n')

  it('is enforced on every read, including search', async () => {
    const asIshaan = await feedbackService.page(ishaan, { view: 'received' })
    expect(bodies(asIshaan.feedback)).toMatch(/campaign recap/)
    expect(bodies(asIshaan.feedback)).not.toMatch(/Private note/)

    const asMentor = await feedbackService.page(mentor, { view: 'interns' })
    expect(bodies(asMentor.feedback)).toMatch(/campaign recap/)
    expect(bodies(asMentor.feedback)).not.toMatch(/Private note|HR note/)

    const asManager = await feedbackService.page(manager, { view: 'interns' })
    expect(bodies(asManager.feedback)).toMatch(/structured briefs/) // SHARED_WITH_MANAGER about Zara

    const asZara = await feedbackService.page(zara, { view: 'received' })
    expect(bodies(asZara.feedback)).not.toMatch(/structured briefs/)

    const asHr = await feedbackService.page(hr, { view: 'interns' })
    expect(bodies(asHr.feedback)).toMatch(/HR note/)
    expect(bodies(asHr.feedback)).not.toMatch(/Private note/)

    const search = await searchService.search(ishaan, 'Private note')
    expect(search.find((g) => g.type === 'feedback')).toBeUndefined()
    const hrSearch = await searchService.search(hr, 'Private note')
    expect(hrSearch.find((g) => g.type === 'feedback')).toBeUndefined()
  })

  it('validates givers, contexts and requests', async () => {
    await expect(
      feedbackService.give(intern, { internId: seedId('intern:intern'), feedbackType: 'GENERAL', visibility: 'SHARED_WITH_INTERN', body: 'Hello there, me' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    // A mentor can't give feedback to an intern they don't mentor.
    await expect(
      feedbackService.give(mentor, { internId: seedId('intern:intern'), feedbackType: 'GENERAL', visibility: 'SHARED_WITH_INTERN', body: 'Out of scope feedback' }),
    ).rejects.toBeInstanceOf(NotFoundError)
    // Context must belong to the intern.
    await expect(
      feedbackService.give(mentor, {
        internId: seedId('intern:ishaan'),
        feedbackType: 'POSITIVE',
        visibility: 'SHARED_WITH_INTERN',
        contextType: 'GOAL',
        contextId: seedId('p6:goal:g1'),
        body: 'Great work on this goal',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    // Interns may only ask their own manager or mentor.
    await expect(feedbackService.request(intern, { recipientId: manager.actor.userId, question: 'How am I doing?' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await feedbackService.request(intern, { recipientId: devManager.actor.userId, question: 'How am I doing?' })
    // Responding to a request completes it.
    const request = await prisma.feedbackRequest.findFirstOrThrow({ where: { id: seedId('p6:feedback-request:intern') } })
    await feedbackService.give(devMentor, {
      internId: seedId('intern:intern'),
      feedbackType: 'DEVELOPMENTAL',
      visibility: 'SHARED_WITH_INTERN',
      body: 'Add screenshots to your PR description.',
      requestId: request.id,
    })
    expect((await prisma.feedbackRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('COMPLETED')
  })
})

describe('goals and check-ins', () => {
  it('lets interns update but not close goals set by others', async () => {
    const goalId = seedId('p6:goal:g1')
    await goalService.setProgress(intern, { goalId, status: 'IN_PROGRESS', progress: 50 })
    await expect(goalService.setProgress(intern, { goalId, status: 'COMPLETED', progress: 100 })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(goalService.setProgress(intern, { goalId, status: 'IN_PROGRESS', progress: 30 })).rejects.toBeInstanceOf(ValidationError)
    await goalService.setProgress(devMentor, { goalId, status: 'COMPLETED', progress: 75 })
    expect(await prisma.performanceGoal.findUniqueOrThrow({ where: { id: goalId } })).toMatchObject({ status: 'COMPLETED', progress: 100 })
    await expect(goalService.get(ishaan, goalId)).rejects.toBeInstanceOf(NotFoundError)
    // Evidence must be the intern's own records.
    const othersTask = await prisma.task.findFirstOrThrow({ where: { assignees: { some: { user_id: ishaan.actor.userId } } } })
    await expect(
      goalService.addEvidence(intern, { goalId: seedId('p6:goal:g2'), type: 'TASK', referenceId: othersTask.id }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('keeps check-in drafts private and allows only reviewers to review', async () => {
    const week = formatDateOnly(weekStart(todayIn('Asia/Kolkata')))
    const { id } = await checkinService.save(intern, { weekStart: week, accomplishments: 'Draft only' })
    await expect(checkinService.get(devMentor, id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      checkinService.save(intern, { weekStart: formatDateOnly(addDays(weekStart(todayIn('Asia/Kolkata')), -21)), accomplishments: 'x' }),
    ).rejects.toBeInstanceOf(ValidationError)
    await checkinService.save(intern, { weekStart: week, accomplishments: 'Finished onboarding', submit: true })
    await expect(checkinService.save(intern, { weekStart: week, accomplishments: 'Edit after submit' })).rejects.toBeInstanceOf(ConflictError)
    await expect(checkinService.review(intern, { checkinId: id, comment: 'Self review' })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(checkinService.review(mentor, { checkinId: id, comment: 'Not mine' })).rejects.toBeInstanceOf(NotFoundError)
    await checkinService.review(devMentor, { checkinId: id, comment: 'Nice week' })
    expect((await prisma.weeklyCheckin.findUniqueOrThrow({ where: { id } })).status).toBe('REVIEWED')
  })
})

describe('organization isolation', () => {
  it('does not expose another organization’s courses or reviews', async () => {
    const other = await prisma.organization.create({ data: { name: 'Other Studio', slug: `other-${uniqueSuffix()}` } })
    const foreign = await prisma.course.create({
      data: { organization_id: other.id, title: 'Foreign course', slug: 'foreign', status: 'PUBLISHED' },
    })
    await expect(learningService.courseView(hr, foreign.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(learningService.enrollSelf(intern, foreign.id)).rejects.toBeInstanceOf(NotFoundError)
    const { page } = await learningCatalogService.catalog(hr, { q: 'Foreign' })
    expect(page.items.map((c) => c.id)).not.toContain(foreign.id)
    expect((await searchService.search(hr, 'Foreign course')).find((g) => g.type === 'course')).toBeUndefined()
  })
})

describe('HR integration', () => {
  it('enrolls a new intern in required training automatically', async () => {
    const today = todayIn('Asia/Kolkata')
    const department = await prisma.department.findFirstOrThrow({ where: { slug: 'development' } })
    const position = await prisma.position.findFirstOrThrow({ where: { slug: 'web-development-intern' } })
    const { internId } = await internService.create(
      hr,
      {
        firstName: 'Riya',
        lastName: 'Test',
        email: `riya.${uniqueSuffix()}@test.ayava.dev`,
        departmentId: department.id,
        positionId: position.id,
        joiningDate: formatDateOnly(today),
        expectedEndDate: formatDateOnly(addDays(today, 90)),
        workMode: 'HYBRID',
        managerId: devManager.actor.userId,
        mentorId: devMentor.actor.userId,
      },
      meta(),
    )
    const created = await prisma.intern.findUniqueOrThrow({ where: { id: internId } })
    const enrollments = await prisma.courseEnrollment.findMany({ where: { user_id: created.user_id } })
    expect(enrollments.map((e) => [e.course_id, e.enrollment_type]).sort()).toEqual(
      [
        [course('communication'), 'REQUIRED'],
        [course('security'), 'REQUIRED'],
      ].sort(),
    )
    expect(enrollments.every((e) => e.due_date !== null)).toBe(true)
  })
})
