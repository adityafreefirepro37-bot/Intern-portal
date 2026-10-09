'use server'

import { revalidatePath } from 'next/cache'
import { ValidationError } from '@/lib/errors'
import { requireApiContext } from '../context'
import { checkinService } from '../services/checkin.service'
import { developmentPlanService } from '../services/development-plan.service'
import { feedbackService } from '../services/feedback.service'
import { goalService } from '../services/goal.service'
import { performanceReviewService } from '../services/performance-review.service'
import { formError, formFields, safeValues, type FormState } from './form-state'

/**
 * Performance: goals, weekly check-ins, feedback, reviews (templates, cycles,
 * answers, corrections) and development plans. Visibility, stages and
 * locking are enforced by the services.
 */

function list(formData: FormData, key: string) {
  return formData.getAll(key).filter((v): v is string => typeof v === 'string' && v !== '')
}

function json(value: string | undefined): unknown {
  try {
    return JSON.parse(value ?? '')
  } catch {
    throw new ValidationError('The form couldn’t be read — reload the page and try again')
  }
}

function refresh() {
  revalidatePath('/performance', 'layout')
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

// ── Goals ───────────────────────────────────────────────────────────────────

export async function saveGoalAction(
  _previous: FormState<{ id: string }>,
  formData: FormData,
): Promise<FormState<{ id: string }>> {
  return run(formData, async (fields) => {
    const { id } = await goalService.save(await requireApiContext(), fields)
    return { message: fields.goalId ? 'Goal saved.' : 'Goal created.', data: { id } }
  })
}

export async function goalProgressAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    const next = await goalService.setProgress(await requireApiContext(), fields)
    return { message: next.status === 'COMPLETED' ? 'Goal completed.' : `Progress updated to ${next.progress}%.` }
  })
}

export async function addGoalEvidenceAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await goalService.addEvidence(await requireApiContext(), fields)
    return { message: 'Evidence added.' }
  })
}

export async function removeGoalEvidenceAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ evidenceId }) => {
    await goalService.removeEvidence(await requireApiContext(), evidenceId ?? '')
    return { message: 'Evidence removed.' }
  })
}

// ── Check-ins ───────────────────────────────────────────────────────────────

export async function saveCheckinAction(
  _previous: FormState<{ id: string }>,
  formData: FormData,
): Promise<FormState<{ id: string }>> {
  return run(formData, async ({ intent, ...fields }) => {
    const submit = intent === 'submit'
    const { id } = await checkinService.save(await requireApiContext(), { ...fields, submit })
    return { message: submit ? 'Check-in submitted.' : 'Draft saved.', data: { id } }
  })
}

export async function reviewCheckinAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await checkinService.review(await requireApiContext(), fields)
    return { message: 'Check-in reviewed.' }
  })
}

// ── Feedback ────────────────────────────────────────────────────────────────

export async function giveFeedbackAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await feedbackService.give(await requireApiContext(), fields)
    return { message: 'Feedback saved.' }
  })
}

export async function editFeedbackAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await feedbackService.edit(await requireApiContext(), fields)
    return { message: 'Feedback updated.' }
  })
}

export async function requestFeedbackAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await feedbackService.request(await requireApiContext(), fields)
    return { message: 'Feedback requested.' }
  })
}

export async function closeFeedbackRequestAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await feedbackService.closeRequest(await requireApiContext(), fields)
    return { message: fields.action === 'DECLINE' ? 'Request declined.' : 'Request cancelled.' }
  })
}

// ── Review templates and cycles ─────────────────────────────────────────────

export async function saveTemplateAction(
  _previous: FormState<{ id: string }>,
  formData: FormData,
): Promise<FormState<{ id: string }>> {
  return run(formData, async (fields) => {
    const { id } = await performanceReviewService.saveTemplate(await requireApiContext(), fields)
    return { message: fields.templateId ? 'Template saved.' : 'Template created — add sections next.', data: { id } }
  })
}

export async function duplicateTemplateAction(
  _previous: FormState<{ id: string }>,
  formData: FormData,
): Promise<FormState<{ id: string }>> {
  return run(formData, async ({ templateId }) => {
    const { id } = await performanceReviewService.duplicateTemplate(await requireApiContext(), templateId ?? '')
    return { message: 'Template duplicated.', data: { id } }
  })
}

export async function saveSectionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const respondents = list(formData, 'respondents')
  return run(formData, async ({ templateId, sectionId, title, description }) => {
    await performanceReviewService.saveSection(await requireApiContext(), { templateId, sectionId, title, description, respondents })
    return { message: 'Section saved.' }
  })
}

export async function deleteSectionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ sectionId }) => {
    await performanceReviewService.deleteSection(await requireApiContext(), sectionId ?? '')
    return { message: 'Section deleted.' }
  })
}

export async function moveSectionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await performanceReviewService.moveSection(await requireApiContext(), fields)
    return { message: 'Order updated.' }
  })
}

export async function saveReviewQuestionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ options, ...fields }) => {
    const parsed = (options ?? '')
      .split('\n')
      .map((o) => o.trim())
      .filter(Boolean)
    await performanceReviewService.saveQuestion(await requireApiContext(), { ...fields, options: parsed })
    return { message: 'Question saved.' }
  })
}

export async function deleteReviewQuestionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ questionId }) => {
    await performanceReviewService.deleteQuestion(await requireApiContext(), questionId ?? '')
    return { message: 'Question deleted.' }
  })
}

export async function moveReviewQuestionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await performanceReviewService.moveQuestion(await requireApiContext(), fields)
    return { message: 'Order updated.' }
  })
}

export async function saveCycleAction(
  _previous: FormState<{ id: string }>,
  formData: FormData,
): Promise<FormState<{ id: string }>> {
  return run(formData, async (fields) => {
    const { id } = await performanceReviewService.saveCycle(await requireApiContext(), fields)
    return { message: fields.cycleId ? 'Cycle saved.' : 'Cycle created.', data: { id } }
  })
}

export async function openCycleAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ cycleId }) => {
    const { created, skipped } = await performanceReviewService.openCycle(await requireApiContext(), cycleId ?? '')
    return {
      message: `Cycle opened — ${created} review${created === 1 ? '' : 's'} created${skipped ? `; ${skipped} intern${skipped === 1 ? '' : 's'} skipped (no manager)` : ''}.`,
    }
  })
}

export async function cycleStatusAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await performanceReviewService.setCycleStatus(await requireApiContext(), fields)
    return { message: 'Cycle updated.' }
  })
}

// ── Reviews ─────────────────────────────────────────────────────────────────

export async function startReviewAction(
  _previous: FormState<{ id: string }>,
  formData: FormData,
): Promise<FormState<{ id: string }>> {
  return run(formData, async (fields) => {
    const { id } = await performanceReviewService.start(await requireApiContext(), fields)
    return { message: 'Review started.', data: { id } }
  })
}

export async function saveReviewAnswersAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ reviewId, answers, intent }) => {
    const submit = intent === 'submit'
    const result = await performanceReviewService.saveAnswers(await requireApiContext(), {
      reviewId,
      answers: json(answers),
      submit,
    })
    return {
      message: !result.submitted ? 'Draft saved.' : result.status === 'COMPLETED' ? 'Submitted — the review is complete.' : 'Submitted.',
    }
  })
}

export async function correctReviewAnswerAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async ({ payload }) => {
    await performanceReviewService.correctAnswer(await requireApiContext(), json(payload))
    return { message: 'Correction saved. The previous value is kept in the history.' }
  })
}

export async function reopenReviewAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await performanceReviewService.reopen(await requireApiContext(), fields)
    return { message: 'Review reopened.' }
  })
}

// ── Development plans ───────────────────────────────────────────────────────

export async function createDevelopmentPlanAction(
  _previous: FormState<{ id: string }>,
  formData: FormData,
): Promise<FormState<{ id: string }>> {
  return run(formData, async (fields) => {
    const { id } = await developmentPlanService.create(await requireApiContext(), fields)
    return { message: 'Development plan created.', data: { id } }
  })
}

export async function saveDevelopmentItemAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await developmentPlanService.saveItem(await requireApiContext(), fields)
    return { message: 'Item saved.' }
  })
}

export async function developmentItemStatusAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await developmentPlanService.setItemStatus(await requireApiContext(), fields)
    return { message: 'Item updated.' }
  })
}

export async function developmentPlanStatusAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await developmentPlanService.setPlanStatus(await requireApiContext(), fields)
    return { message: 'Plan updated.' }
  })
}
