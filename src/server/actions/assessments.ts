'use server'

import { revalidatePath } from 'next/cache'
import { getRequestMeta } from '@/lib/http/request-meta'
import { requireApiContext } from '../context'
import { assessmentService } from '../services/assessment.service'
import { formError, type FormState } from './form-state'

/** Task assessments. Every rule (scope, state, deadlines) lives in assessmentService. */

function refresh(id?: string) {
  revalidatePath('/assessments')
  if (id) revalidatePath(`/assessments/${id}`)
  revalidatePath('/tasks', 'layout')
}

async function call<T>(operation: () => Promise<{ message?: string; data?: T }>, id?: string): Promise<FormState<T>> {
  try {
    const { message, data } = await operation()
    refresh(id)
    return { status: 'success', message, data }
  } catch (error) {
    return formError(error)
  }
}

// ── Reviewers ───────────────────────────────────────────────────────────────

export async function saveAssessmentQuestionsAction(input: unknown) {
  const id = (input as { assessmentId?: string })?.assessmentId
  return call(async () => {
    await assessmentService.saveQuestions(await requireApiContext(), input)
    return { message: 'Questions saved.' }
  }, id)
}

export async function approveAssessmentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('assessmentId') ?? '')
  return call(async () => {
    await assessmentService.approve(await requireApiContext(), id)
    return { message: 'Approved. The intern has been asked to take it.' }
  }, id)
}

export async function regenerateAssessmentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('assessmentId') ?? '')
  return call(async () => {
    await assessmentService.regenerate(await requireApiContext(), id)
    return { message: 'Drafting new questions… refresh in a moment.' }
  }, id)
}

export async function waiveAssessmentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('assessmentId') ?? '')
  return call(async () => {
    await assessmentService.waive(await requireApiContext(), { assessmentId: id, reason: String(formData.get('reason') ?? '') })
    return { message: 'Assessment waived.' }
  }, id)
}

export async function gradeAssessmentAction(input: unknown) {
  const id = (input as { assessmentId?: string })?.assessmentId
  return call(async () => {
    const { percent, passed } = await assessmentService.grade(await requireApiContext(), input)
    return { message: `Graded: ${percent}% — ${passed ? 'passed' : 'not passed'}.` }
  }, id)
}

// ── Taking ──────────────────────────────────────────────────────────────────

export async function startAssessmentAction(input: unknown) {
  try {
    const meta = await getRequestMeta()
    const state = await assessmentService.start(await requireApiContext(), input, meta)
    return { status: 'success' as const, data: state }
  } catch (error) {
    return formError(error)
  }
}

export async function saveAssessmentAnswersAction(input: unknown) {
  try {
    await assessmentService.saveAnswers(await requireApiContext(), input)
    return { status: 'success' as const }
  } catch (error) {
    return formError(error)
  }
}

export async function submitAssessmentAction(input: { attemptId: string }) {
  try {
    await assessmentService.submit(await requireApiContext(), input.attemptId)
    revalidatePath('/assessments')
    return { status: 'success' as const }
  } catch (error) {
    return formError(error)
  }
}
