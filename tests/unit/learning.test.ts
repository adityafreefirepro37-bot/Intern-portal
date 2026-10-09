import { isSafeResourceUrl, parseLessonText } from '@/lib/learning/content'
import {
  canStartAttempt,
  gradeAttempt,
  gradeQuestion,
  isAttemptExpired,
  mayRevealAnswers,
  normalizeAnswer,
  validateQuestionShape,
  type GradableQuestion,
} from '@/lib/learning/quiz'
import {
  buildPlanItems,
  effectiveEnrollmentStatus,
  evaluateCompletion,
  formatMinutes,
  isBlockedByPrerequisite,
  isLessonLocked,
  learningDeadline,
  slugify,
} from '@/lib/learning/rules'

const day = (iso: string) => new Date(`${iso}T00:00:00Z`)

describe('course completion rule', () => {
  const base = {
    lessons: [
      { id: 'l1', required: true },
      { id: 'l2', required: true },
      { id: 'l3', required: false },
    ],
    quizzes: [{ id: 'q1', required: true }],
    assignments: [{ id: 'a1', required: true }],
    completedLessonIds: new Set<string>(),
    passedQuizIds: new Set<string>(),
    approvedAssignmentIds: new Set<string>(),
    requireQuizzes: true,
    requireAssignments: true,
  }

  it('needs every required lesson, passed quiz and approved assignment', () => {
    const partial = evaluateCompletion({ ...base, completedLessonIds: new Set(['l1', 'l2']), passedQuizIds: new Set(['q1']) })
    expect(partial).toMatchObject({ complete: false, progress: 75, remaining: { lessons: 0, quizzes: 0, assignments: 1 } })
    const done = evaluateCompletion({
      ...base,
      completedLessonIds: new Set(['l1', 'l2']),
      passedQuizIds: new Set(['q1']),
      approvedAssignmentIds: new Set(['a1']),
    })
    expect(done).toMatchObject({ complete: true, progress: 100 })
  })

  it('ignores optional lessons and items the course does not require', () => {
    const result = evaluateCompletion({ ...base, requireQuizzes: false, requireAssignments: false, completedLessonIds: new Set(['l1', 'l2']) })
    expect(result).toMatchObject({ complete: true, counted: 2 })
  })

  it('never completes a course with nothing required', () => {
    expect(evaluateCompletion({ ...base, lessons: [], quizzes: [], assignments: [] }).complete).toBe(false)
  })

  it('does not count an attempt that failed or an assignment awaiting review', () => {
    const result = evaluateCompletion({ ...base, completedLessonIds: new Set(['l1', 'l2']) })
    expect(result.complete).toBe(false)
    expect(result.remaining.quizzes).toBe(1)
  })
})

describe('sequential lessons and plans', () => {
  const ordered = [
    { id: 'a', required: true },
    { id: 'b', required: false },
    { id: 'c', required: true },
  ]
  it('locks a lesson until earlier required lessons are done', () => {
    expect(isLessonLocked(true, ordered, new Set(), 'a')).toBe(false)
    expect(isLessonLocked(true, ordered, new Set(), 'c')).toBe(true)
    // Optional lessons don't block.
    expect(isLessonLocked(true, ordered, new Set(['a']), 'c')).toBe(false)
    expect(isLessonLocked(false, ordered, new Set(), 'c')).toBe(false)
  })

  it('builds plan snapshots with prerequisites and due dates', () => {
    const items = buildPlanItems(
      [
        { courseId: 'second', position: 1, required: true, requiresPrevious: true, dueDays: 14 },
        { courseId: 'first', position: 0, required: true, requiresPrevious: true, dueDays: 7 },
        { courseId: 'third', position: 2, required: false, requiresPrevious: false, dueDays: null },
      ],
      day('2026-10-01'),
      day('2026-12-01'),
    )
    expect(items.map((i) => i.courseId)).toEqual(['first', 'second', 'third'])
    expect(items[0].prerequisiteCourseId).toBeNull()
    expect(items[1].prerequisiteCourseId).toBe('first')
    expect(items[2].prerequisiteCourseId).toBeNull()
    expect(items[1].dueDate).toEqual(day('2026-10-15'))
    expect(items[2].dueDate).toEqual(day('2026-12-01'))
    expect(isBlockedByPrerequisite('first', new Set())).toBe(true)
    expect(isBlockedByPrerequisite('first', new Set(['first']))).toBe(false)
  })
})

describe('deadlines', () => {
  const today = day('2026-10-05')
  it('classifies due dates', () => {
    expect(learningDeadline(null, false, today)).toBe('NONE')
    expect(learningDeadline(day('2026-10-04'), false, today)).toBe('OVERDUE')
    expect(learningDeadline(day('2026-10-05'), false, today)).toBe('DUE_TODAY')
    expect(learningDeadline(day('2026-10-08'), false, today)).toBe('DUE_SOON')
    expect(learningDeadline(day('2026-10-09'), false, today)).toBe('UPCOMING')
    expect(learningDeadline(day('2026-10-01'), true, today)).toBe('COMPLETED')
  })
  it('derives OVERDUE without changing stored history', () => {
    expect(effectiveEnrollmentStatus('IN_PROGRESS', day('2026-10-01'), today)).toBe('OVERDUE')
    expect(effectiveEnrollmentStatus('COMPLETED', day('2026-10-01'), today)).toBe('COMPLETED')
    expect(effectiveEnrollmentStatus('NOT_STARTED', null, today)).toBe('NOT_STARTED')
  })
})

describe('quiz grading (server side)', () => {
  const choice: GradableQuestion = {
    id: 'q1',
    question_type: 'MULTIPLE_CHOICE',
    points: 2,
    options: [
      { id: 'o1', is_correct: true },
      { id: 'o2', is_correct: true },
      { id: 'o3', is_correct: false },
    ],
    accepted_answers: [],
  }
  const short: GradableQuestion = { id: 'q2', question_type: 'SHORT_ANSWER', points: 1, options: [], accepted_answers: ['Git Commit'] }

  it('requires the exact set of correct options (ticking everything fails)', () => {
    expect(gradeQuestion(choice, { questionId: 'q1', selectedOptionIds: ['o1', 'o2'], text: null })).toEqual({ correct: true, points: 2 })
    expect(gradeQuestion(choice, { questionId: 'q1', selectedOptionIds: ['o1', 'o2', 'o3'], text: null }).correct).toBe(false)
    expect(gradeQuestion(choice, { questionId: 'q1', selectedOptionIds: ['o1'], text: null }).correct).toBe(false)
  })

  it('ignores option ids that do not belong to the question', () => {
    expect(gradeQuestion(choice, { questionId: 'q1', selectedOptionIds: ['o1', 'o2', 'forged'], text: null }).correct).toBe(true)
  })

  it('normalizes short answers', () => {
    expect(normalizeAnswer('  Git   COMMIT ')).toBe('git commit')
    expect(gradeQuestion(short, { questionId: 'q2', selectedOptionIds: [], text: ' git  commit' }).correct).toBe(true)
    expect(gradeQuestion(short, { questionId: 'q2', selectedOptionIds: [], text: '' }).correct).toBe(false)
  })

  it('scores attempts from answers only (unanswered questions score zero)', () => {
    const result = gradeAttempt([choice, short], [{ questionId: 'q2', selectedOptionIds: [], text: 'git commit' }], 70)
    expect(result).toMatchObject({ score: 1, maxScore: 3, percentage: 33, passed: false, correctCount: 1, incorrectCount: 1 })
    const pass = gradeAttempt(
      [choice, short],
      [
        { questionId: 'q1', selectedOptionIds: ['o1', 'o2'], text: null },
        { questionId: 'q2', selectedOptionIds: [], text: 'git commit' },
      ],
      70,
    )
    expect(pass).toMatchObject({ percentage: 100, passed: true })
  })

  it('enforces attempt limits, time limits and the answer policy', () => {
    expect(canStartAttempt({ attemptLimit: 2, submitted: 2, alreadyPassed: false }).ok).toBe(false)
    expect(canStartAttempt({ attemptLimit: null, submitted: 9, alreadyPassed: true })).toEqual({ ok: true, retake: true })
    const start = new Date('2026-10-05T10:00:00Z')
    expect(isAttemptExpired(start, 10, new Date('2026-10-05T10:10:20Z'))).toBe(false)
    expect(isAttemptExpired(start, 10, new Date('2026-10-05T10:11:00Z'))).toBe(true)
    expect(isAttemptExpired(start, null, new Date('2027-01-01'))).toBe(false)
    expect(mayRevealAnswers('NEVER', true)).toBe(false)
    expect(mayRevealAnswers('AFTER_PASS', false)).toBe(false)
    expect(mayRevealAnswers('AFTER_PASS', true)).toBe(true)
    expect(mayRevealAnswers('AFTER_SUBMISSION', false)).toBe(true)
  })

  it('validates question shapes when authoring', () => {
    expect(validateQuestionShape({ type: 'SHORT_ANSWER', options: [], acceptedAnswers: [' '] })).toMatch(/accepted answer/)
    expect(validateQuestionShape({ type: 'MULTIPLE_CHOICE', options: [{ text: 'a', correct: false }, { text: 'b', correct: false }], acceptedAnswers: [] })).toMatch(/correct/)
    expect(validateQuestionShape({ type: 'TRUE_FALSE', options: [{ text: 'True', correct: true }, { text: 'False', correct: false }], acceptedAnswers: [] })).toBeNull()
  })
})

describe('lesson content safety', () => {
  it('parses text into headings, paragraphs and lists (never HTML)', () => {
    const blocks = parseLessonText('# Title\nFirst line\nsecond line\n\n- one\n- two\n<script>alert(1)</script>')
    expect(blocks).toEqual([
      { type: 'heading', text: 'Title' },
      { type: 'paragraph', text: 'First line second line' },
      { type: 'list', items: ['one', 'two'] },
      { type: 'paragraph', text: '<script>alert(1)</script>' },
    ])
  })

  it('accepts only https links without credentials', () => {
    expect(isSafeResourceUrl('https://docs.github.com/en')).toBe(true)
    expect(isSafeResourceUrl('http://example.com')).toBe(false)
    expect(isSafeResourceUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeResourceUrl('https://user:pass@example.com')).toBe(false)
    expect(isSafeResourceUrl('https://localhost')).toBe(false)
  })

  it('formats durations and slugs', () => {
    expect(formatMinutes(45)).toBe('45 min')
    expect(formatMinutes(80)).toBe('1 h 20 min')
    expect(formatMinutes(120)).toBe('2 h')
    expect(slugify('Git & GitHub Fundamentals!')).toBe('git-github-fundamentals')
  })
})
