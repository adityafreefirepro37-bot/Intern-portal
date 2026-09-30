import type { CourseDifficulty, EnrollmentStatus, EnrollmentType, LessonContentType } from '@prisma/client'

/** Learning rules (pure): course completion, lesson locking, deadlines, plans. */

export const DIFFICULTY_LABELS: Record<CourseDifficulty, string> = {
  BEGINNER: 'Beginner',
  INTERMEDIATE: 'Intermediate',
  ADVANCED: 'Advanced',
}

export const CONTENT_TYPE_LABELS: Record<LessonContentType, string> = {
  TEXT: 'Reading',
  VIDEO: 'Video',
  DOCUMENT: 'Document',
  LINK: 'Link',
  QUIZ: 'Quiz',
  ASSIGNMENT: 'Assignment',
}

export const ENROLLMENT_TYPE_LABELS: Record<EnrollmentType, string> = {
  SELF_ENROLLED: 'Self-enrolled',
  ASSIGNED: 'Assigned',
  REQUIRED: 'Required',
}

export type EffectiveEnrollmentStatus = EnrollmentStatus | 'OVERDUE'

export const ENROLLMENT_STATUS_LABELS: Record<EffectiveEnrollmentStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  OVERDUE: 'Overdue',
}

export interface CompletionInput {
  lessons: readonly { id: string; required: boolean }[]
  quizzes: readonly { id: string; required: boolean }[]
  assignments: readonly { id: string; required: boolean }[]
  completedLessonIds: ReadonlySet<string>
  passedQuizIds: ReadonlySet<string>
  approvedAssignmentIds: ReadonlySet<string>
  requireQuizzes: boolean
  requireAssignments: boolean
}

export interface CompletionResult {
  /** Done ÷ total of the items that count towards completion (whole percent). */
  progress: number
  complete: boolean
  remaining: { lessons: number; quizzes: number; assignments: number }
  counted: number
}

/**
 * Server-side completion rule: every required lesson completed AND (when the
 * course says so) every required quiz passed AND every required assignment
 * approved. A course with nothing required is never "complete".
 */
export function evaluateCompletion(input: CompletionInput): CompletionResult {
  const lessons = input.lessons.filter((l) => l.required)
  const quizzes = input.requireQuizzes ? input.quizzes.filter((q) => q.required) : []
  const assignments = input.requireAssignments ? input.assignments.filter((a) => a.required) : []
  const remaining = {
    lessons: lessons.filter((l) => !input.completedLessonIds.has(l.id)).length,
    quizzes: quizzes.filter((q) => !input.passedQuizIds.has(q.id)).length,
    assignments: assignments.filter((a) => !input.approvedAssignmentIds.has(a.id)).length,
  }
  const counted = lessons.length + quizzes.length + assignments.length
  const left = remaining.lessons + remaining.quizzes + remaining.assignments
  const progress = counted === 0 ? 0 : Math.floor(((counted - left) / counted) * 100)
  return { progress, complete: counted > 0 && left === 0, remaining, counted }
}

/**
 * In a sequential course a lesson is locked until every earlier required
 * lesson (course order: module position, then lesson position) is completed.
 */
export function isLessonLocked(
  sequential: boolean,
  ordered: readonly { id: string; required: boolean }[],
  completed: ReadonlySet<string>,
  lessonId: string,
): boolean {
  if (!sequential) return false
  for (const lesson of ordered) {
    if (lesson.id === lessonId) return false
    if (lesson.required && !completed.has(lesson.id)) return true
  }
  return false
}

export type LearningDeadline = 'NONE' | 'UPCOMING' | 'DUE_SOON' | 'DUE_TODAY' | 'OVERDUE' | 'COMPLETED'

export const DEADLINE_LABELS: Record<LearningDeadline, string> = {
  NONE: 'No deadline',
  UPCOMING: 'Upcoming',
  DUE_SOON: 'Due soon',
  DUE_TODAY: 'Due today',
  OVERDUE: 'Overdue',
  COMPLETED: 'Completed',
}

const DAY = 86_400_000

/** Deadline state of a learning item (calendar dates, organization "today"). Completed items stay completed. */
export function learningDeadline(dueDate: Date | null, completed: boolean, today: Date): LearningDeadline {
  if (completed) return 'COMPLETED'
  if (!dueDate) return 'NONE'
  const days = Math.round((dueDate.getTime() - today.getTime()) / DAY)
  if (days < 0) return 'OVERDUE'
  if (days === 0) return 'DUE_TODAY'
  return days <= 3 ? 'DUE_SOON' : 'UPCOMING'
}

/** OVERDUE is derived at read time; stored status (and history) never changes because a date passed. */
export function effectiveEnrollmentStatus(
  status: EnrollmentStatus,
  dueDate: Date | null,
  today: Date,
): EffectiveEnrollmentStatus {
  if ((status === 'NOT_STARTED' || status === 'IN_PROGRESS') && dueDate && dueDate < today) return 'OVERDUE'
  return status
}

/** Stored status for a progress value. */
export function statusForProgress(progress: number, complete: boolean): EnrollmentStatus {
  if (complete) return 'COMPLETED'
  return progress > 0 ? 'IN_PROGRESS' : 'NOT_STARTED'
}

export interface PathItemInput {
  courseId: string
  position: number
  required: boolean
  requiresPrevious: boolean
  dueDays: number | null
}

/**
 * Snapshot of a learning path for one person: items in order, each with its
 * prerequisite (the previous course when "requires previous" is set) and a due
 * date relative to the assignment date (falls back to the plan's due date).
 */
export function buildPlanItems(items: readonly PathItemInput[], assignedOn: Date, planDue: Date | null) {
  const ordered = [...items].sort((a, b) => a.position - b.position)
  return ordered.map((item, index) => ({
    courseId: item.courseId,
    position: index,
    required: item.required,
    prerequisiteCourseId: item.requiresPrevious && index > 0 ? ordered[index - 1].courseId : null,
    dueDate: item.dueDays ? new Date(assignedOn.getTime() + item.dueDays * DAY) : planDue,
  }))
}

/** Is a planned course still waiting on its prerequisite? */
export function isBlockedByPrerequisite(prerequisiteCourseId: string | null, completedCourseIds: ReadonlySet<string>) {
  return Boolean(prerequisiteCourseId && !completedCourseIds.has(prerequisiteCourseId))
}

/** "1 h 20 min" */
export function formatMinutes(minutes: number | null | undefined): string {
  if (!minutes) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m} min`
  return m ? `${h} h ${m} min` : `${h} h`
}

export function slugify(value: string, max = 60) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
}
