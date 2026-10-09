'use server'

import { revalidatePath } from 'next/cache'
import { ValidationError } from '@/lib/errors'
import { requireApiContext } from '../context'
import { learningAssignmentService } from '../services/learning-assignment.service'
import { learningCatalogService } from '../services/learning-catalog.service'
import { learningService } from '../services/learning.service'
import { quizService } from '../services/quiz.service'
import { formError, formFields, safeValues, type FormState } from './form-state'

/**
 * Learning: course authoring, enrollment, lessons, quizzes, assignments,
 * paths and required training. The browser sends ids, values and choices;
 * completion, scoring and access are decided by the services.
 */

type Upload = { name: string; type: string; bytes: Uint8Array }

async function filesFrom(formData: FormData, key: string): Promise<Upload[]> {
  const files = formData.getAll(key).filter((value): value is File => value instanceof File && value.size > 0)
  return Promise.all(
    files.map(async (file) => ({ name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })),
  )
}

function list(formData: FormData, key: string) {
  return formData.getAll(key).filter((v): v is string => typeof v === 'string' && v !== '')
}

/** JSON payloads from client-built forms (quiz answers, path ordering). */
function json(value: string | undefined): unknown {
  try {
    return JSON.parse(value ?? '')
  } catch {
    throw new ValidationError('The form couldn’t be read — reload the page and try again')
  }
}

function refresh() {
  revalidatePath('/learning', 'layout')
  revalidatePath('/interns', 'layout')
  revalidatePath('/')
}

async function run<T = undefined>(
  formData: FormData,
  operation: (fields: Record<string, string>) => Promise<{ message: string; data?: T }>,
): Promise<FormState<T>> {
  const fields = formFields(formData)
  try {
    const { message, data } = await operation(fields)
    refresh()
    return { status: 'success', message, data }
  } catch (error) {
    return formError(error, safeValues(fields))
  }
}

// ── Authoring ───────────────────────────────────────────────────────────────

export async function saveCategoryAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await learningCatalogService.saveCategory(await requireApiContext(), fields)
    return { message: 'Category saved.' }
  })
}

export async function saveCourseAction(
  _previous: FormState<{ id: string }>,
  formData: FormData,
): Promise<FormState<{ id: string }>> {
  return run(formData, async (fields) => {
    const ctx = await requireApiContext()
    if (fields.courseId) {
      await learningCatalogService.updateCourse(ctx, fields)
      return { message: 'Course saved.', data: { id: fields.courseId } }
    }
    const { id } = await learningCatalogService.createCourse(ctx, fields)
    return { message: 'Course created — add lessons next.', data: { id } }
  })
}

export async function courseStatusAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await learningCatalogService.setCourseStatus(await requireApiContext(), fields)
    const labels: Record<string, string> = { PUBLISH: 'Course published.', ARCHIVE: 'Course archived.', DRAFT: 'Course moved to draft.' }
    return { message: labels[fields.action] ?? 'Course updated.' }
  })
}

export async function deleteCourseAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ courseId }) => {
    await learningCatalogService.deleteCourse(await requireApiContext(), courseId ?? '')
    return { message: 'Course deleted.' }
  })
}

export async function saveModuleAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await learningCatalogService.saveModule(await requireApiContext(), fields)
    return { message: 'Module saved.' }
  })
}

export async function moveModuleAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await learningCatalogService.moveModule(await requireApiContext(), fields)
    return { message: 'Order updated.' }
  })
}

export async function deleteModuleAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ moduleId }) => {
    await learningCatalogService.deleteModule(await requireApiContext(), moduleId ?? '')
    return { message: 'Module deleted.' }
  })
}

export async function saveLessonAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await learningCatalogService.saveLesson(await requireApiContext(), fields)
    return { message: 'Lesson saved.' }
  })
}

export async function moveLessonAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await learningCatalogService.moveLesson(await requireApiContext(), fields)
    return { message: 'Order updated.' }
  })
}

export async function deleteLessonAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ lessonId }) => {
    await learningCatalogService.deleteLesson(await requireApiContext(), lessonId ?? '')
    return { message: 'Lesson deleted.' }
  })
}

export async function saveQuizAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await learningCatalogService.saveQuiz(await requireApiContext(), fields)
    return { message: 'Quiz saved.' }
  })
}

export async function quizStatusAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await learningCatalogService.setQuizStatus(await requireApiContext(), fields)
    return { message: fields.action === 'PUBLISH' ? 'Quiz published.' : 'Quiz moved to draft.' }
  })
}

export async function deleteQuizAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ quizId }) => {
    await learningCatalogService.deleteQuiz(await requireApiContext(), quizId ?? '')
    return { message: 'Quiz deleted.' }
  })
}

export async function saveQuestionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const options = formData.getAll('options').filter((v): v is string => typeof v === 'string')
  const correctOptions = list(formData, 'correctOptions')
  const acceptedAnswers = list(formData, 'acceptedAnswers')
  return run(formData, async ({ quizId, questionId, question, type, points, explanation }) => {
    await learningCatalogService.saveQuestion(await requireApiContext(), {
      quizId,
      questionId,
      question,
      type,
      points,
      explanation,
      options,
      correctOptions,
      acceptedAnswers,
    })
    return { message: 'Question saved.' }
  })
}

export async function deleteQuestionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ questionId }) => {
    await learningCatalogService.deleteQuestion(await requireApiContext(), questionId ?? '')
    return { message: 'Question deleted.' }
  })
}

export async function saveAssignmentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await learningCatalogService.saveAssignment(await requireApiContext(), fields)
    return { message: 'Assignment saved.' }
  })
}

export async function deleteAssignmentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ assignmentId }) => {
    await learningCatalogService.deleteAssignment(await requireApiContext(), assignmentId ?? '')
    return { message: 'Assignment deleted.' }
  })
}

// ── Enrollment and progress ─────────────────────────────────────────────────

export async function enrollAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ courseId }) => {
    await learningService.enrollSelf(await requireApiContext(), courseId ?? '')
    return { message: 'Enrolled — happy learning!' }
  })
}

export async function assignCourseAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const userIds = list(formData, 'userIds')
  return run(formData, async ({ courseId, dueDate }) => {
    const { created, already } = await learningService.assign(await requireApiContext(), { courseId, userIds, dueDate })
    return {
      message: `Assigned to ${created} ${created === 1 ? 'person' : 'people'}${already ? ` (${already} already enrolled)` : ''}.`,
    }
  })
}

export async function cancelEnrollmentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ enrollmentId }) => {
    await learningService.cancelEnrollment(await requireApiContext(), enrollmentId ?? '')
    return { message: 'Enrollment cancelled.' }
  })
}

export async function completeLessonAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ lessonId }) => {
    const result = await learningService.completeLesson(await requireApiContext(), lessonId ?? '')
    return {
      message: result?.completedNow ? 'Lesson complete — and you finished the course!' : 'Lesson marked complete.',
    }
  })
}

// ── Quizzes ─────────────────────────────────────────────────────────────────

export async function startQuizAction(
  _previous: FormState<{ attemptId: string }>,
  formData: FormData,
): Promise<FormState<{ attemptId: string }>> {
  return run(formData, async ({ quizId }) => {
    const { attemptId } = await quizService.start(await requireApiContext(), quizId ?? '')
    return { message: 'Quiz started.', data: { attemptId } }
  })
}

export async function submitQuizAction(
  _previous: FormState<{ attemptId: string }>,
  formData: FormData,
): Promise<FormState<{ attemptId: string }>> {
  return run(formData, async ({ attemptId, answers }) => {
    const result = await quizService.submit(await requireApiContext(), { attemptId, answers: json(answers) })
    return {
      message: result.expired
        ? 'The time limit had passed, so this attempt was closed.'
        : result.passed
          ? `Passed with ${result.percentage}%.`
          : `Scored ${result.percentage}% — not passed this time.`,
      data: { attemptId: result.attemptId },
    }
  })
}

// ── Assignments ─────────────────────────────────────────────────────────────

export async function saveAssignmentDraftAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ assignmentId, text }) => {
    await learningAssignmentService.saveDraft(await requireApiContext(), { assignmentId, text: text ?? '' })
    return { message: 'Draft saved.' }
  })
}

export async function submitAssignmentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const uploads = await filesFrom(formData, 'files')
  return run(formData, async ({ assignmentId, message }) => {
    const { version } = await learningAssignmentService.submit(await requireApiContext(), { assignmentId, message }, uploads)
    return { message: version > 1 ? `Resubmitted (version ${version}).` : 'Submitted for review.' }
  })
}

export async function reviewAssignmentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ submissionId, decision, comment, points }) => {
    const { decision: result } = await learningAssignmentService.review(await requireApiContext(), {
      submissionId,
      decision,
      comment,
      ...(points ? { points } : {}),
    })
    return { message: result === 'APPROVED' ? 'Approved.' : 'Changes requested.' }
  })
}

// ── Paths and required training ─────────────────────────────────────────────

export async function savePathAction(
  _previous: FormState<{ id: string }>,
  formData: FormData,
): Promise<FormState<{ id: string }>> {
  return run(formData, async (fields) => {
    const { id } = await learningService.savePath(await requireApiContext(), fields)
    return { message: fields.pathId ? 'Path saved.' : 'Path created — add courses next.', data: { id } }
  })
}

export async function setPathCoursesAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ pathId, items }) => {
    await learningService.setPathCourses(await requireApiContext(), { pathId, items: json(items) })
    return { message: 'Courses saved.' }
  })
}

export async function pathStatusAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await learningService.setPathStatus(await requireApiContext(), fields)
    const labels: Record<string, string> = { PUBLISH: 'Path published.', ARCHIVE: 'Path archived.', DRAFT: 'Path moved to draft.' }
    return { message: labels[fields.action] ?? 'Path updated.' }
  })
}

export async function assignPathAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const userIds = list(formData, 'userIds')
  return run(formData, async ({ pathId, dueDate }) => {
    const { assigned, skipped } = await learningService.assignPath(await requireApiContext(), { pathId, userIds, dueDate })
    return {
      message: `Path assigned to ${assigned} ${assigned === 1 ? 'person' : 'people'}${skipped ? ` (${skipped} already had it)` : ''}.`,
    }
  })
}

export async function saveRequiredRuleAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    const { enrolled } = await learningService.saveRequiredRule(await requireApiContext(), fields)
    return { message: `Required training saved — ${enrolled} ${enrolled === 1 ? 'person' : 'people'} enrolled now.` }
  })
}

export async function deactivateRequiredRuleAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ ruleId }) => {
    await learningService.deactivateRequiredRule(await requireApiContext(), ruleId ?? '')
    return { message: 'Rule turned off. Existing enrollments stay.' }
  })
}
