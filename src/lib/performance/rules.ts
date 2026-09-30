import type {
  CheckinStatus,
  FeedbackContextType,
  FeedbackType,
  FeedbackVisibility,
  GoalCategory,
  GoalStatus,
  PerformanceReviewStatus,
  ReviewRespondent,
} from '@prisma/client'

/**
 * Performance rules (pure). Nothing here produces a score: goals move in
 * explicit 25% steps, reviews are structured answers from named people, and
 * every rating comes with the rubric below.
 */

// ── Goals ────────────────────────────────────────────────────────────────────

export const GOAL_CATEGORY_LABELS: Record<GoalCategory, string> = {
  TECHNICAL: 'Technical',
  COMMUNICATION: 'Communication',
  PROJECT: 'Project',
  LEARNING: 'Learning',
  LEADERSHIP: 'Leadership',
  PROCESS: 'Process',
  OTHER: 'Other',
}

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  AT_RISK: 'At risk',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

export const GOAL_PROGRESS_STEPS = [0, 25, 50, 75, 100] as const

const GOAL_TRANSITIONS: Record<GoalStatus, readonly GoalStatus[]> = {
  NOT_STARTED: ['IN_PROGRESS', 'AT_RISK', 'CANCELLED'],
  IN_PROGRESS: ['AT_RISK', 'COMPLETED', 'CANCELLED'],
  AT_RISK: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  COMPLETED: ['IN_PROGRESS'],
  CANCELLED: ['NOT_STARTED'],
}

export function canMoveGoal(from: GoalStatus, to: GoalStatus) {
  return from === to || GOAL_TRANSITIONS[from].includes(to)
}

/**
 * Progress and status stay consistent: completing sets 100%; 100% is only
 * possible when completing; reopening a completed goal drops it to 75%.
 */
export function reconcileGoal(input: { from: GoalStatus; to: GoalStatus; progress: number }) {
  if (input.to === 'COMPLETED') return { status: input.to, progress: 100 }
  if (input.from === 'COMPLETED' && input.progress === 100) return { status: input.to, progress: 75 }
  if (input.progress === 100) return { status: input.to, progress: 75 }
  if (input.to === 'IN_PROGRESS' && input.progress === 0) return { status: input.to, progress: 25 }
  return { status: input.to, progress: input.progress }
}

// ── Check-ins ────────────────────────────────────────────────────────────────

export const CHECKIN_STATUS_LABELS: Record<CheckinStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  REVIEWED: 'Reviewed',
}

export const CHECKIN_QUESTIONS = [
  { key: 'accomplishments', label: 'What did you accomplish this week?' },
  { key: 'current_work', label: 'What are you currently working on?' },
  { key: 'learning', label: 'What did you learn?' },
  { key: 'blockers', label: 'What challenges or blockers did you face?' },
  { key: 'support_needed', label: 'What support do you need?' },
  { key: 'next_week_priorities', label: 'What are your priorities for next week?' },
] as const

export type CheckinField = (typeof CHECKIN_QUESTIONS)[number]['key']

/** Monday of the week containing `date` (UTC calendar date). */
export function weekStart(date: Date): Date {
  const day = (date.getUTCDay() + 6) % 7 // Monday = 0
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day))
}

/** Interns edit drafts only; once submitted a check-in is part of the record (reviewers add comments). */
export function canEditCheckin(status: CheckinStatus) {
  return status === 'DRAFT'
}

// ── Feedback ─────────────────────────────────────────────────────────────────

export const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  POSITIVE: 'Positive',
  DEVELOPMENTAL: 'Developmental',
  GENERAL: 'General',
}

export const FEEDBACK_CONTEXT_LABELS: Record<FeedbackContextType, string> = {
  TASK: 'Task',
  PROJECT: 'Project',
  LEARNING: 'Learning',
  GOAL: 'Goal',
  WEEKLY_CHECKIN: 'Weekly check-in',
  GENERAL: 'General',
}

export const FEEDBACK_VISIBILITY_LABELS: Record<FeedbackVisibility, string> = {
  PRIVATE: 'Private note (only you)',
  SHARED_WITH_INTERN: 'Shared with the intern',
  SHARED_WITH_MANAGER: 'Shared with the manager (not the intern)',
  HR_ONLY: 'HR only',
}

export interface FeedbackViewer {
  userId: string
  /** The intern the feedback is about (to_user). */
  isRecipient: boolean
  isInternManager: boolean
  isInternMentor: boolean
  /** feedback.read at organization scope (HR/Admin). */
  orgWide: boolean
}

/**
 * Who sees a piece of feedback (checked on the server for every read):
 *  - the author always;
 *  - PRIVATE: nobody else;
 *  - SHARED_WITH_INTERN: the intern, their manager and mentor, HR;
 *  - SHARED_WITH_MANAGER: the intern's manager and HR (not the intern or mentor);
 *  - HR_ONLY: HR.
 */
export function canViewFeedback(
  feedback: { visibility: FeedbackVisibility; from_user_id: string },
  viewer: FeedbackViewer,
): boolean {
  if (feedback.from_user_id === viewer.userId) return true
  switch (feedback.visibility) {
    case 'PRIVATE':
      return false
    case 'SHARED_WITH_INTERN':
      return viewer.isRecipient || viewer.isInternManager || viewer.isInternMentor || viewer.orgWide
    case 'SHARED_WITH_MANAGER':
      return viewer.isInternManager || viewer.orgWide
    case 'HR_ONLY':
      return viewer.orgWide
  }
}

// ── Reviews ──────────────────────────────────────────────────────────────────

export const RATING_SCALE = [
  { value: 1, label: 'Needs significant development', criteria: 'Rarely meets the expectations for this area yet; needs close guidance.' },
  { value: 2, label: 'Developing', criteria: 'Meets some expectations; improving with regular guidance.' },
  { value: 3, label: 'Meets expectations', criteria: 'Consistently meets what is expected of an intern at this stage.' },
  { value: 4, label: 'Exceeds expectations', criteria: 'Often goes beyond what is expected, with little guidance.' },
  { value: 5, label: 'Exceptional', criteria: 'Consistently well beyond expectations; a model for others in this area.' },
] as const

export const REVIEW_STATUS_LABELS: Partial<Record<PerformanceReviewStatus, string>> = {
  DRAFT: 'Not started',
  SELF_REVIEW: 'Self-review',
  MANAGER_REVIEW: 'Manager review',
  MENTOR_REVIEW: 'Mentor review',
  HR_REVIEW: 'HR review',
  COMPLETED: 'Completed',
}

export const RESPONDENT_LABELS: Record<ReviewRespondent, string> = {
  SELF: 'Self-review',
  MANAGER: 'Manager',
  MENTOR: 'Mentor',
  HR: 'HR',
}

export type ReviewStage = 'SELF_REVIEW' | 'MANAGER_REVIEW' | 'MENTOR_REVIEW' | 'HR_REVIEW'

const STAGE_RESPONDENT: Record<ReviewStage, ReviewRespondent> = {
  SELF_REVIEW: 'SELF',
  MANAGER_REVIEW: 'MANAGER',
  MENTOR_REVIEW: 'MENTOR',
  HR_REVIEW: 'HR',
}

export interface StageConfig {
  self: boolean
  mentor: boolean
  hr: boolean
  hasMentor: boolean
}

/** The stages this review goes through, in order (manager review is always required). */
export function reviewStages(config: StageConfig): ReviewStage[] {
  return [
    ...(config.self ? (['SELF_REVIEW'] as const) : []),
    'MANAGER_REVIEW' as const,
    ...(config.mentor && config.hasMentor ? (['MENTOR_REVIEW'] as const) : []),
    ...(config.hr ? (['HR_REVIEW'] as const) : []),
  ]
}

export function firstStage(config: StageConfig): ReviewStage {
  return reviewStages(config)[0]
}

/** The stage after `current`, or COMPLETED. */
export function nextStage(current: ReviewStage, config: StageConfig): ReviewStage | 'COMPLETED' {
  const stages = reviewStages(config)
  const index = stages.indexOf(current)
  return stages[index + 1] ?? 'COMPLETED'
}

export function respondentForStage(stage: PerformanceReviewStatus): ReviewRespondent | null {
  return (STAGE_RESPONDENT as Record<string, ReviewRespondent>)[stage] ?? null
}

export interface ReviewViewer {
  isSelf: boolean
  isManager: boolean
  isMentor: boolean
  /** performance.review at organization scope (HR/Admin). */
  isHr: boolean
}

/**
 * Which answers a viewer may see. Self-review stays distinguishable and is
 * shared with manager/mentor only once submitted; manager and mentor answers
 * reach the intern when the review is completed; HR notes stay with HR.
 */
export function canSeeAnswers(
  respondent: ReviewRespondent,
  viewer: ReviewViewer,
  review: { status: PerformanceReviewStatus; stage_submitted: readonly ReviewRespondent[] },
): boolean {
  if (viewer.isHr) return true
  const completed = review.status === 'COMPLETED'
  const submitted = review.stage_submitted.includes(respondent)
  switch (respondent) {
    case 'SELF':
      return viewer.isSelf || ((viewer.isManager || viewer.isMentor) && submitted)
    case 'MANAGER':
      return viewer.isManager || (viewer.isSelf && completed)
    case 'MENTOR':
      return viewer.isMentor || (viewer.isManager && submitted) || (viewer.isSelf && completed)
    case 'HR':
      return false
  }
}

/** Which respondent (if any) this viewer writes as, at the review's current stage. */
export function respondentFor(viewer: ReviewViewer, status: PerformanceReviewStatus): ReviewRespondent | null {
  const respondent = respondentForStage(status)
  if (!respondent) return null
  if (respondent === 'SELF' && viewer.isSelf) return respondent
  if (respondent === 'MANAGER' && viewer.isManager) return respondent
  if (respondent === 'MENTOR' && viewer.isMentor) return respondent
  if (respondent === 'HR' && viewer.isHr && !viewer.isSelf) return respondent
  return null
}

export interface AnswerValue {
  rating?: number | null
  text?: string | null
  bool?: boolean | null
  selected?: readonly string[]
  evidence?: string | null
}

/** Validates one answer against its question (types, rating range, options, required evidence). */
export function validateReviewAnswer(
  question: { question_type: 'TEXT' | 'RATING' | 'BOOLEAN' | 'MULTI_SELECT'; options: readonly string[]; is_required: boolean; requires_evidence: boolean },
  value: AnswerValue,
  final: boolean,
): string | null {
  const empty =
    (question.question_type === 'TEXT' && !value.text?.trim()) ||
    (question.question_type === 'RATING' && !value.rating) ||
    (question.question_type === 'BOOLEAN' && (value.bool === null || value.bool === undefined)) ||
    (question.question_type === 'MULTI_SELECT' && !value.selected?.length)
  if (value.rating !== null && value.rating !== undefined && (value.rating < 1 || value.rating > 5 || !Number.isInteger(value.rating))) {
    return 'Ratings use the 1–5 scale'
  }
  if (value.selected?.some((s) => !question.options.includes(s))) return 'Choose from the listed options'
  if (final && question.is_required && empty) return 'Required'
  if (final && question.requires_evidence && !empty && !value.evidence?.trim()) return 'Add the evidence for this answer'
  return null
}
