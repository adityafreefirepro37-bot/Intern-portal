import {
  canEditCheckin,
  canMoveGoal,
  canSeeAnswers,
  canViewFeedback,
  firstStage,
  nextStage,
  reconcileGoal,
  respondentFor,
  reviewStages,
  validateReviewAnswer,
  weekStart,
  type ReviewViewer,
} from '@/lib/performance/rules'

describe('goals', () => {
  it('moves through allowed statuses only', () => {
    expect(canMoveGoal('NOT_STARTED', 'IN_PROGRESS')).toBe(true)
    expect(canMoveGoal('NOT_STARTED', 'COMPLETED')).toBe(false)
    expect(canMoveGoal('COMPLETED', 'IN_PROGRESS')).toBe(true)
    expect(canMoveGoal('CANCELLED', 'IN_PROGRESS')).toBe(false)
  })

  it('keeps progress consistent with status', () => {
    expect(reconcileGoal({ from: 'IN_PROGRESS', to: 'COMPLETED', progress: 50 })).toEqual({ status: 'COMPLETED', progress: 100 })
    expect(reconcileGoal({ from: 'IN_PROGRESS', to: 'IN_PROGRESS', progress: 100 })).toEqual({ status: 'IN_PROGRESS', progress: 75 })
    expect(reconcileGoal({ from: 'NOT_STARTED', to: 'IN_PROGRESS', progress: 0 })).toEqual({ status: 'IN_PROGRESS', progress: 25 })
  })
})

describe('check-ins', () => {
  it('uses Monday-start weeks', () => {
    expect(weekStart(new Date('2026-10-03T00:00:00Z'))).toEqual(new Date('2026-09-28T00:00:00Z')) // Saturday
    expect(weekStart(new Date('2026-10-05T00:00:00Z'))).toEqual(new Date('2026-10-05T00:00:00Z')) // Monday
    expect(weekStart(new Date('2026-10-04T00:00:00Z'))).toEqual(new Date('2026-09-28T00:00:00Z')) // Sunday
  })
  it('only drafts are editable', () => {
    expect(canEditCheckin('DRAFT')).toBe(true)
    expect(canEditCheckin('SUBMITTED')).toBe(false)
    expect(canEditCheckin('REVIEWED')).toBe(false)
  })
})

describe('feedback visibility', () => {
  const viewer = (overrides: Partial<Parameters<typeof canViewFeedback>[1]> = {}) => ({
    userId: 'viewer',
    isRecipient: false,
    isInternManager: false,
    isInternMentor: false,
    orgWide: false,
    ...overrides,
  })
  const fb = (visibility: 'PRIVATE' | 'SHARED_WITH_INTERN' | 'SHARED_WITH_MANAGER' | 'HR_ONLY') => ({ visibility, from_user_id: 'author' })

  it('authors always see what they wrote', () => {
    for (const v of ['PRIVATE', 'SHARED_WITH_INTERN', 'SHARED_WITH_MANAGER', 'HR_ONLY'] as const) {
      expect(canViewFeedback(fb(v), viewer({ userId: 'author' }))).toBe(true)
    }
  })

  it('applies the visibility matrix', () => {
    expect(canViewFeedback(fb('PRIVATE'), viewer({ orgWide: true }))).toBe(false)
    expect(canViewFeedback(fb('SHARED_WITH_INTERN'), viewer({ isRecipient: true }))).toBe(true)
    expect(canViewFeedback(fb('SHARED_WITH_INTERN'), viewer({ isInternMentor: true }))).toBe(true)
    expect(canViewFeedback(fb('SHARED_WITH_MANAGER'), viewer({ isRecipient: true }))).toBe(false)
    expect(canViewFeedback(fb('SHARED_WITH_MANAGER'), viewer({ isInternMentor: true }))).toBe(false)
    expect(canViewFeedback(fb('SHARED_WITH_MANAGER'), viewer({ isInternManager: true }))).toBe(true)
    expect(canViewFeedback(fb('HR_ONLY'), viewer({ isInternManager: true }))).toBe(false)
    expect(canViewFeedback(fb('HR_ONLY'), viewer({ orgWide: true }))).toBe(true)
    expect(canViewFeedback(fb('SHARED_WITH_INTERN'), viewer())).toBe(false)
  })
})

describe('review workflow', () => {
  const all = { self: true, mentor: true, hr: true, hasMentor: true }

  it('builds the configured stages in order', () => {
    expect(reviewStages(all)).toEqual(['SELF_REVIEW', 'MANAGER_REVIEW', 'MENTOR_REVIEW', 'HR_REVIEW'])
    expect(reviewStages({ ...all, hasMentor: false })).toEqual(['SELF_REVIEW', 'MANAGER_REVIEW', 'HR_REVIEW'])
    expect(reviewStages({ self: false, mentor: false, hr: false, hasMentor: true })).toEqual(['MANAGER_REVIEW'])
    expect(firstStage({ ...all, self: false })).toBe('MANAGER_REVIEW')
    expect(nextStage('MANAGER_REVIEW', all)).toBe('MENTOR_REVIEW')
    expect(nextStage('HR_REVIEW', all)).toBe('COMPLETED')
    expect(nextStage('MANAGER_REVIEW', { ...all, mentor: false, hr: false })).toBe('COMPLETED')
  })

  const as = (v: Partial<ReviewViewer>): ReviewViewer => ({ isSelf: false, isManager: false, isMentor: false, isHr: false, ...v })

  it('keeps self-review private until submitted and other answers private until completed', () => {
    const open = { status: 'SELF_REVIEW' as const, stage_submitted: [] }
    const managerStage = { status: 'MANAGER_REVIEW' as const, stage_submitted: ['SELF' as const] }
    const done = { status: 'COMPLETED' as const, stage_submitted: ['SELF' as const, 'MANAGER' as const, 'MENTOR' as const, 'HR' as const] }
    expect(canSeeAnswers('SELF', as({ isManager: true }), open)).toBe(false)
    expect(canSeeAnswers('SELF', as({ isManager: true }), managerStage)).toBe(true)
    expect(canSeeAnswers('MANAGER', as({ isSelf: true }), managerStage)).toBe(false)
    expect(canSeeAnswers('MANAGER', as({ isSelf: true }), done)).toBe(true)
    expect(canSeeAnswers('MENTOR', as({ isManager: true }), managerStage)).toBe(false)
    expect(canSeeAnswers('HR', as({ isSelf: true, isManager: true }), done)).toBe(false)
    expect(canSeeAnswers('HR', as({ isHr: true }), done)).toBe(true)
  })

  it('lets only the current stage’s respondent write', () => {
    expect(respondentFor(as({ isSelf: true }), 'SELF_REVIEW')).toBe('SELF')
    expect(respondentFor(as({ isManager: true }), 'SELF_REVIEW')).toBeNull()
    expect(respondentFor(as({ isMentor: true }), 'MENTOR_REVIEW')).toBe('MENTOR')
    // HR can't write the HR stage of their own review.
    expect(respondentFor(as({ isHr: true, isSelf: true }), 'HR_REVIEW')).toBeNull()
    expect(respondentFor(as({ isHr: true }), 'COMPLETED')).toBeNull()
  })

  it('validates answers against the question and the 1–5 scale', () => {
    const rating = { question_type: 'RATING' as const, options: [], is_required: true, requires_evidence: true }
    expect(validateReviewAnswer(rating, { rating: 6 }, false)).toMatch(/1–5/)
    expect(validateReviewAnswer(rating, {}, false)).toBeNull()
    expect(validateReviewAnswer(rating, {}, true)).toBe('Required')
    expect(validateReviewAnswer(rating, { rating: 4 }, true)).toMatch(/evidence/)
    expect(validateReviewAnswer(rating, { rating: 4, evidence: 'Task X' }, true)).toBeNull()
    const multi = { question_type: 'MULTI_SELECT' as const, options: ['A', 'B'], is_required: false, requires_evidence: false }
    expect(validateReviewAnswer(multi, { selected: ['C'] }, false)).toMatch(/options/)
  })
})
