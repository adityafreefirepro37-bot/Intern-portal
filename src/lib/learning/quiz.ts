import type { QuizAnswerPolicy, QuizQuestionType } from '@prisma/client'

/**
 * Quiz scoring (pure, server-side only). The browser never receives correct
 * answers before submission and never sends a score — it sends choices, and
 * the server grades them here.
 */

export const QUESTION_TYPE_LABELS: Record<QuizQuestionType, string> = {
  MULTIPLE_CHOICE: 'Multiple choice',
  TRUE_FALSE: 'True / false',
  SHORT_ANSWER: 'Short answer',
}

export const ANSWER_POLICY_LABELS: Record<QuizAnswerPolicy, string> = {
  NEVER: 'Never show correct answers',
  AFTER_SUBMISSION: 'Show correct answers after each attempt',
  AFTER_PASS: 'Show correct answers once passed',
}

export interface GradableQuestion {
  id: string
  question_type: QuizQuestionType
  points: number
  options: readonly { id: string; is_correct: boolean }[]
  accepted_answers: readonly string[]
}

export interface SubmittedAnswer {
  questionId: string
  selectedOptionIds: readonly string[]
  text: string | null
}

/** Normalizes free text for comparison: trimmed, lower-case, single spaces. */
export function normalizeAnswer(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Choice questions are correct only when the selected set equals the correct
 * set exactly (so multi-answer questions can't be gamed by ticking everything).
 * Short answers match any accepted answer after normalization.
 */
export function gradeQuestion(question: GradableQuestion, answer: SubmittedAnswer | undefined) {
  if (!answer) return { correct: false, points: 0 }
  if (question.question_type === 'SHORT_ANSWER') {
    const given = normalizeAnswer(answer.text ?? '')
    const correct = given.length > 0 && question.accepted_answers.some((a) => normalizeAnswer(a) === given)
    return { correct, points: correct ? question.points : 0 }
  }
  const valid = new Set(question.options.map((o) => o.id))
  const selected = new Set(answer.selectedOptionIds.filter((id) => valid.has(id)))
  const expected = new Set(question.options.filter((o) => o.is_correct).map((o) => o.id))
  const correct = expected.size > 0 && selected.size === expected.size && [...expected].every((id) => selected.has(id))
  return { correct, points: correct ? question.points : 0 }
}

export function gradeAttempt(
  questions: readonly GradableQuestion[],
  answers: readonly SubmittedAnswer[],
  passingPercentage: number,
) {
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]))
  const results = questions.map((q) => ({ questionId: q.id, ...gradeQuestion(q, byQuestion.get(q.id)) }))
  const score = results.reduce((sum, r) => sum + r.points, 0)
  const maxScore = questions.reduce((sum, q) => sum + q.points, 0)
  const percentage = maxScore === 0 ? 0 : Math.floor((score / maxScore) * 100)
  return {
    results,
    score,
    maxScore,
    percentage,
    passed: maxScore > 0 && percentage >= passingPercentage,
    correctCount: results.filter((r) => r.correct).length,
    incorrectCount: results.filter((r) => !r.correct).length,
  }
}

/** Whether a new attempt may start. */
export function canStartAttempt(input: { attemptLimit: number | null; submitted: number; alreadyPassed: boolean }) {
  if (input.attemptLimit !== null && input.submitted >= input.attemptLimit) {
    return { ok: false as const, reason: `All ${input.attemptLimit} attempts have been used` }
  }
  return { ok: true as const, retake: input.alreadyPassed }
}

/** Timed attempts expire after the limit (with a short grace period for network latency). */
export function isAttemptExpired(startedAt: Date, timeLimitMinutes: number | null, now: Date, graceSeconds = 30) {
  if (!timeLimitMinutes) return false
  return now.getTime() > startedAt.getTime() + timeLimitMinutes * 60_000 + graceSeconds * 1000
}

/** Whether correct answers may be shown after this attempt. */
export function mayRevealAnswers(policy: QuizAnswerPolicy, passed: boolean) {
  return policy === 'AFTER_SUBMISSION' || (policy === 'AFTER_PASS' && passed)
}

/** Structural checks for authoring (the server validates before saving a question). */
export function validateQuestionShape(input: {
  type: QuizQuestionType
  options: readonly { text: string; correct: boolean }[]
  acceptedAnswers: readonly string[]
}): string | null {
  if (input.type === 'SHORT_ANSWER') {
    return input.acceptedAnswers.some((a) => a.trim()) ? null : 'Add at least one accepted answer'
  }
  const options = input.options.filter((o) => o.text.trim())
  if (input.type === 'TRUE_FALSE' && options.length !== 2) return 'True / false questions have exactly two options'
  if (options.length < 2) return 'Add at least two options'
  if (!options.some((o) => o.correct)) return 'Mark at least one correct option'
  return null
}
