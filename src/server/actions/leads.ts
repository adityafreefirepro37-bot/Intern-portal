'use server'

import { revalidatePath } from 'next/cache'
import { requireApiContext } from '../context'
import { leadService } from '../services/lead.service'
import { formError, type FormState } from './form-state'

/** Growth leads. Every rule (scope, suppression, caps) lives in leadService. */

async function call<T>(operation: () => Promise<{ message?: string; data?: T }>, leadId?: string): Promise<FormState<T>> {
  try {
    const { message, data } = await operation()
    revalidatePath('/growth', 'layout')
    if (leadId) revalidatePath(`/growth/leads/${leadId}`)
    return { status: 'success', message, data }
  } catch (error) {
    return formError(error)
  }
}

export async function updateLeadAction(input: { leadId: string; status?: 'NEW' | 'REVIEWED' | 'READY' | 'NOT_A_FIT'; notes?: string | null; checklist?: Record<string, string | null>; email?: string | null }) {
  return call(async () => {
    await leadService.update(await requireApiContext(), input)
    return { message: 'Saved.' }
  }, input.leadId)
}

export async function assignLeadsAction(input: { leadIds: string[]; userId: string | null }) {
  return call(async () => {
    const { assigned } = await leadService.assign(await requireApiContext(), input)
    return { message: input.userId ? `${assigned} lead${assigned === 1 ? '' : 's'} assigned.` : `${assigned} lead${assigned === 1 ? '' : 's'} unassigned.` }
  })
}

export async function addLeadAction(input: { name: string; website?: string; phone?: string; email?: string; city?: string; industryId?: string }) {
  return call<{ id: string }>(async () => {
    const data = await leadService.addManual(await requireApiContext(), input)
    return { message: 'Lead added. Its audit runs in the next few minutes.', data }
  })
}

export async function researchLeadAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get('leadId') ?? '')
  return call(async () => {
    await leadService.research(await requireApiContext(), id)
    return { message: 'Queued: the audit runs again in the next few minutes.' }
  }, id)
}

export async function runWorkerNowAction(_previous: FormState, _formData: FormData): Promise<FormState> {
  void _formData
  return call(async () => {
    const result = await leadService.runNow(await requireApiContext())
    return { message: `Done: ${result.scheduled.queued} search${result.scheduled.queued === 1 ? '' : 'es'} queued, ${result.jobs.done} job${result.jobs.done === 1 ? '' : 's'} finished${result.jobs.failed ? `, ${result.jobs.failed} failed` : ''}.` }
  })
}

export async function saveGrowthSettingsAction(input: unknown) {
  return call(async () => {
    const { searches } = await leadService.saveSettings(await requireApiContext(), input)
    return { message: `Settings saved. ${searches} searches across your cities and industries.` }
  })
}

export async function saveIndustryAction(input: { industryId: string; active: boolean; priority: number; terms: string[] }) {
  return call(async () => {
    await leadService.saveIndustry(await requireApiContext(), input)
    return { message: 'Industry saved.' }
  })
}
