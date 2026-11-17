import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { addDays, formatDateOnly, todayIn } from '@/lib/interns/dates'
import type { RequestContext } from '@/server/context'
import { setAIProviderForTesting, type AIProvider, type GenerateOptions, type StreamEvent } from '@/server/ai/provider'
import { assessmentJobs, assessmentService } from '@/server/services/assessment.service'
import { AUDIT_ACTIONS } from '@/server/services/audit-actions'
import { NOTIFICATION_TYPES } from '@/server/services/notification.service'
import { projectService } from '@/server/services/project.service'
import { taskLifecycleService } from '@/server/services/task-lifecycle.service'
import { taskSubmissionService } from '@/server/services/task-submission.service'
import { taskService } from '@/server/services/task.service'
import { AYAVA_ORGANIZATION_ID } from '../../prisma/seed/ids'
import { contextFor, prisma, uniqueSuffix } from './helpers'

/** Answers structured requests from a queue (question drafts, then grade suggestions). */
class FakeProvider implements AIProvider {
  readonly name = 'fake'
  readonly model = 'fake-chat'
  readonly embeddingModel = null
  calls: GenerateOptions[] = []
  structured: string[] = []
  async generateText(options: GenerateOptions) {
    this.calls.push(options)
    return { text: this.structured.shift() ?? '{}', provider: this.name, model: this.model, usage: { input: 10, output: 5 } }
  }
  async *streamText(): AsyncIterable<StreamEvent> {
    throw new Error('not used')
  }
  async embed(): Promise<never> {
    throw new Error('not used')
  }
}

const DRAFT = JSON.stringify({
  questions: [
    { kind: 'MULTIPLE_CHOICE', prompt: 'Which export size did you use for the square banner?', options: ['1080×1080', '1200×628', '1920×1080', '600×600'], correct: 0, points: 1 },
    { kind: 'MULTIPLE_CHOICE', prompt: 'Which font is used in the headline of your banner?', options: ['Inter', 'Poppins', 'Lora', 'Roboto'], correct: 1, points: 1 },
    { kind: 'SHORT_ANSWER', prompt: 'Explain why you placed the logo where you did.', rubric: 'Mentions visual hierarchy and brand guidelines', points: 4 },
  ],
})

let fake: FakeProvider
let manager: RequestContext
let mentor: RequestContext // Priya, Aanya's mentor
let intern: RequestContext
let hr: RequestContext
const meta = { ipAddress: '203.0.113.20', userAgent: 'jest' }

beforeAll(async () => {
  ;[manager, mentor, intern, hr] = await Promise.all([
    contextFor('manager@ayavacreatives.com'),
    contextFor('priya.kulkarni@demo.ayavacreatives.com'),
    contextFor('intern@ayavacreatives.com'),
    contextFor('hr@ayavacreatives.com'),
  ])
  await prisma.setting.deleteMany({ where: { organization_id: AYAVA_ORGANIZATION_ID, key: 'ai' } })
})

beforeEach(() => {
  fake = new FakeProvider()
  setAIProviderForTesting(fake)
})

afterAll(async () => {
  setAIProviderForTesting(undefined)
  await prisma.$disconnect()
})

const dateIn = (days: number) => formatDateOnly(addDays(todayIn('Asia/Kolkata'), days))

/** A task the intern works on and submits; returns the task id and the new assessment. */
async function submittedTask(message = 'Banner in three sizes, exported for social.') {
  const { id: projectId } = await projectService.create(manager, {
    name: `Assessment test ${uniqueSuffix()}`,
    priority: 'MEDIUM',
    startDate: dateIn(0),
    targetEndDate: dateIn(30),
  })
  await projectService.setMember(manager, { projectId, userId: intern.actor.userId, role: 'CONTRIBUTOR' })
  const { id: taskId } = await taskService.create(manager, { title: `Social banner ${uniqueSuffix()}`, projectId, assigneeIds: [intern.actor.userId] })
  await taskLifecycleService.transitionStatus(intern, { taskId, to: 'IN_PROGRESS' })
  await taskSubmissionService.submit(intern, { taskId, message })
  const assessment = await prisma.taskAssessment.findFirstOrThrow({ where: { task_id: taskId, status: { not: 'CANCELLED' } }, orderBy: { created_at: 'desc' } })
  return { taskId, assessment }
}

describe('task assessments', () => {
  it('AI drafts → mentor approves → intern takes it proctored → mentor grades → the task can be approved', async () => {
    fake.structured.push(DRAFT, JSON.stringify({ points: 3, feedback: 'Covers hierarchy, not the guidelines.' }))
    const { taskId, assessment } = await submittedTask()

    // Drafted from the submission by AI, waiting for a reviewer.
    expect(assessment).toMatchObject({ status: 'AWAITING_APPROVAL', source: 'AI', generation_error: null, intern_user_id: intern.actor.userId })
    expect(fake.calls[0].messages.map((m) => m.content).join('\n')).toContain('Banner in three sizes')
    expect(await prisma.aiUsageEvent.count({ where: { feature: 'ASSESSMENT', user_id: intern.actor.userId } })).toBeGreaterThan(0)
    expect(await prisma.notification.count({ where: { user_id: mentor.actor.userId, type: NOTIFICATION_TYPES.ASSESSMENT_APPROVAL_NEEDED, related_entity_id: assessment.id } })).toBe(1)

    // The intern sees it but not the answer key, and can't start it or manage it yet.
    const internView = await assessmentService.get(intern, assessment.id)
    expect(internView.isIntern).toBe(true)
    expect(internView.canTake).toBe(false)
    expect(internView.questions.every((q) => q.correct_option === null && q.rubric === null)).toBe(true)
    await expect(assessmentService.start(intern, { assessmentId: assessment.id, consent: true, screenSurface: 'monitor' }, meta)).rejects.toBeInstanceOf(ValidationError)
    await expect(assessmentService.approve(intern, assessment.id)).rejects.toBeInstanceOf(ForbiddenError)

    // The submission can't be approved while the assessment is open.
    await expect(taskSubmissionService.review(manager, { taskId, decision: 'APPROVE' })).rejects.toBeInstanceOf(ValidationError)

    // The mentor edits the settings and approves.
    const review = await assessmentService.get(mentor, assessment.id)
    expect(review.canManage).toBe(true)
    expect(review.questions.map((q) => q.correct_option)).toEqual([0, 1, null])
    await assessmentService.saveQuestions(mentor, {
      assessmentId: assessment.id,
      timeLimitMinutes: 10,
      passPercent: 60,
      maxViolations: 2,
      questions: review.questions.map((q) =>
        q.kind === 'MULTIPLE_CHOICE'
          ? { kind: q.kind, prompt: q.prompt, options: q.options, correct: q.correct_option!, points: q.points }
          : { kind: q.kind, prompt: q.prompt, rubric: q.rubric ?? undefined, points: q.points },
      ),
    })
    await assessmentService.approve(mentor, assessment.id)
    expect(await prisma.notification.count({ where: { user_id: intern.actor.userId, type: NOTIFICATION_TYPES.ASSESSMENT_READY, related_entity_id: assessment.id } })).toBe(1)
    await expect(assessmentService.saveQuestions(mentor, { assessmentId: assessment.id, timeLimitMinutes: 10, passPercent: 60, maxViolations: 2, questions: [] })).rejects.toBeInstanceOf(ValidationError)

    // Starting needs consent and the entire screen.
    await expect(assessmentService.start(intern, { assessmentId: assessment.id, consent: false }, meta)).rejects.toBeInstanceOf(ValidationError)
    await expect(assessmentService.start(intern, { assessmentId: assessment.id, consent: true, screenSurface: 'browser' }, meta)).rejects.toBeInstanceOf(ValidationError)
    await expect(assessmentService.start(mentor, { assessmentId: assessment.id, consent: true, screenSurface: 'monitor' }, meta)).rejects.toBeInstanceOf(ForbiddenError)
    const state = await assessmentService.start(intern, { assessmentId: assessment.id, consent: true, screenSurface: 'monitor' }, meta)
    expect(state.questions).toHaveLength(3)
    expect(JSON.stringify(state.questions)).not.toContain('correct')
    expect(new Date(state.deadlineAt).getTime() - Date.now()).toBeGreaterThan(9 * 60_000)
    expect(state.nextSequence).toEqual({ camera: 0, screen: 0 })
    const attemptId = state.attemptId

    // Answers, proctoring events (one violation) and recording chunks.
    const [q1, q2, q3] = state.questions
    await assessmentService.saveAnswers(intern, {
      attemptId,
      answers: [
        { questionId: q1.id, choice: 0 },
        { questionId: q2.id, choice: 3 },
        { questionId: q3.id, text: 'Top left, so it reads first after the headline.' },
      ],
    })
    const now = new Date().toISOString()
    expect(await assessmentService.recordEvents(intern, { attemptId, events: [{ type: 'TAB_HIDDEN', at: now }, { type: 'PASTE_BLOCKED', at: now }] })).toEqual({ violations: 1, submitted: false })
    const chunk = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3])
    await assessmentService.uploadChunk(intern, { attemptId, stream: 'camera', sequence: 0, bytes: chunk })
    await assessmentService.uploadChunk(intern, { attemptId, stream: 'screen', sequence: 0, bytes: chunk })
    await expect(assessmentService.uploadChunk(intern, { attemptId, stream: 'camera', sequence: 0, bytes: chunk })).rejects.toBeInstanceOf(ConflictError)
    await expect(assessmentService.uploadChunk(mentor, { attemptId, stream: 'camera', sequence: 1, bytes: chunk })).rejects.toBeInstanceOf(ForbiddenError)
    // A reopened page records into the next segment.
    expect((await assessmentService.attemptState(intern, attemptId)).nextSequence).toEqual({ camera: 10_000, screen: 10_000 })

    await assessmentService.submit(intern, attemptId)
    const submitted = await prisma.taskAssessment.findUniqueOrThrow({ where: { id: assessment.id } })
    expect(submitted.status).toBe('SUBMITTED')
    // Multiple choice is marked; AI suggested points for the short answer (not final).
    const answers = await prisma.assessmentAnswer.findMany({ where: { attempt_id: attemptId }, include: { question: true } })
    const byPosition = new Map(answers.map((a) => [a.question.position, a]))
    expect(byPosition.get(0)!.points).toBe(1)
    expect(byPosition.get(1)!.points).toBe(0)
    expect(byPosition.get(2)).toMatchObject({ ai_points: 3, points: null })
    expect(await prisma.notification.count({ where: { user_id: mentor.actor.userId, type: NOTIFICATION_TYPES.ASSESSMENT_SUBMITTED, related_entity_id: assessment.id } })).toBe(1)
    await expect(assessmentService.saveAnswers(intern, { attemptId, answers: [{ questionId: q1.id, choice: 1 }] })).rejects.toThrow()

    // The reviewer's view: integrity, timeline, recordings (viewing is audited). The intern can't watch them.
    const graded = await assessmentService.get(mentor, assessment.id)
    expect(graded.integrity!.score).toBeLessThan(100)
    expect(graded.integrity!.reasons.join(' ')).toMatch(/Switched away from the tab/)
    expect(graded.timeline.map((e) => e.type)).toEqual(expect.arrayContaining(['STARTED', 'TAB_HIDDEN', 'PASTE_BLOCKED', 'SUBMITTED']))
    expect(graded.segments).toEqual([
      { stream: 'CAMERA', segment: 0, seconds: 10, deleted: false },
      { stream: 'SCREEN', segment: 0, seconds: 10, deleted: false },
    ])
    expect(await assessmentService.recordingChunks(mentor, attemptId, 'camera', 0)).toHaveLength(1)
    expect(await prisma.auditLog.count({ where: { resource_id: assessment.id, action: AUDIT_ACTIONS.ASSESSMENT_RECORDING_VIEWED } })).toBe(1)
    await expect(assessmentService.recordingChunks(intern, attemptId, 'camera', 0)).rejects.toBeInstanceOf(ForbiddenError)

    // Grade: 1 + 0 + 2 of 6 = 50% — not passed, so the task still can't be approved.
    const shortAnswer = byPosition.get(2)!
    await expect(assessmentService.grade(mentor, { assessmentId: assessment.id, points: {} })).rejects.toBeInstanceOf(ValidationError)
    expect(await assessmentService.grade(mentor, { assessmentId: assessment.id, points: { [shortAnswer.id]: 2 } })).toEqual({ percent: 50, passed: false })
    await expect(taskSubmissionService.review(manager, { taskId, decision: 'APPROVE' })).rejects.toThrow(/didn’t pass/)
    // Regraded at 3 of 4: 4 of 6 = 67% — passed.
    expect(await assessmentService.grade(mentor, { assessmentId: assessment.id, points: { [shortAnswer.id]: 3 } })).toEqual({ percent: 67, passed: true })
    expect((await assessmentService.get(intern, assessment.id)).attempt!.answers).toHaveLength(3)
    expect(await prisma.notification.count({ where: { user_id: intern.actor.userId, type: NOTIFICATION_TYPES.ASSESSMENT_GRADED, related_entity_id: assessment.id } })).toBe(2)

    await taskSubmissionService.review(manager, { taskId, decision: 'APPROVE' })
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe('COMPLETED')
  })

  it('without AI the reviewer writes the questions; too many violations submit the attempt automatically', async () => {
    setAIProviderForTesting(null)
    const { assessment } = await submittedTask()
    expect(assessment).toMatchObject({ status: 'AWAITING_APPROVAL', source: 'MANUAL' })
    expect(assessment.generation_error).toMatch(/write the questions yourself/)
    await expect(assessmentService.approve(mentor, assessment.id)).rejects.toThrow(/at least one question/)
    await assessmentService.saveQuestions(mentor, {
      assessmentId: assessment.id,
      timeLimitMinutes: 5,
      passPercent: 50,
      maxViolations: 1,
      questions: [{ kind: 'MULTIPLE_CHOICE', prompt: 'Which file format did you deliver?', options: ['PNG', 'PDF'], correct: 0, points: 1 }],
    })
    await assessmentService.approve(mentor, assessment.id)
    const { attemptId } = await assessmentService.start(intern, { assessmentId: assessment.id, consent: true, screenSurface: 'monitor' }, meta)
    const at = new Date().toISOString()
    expect(await assessmentService.recordEvents(intern, { attemptId, events: [{ type: 'FULLSCREEN_EXIT', at }] })).toEqual({ violations: 1, submitted: false })
    expect(await assessmentService.recordEvents(intern, { attemptId, events: [{ type: 'SCREEN_SHARE_STOPPED', at }] })).toEqual({ violations: 2, submitted: true })
    const attempt = await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: attemptId } })
    expect(attempt).toMatchObject({ auto_submitted: true, submit_reason: 'Too many violations (2)' })
    await expect(assessmentService.start(intern, { assessmentId: assessment.id, consent: true, screenSurface: 'monitor' }, meta)).rejects.toBeInstanceOf(ConflictError)
  })

  it('a resubmission supersedes the open assessment; waiving needs a reason; maintenance closes overdue attempts and deletes old recordings', async () => {
    setAIProviderForTesting(null)
    const { taskId, assessment: first } = await submittedTask()
    await taskSubmissionService.review(manager, { taskId, decision: 'REQUEST_CHANGES', comment: 'Bigger logo.' })
    await taskLifecycleService.transitionStatus(intern, { taskId, to: 'IN_PROGRESS' })
    await taskSubmissionService.submit(intern, { taskId, message: 'Logo enlarged.' })
    expect((await prisma.taskAssessment.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('CANCELLED')
    const second = await prisma.taskAssessment.findFirstOrThrow({ where: { task_id: taskId, status: { not: 'CANCELLED' } } })
    expect(second.id).not.toBe(first.id)

    // Overdue attempt + an old recording.
    await assessmentService.saveQuestions(mentor, {
      assessmentId: second.id,
      timeLimitMinutes: 5,
      passPercent: 50,
      maxViolations: 3,
      questions: [{ kind: 'SHORT_ANSWER', prompt: 'What changed in this version?', points: 2 }],
    })
    await assessmentService.approve(mentor, second.id)
    const { attemptId } = await assessmentService.start(intern, { assessmentId: second.id, consent: true, screenSurface: 'monitor' }, meta)
    await assessmentService.uploadChunk(intern, { attemptId, stream: 'camera', sequence: 0, bytes: new Uint8Array([1, 2, 3]) })
    const later = new Date(Date.now() + 40 * 86_400_000)
    const result = await assessmentJobs.maintenance(later)
    expect(result.autoSubmitted).toBeGreaterThanOrEqual(1)
    expect(result.recordingsDeleted).toBeGreaterThanOrEqual(1)
    expect(await prisma.assessmentAttempt.findUniqueOrThrow({ where: { id: attemptId } })).toMatchObject({ auto_submitted: true, submit_reason: 'Time ran out' })
    expect((await assessmentService.get(mentor, second.id)).segments[0]).toMatchObject({ stream: 'CAMERA', deleted: true })
    await expect(assessmentService.recordingChunks(mentor, attemptId, 'camera', 0)).resolves.toHaveLength(0)

    // Waive (with a reason); then the task can be approved.
    await expect(assessmentService.waive(mentor, { assessmentId: second.id, reason: '' })).rejects.toBeInstanceOf(ValidationError)
    await assessmentService.waive(mentor, { assessmentId: second.id, reason: 'Reviewed the work in a call instead.' })
    expect(await prisma.auditLog.count({ where: { resource_id: second.id, action: AUDIT_ACTIONS.ASSESSMENT_WAIVED } })).toBe(1)
    await taskSubmissionService.review(manager, { taskId, decision: 'APPROVE' })
  })

  it('keeps assessments inside their scope', async () => {
    setAIProviderForTesting(null)
    const { assessment } = await submittedTask()
    // HR sees every assessment; a mentor who isn't hers and another intern see none of Aanya's.
    await expect(assessmentService.get(await contextFor('mentor@ayavacreatives.com'), assessment.id)).rejects.toBeInstanceOf(NotFoundError)
    expect((await assessmentService.list(hr)).toApprove.some((a) => a.id === assessment.id)).toBe(true)
    expect((await assessmentService.list(intern)).myResults.some((a) => a.id === assessment.id)).toBe(true)
    const ishaan = await contextFor('ishaan.verma@demo.ayavacreatives.com')
    await expect(assessmentService.get(ishaan, assessment.id)).rejects.toBeInstanceOf(NotFoundError)
    expect((await assessmentService.list(ishaan)).myResults.some((a) => a.id === assessment.id)).toBe(false)
    await expect(assessmentService.forTask(intern, assessment.task_id)).resolves.toMatchObject({ id: assessment.id })
  })
})
