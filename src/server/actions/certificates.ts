'use server'

import { revalidatePath } from 'next/cache'
import { requireApiContext } from '../context'
import { certificateService } from '../services/certificate.service'
import { formError, formFields, safeValues, type FormState } from './form-state'

/** Certificates: drafts, issuing, revoking and settings. Rules live in certificateService. */

function refresh() {
  revalidatePath('/certificates', 'layout')
  revalidatePath('/hr/offboarding')
  revalidatePath('/interns', 'layout')
  revalidatePath('/my-internship')
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

export async function saveCertificateDraftAction(
  _previous: FormState<{ id: string }>,
  formData: FormData,
): Promise<FormState<{ id: string }>> {
  return run(formData, async (fields) => {
    const { id } = await certificateService.saveDraft(await requireApiContext(), fields)
    return { message: fields.certificateId ? 'Draft updated.' : 'Draft prepared — check the preview, then issue it.', data: { id } }
  })
}

export async function issueCertificateAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    const { number } = await certificateService.issue(await requireApiContext(), fields.certificateId ?? '')
    return { message: `Issued as ${number}. The intern has been notified.` }
  })
}

export async function revokeCertificateAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await certificateService.revoke(await requireApiContext(), fields)
    return { message: 'Certificate revoked. Its verification page now says so.' }
  })
}

export async function deleteCertificateDraftAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await certificateService.deleteDraft(await requireApiContext(), fields.certificateId ?? '')
    return { message: 'Draft deleted.' }
  })
}

export async function saveCertificateSettingsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await certificateService.saveSettings(await requireApiContext(), fields)
    return { message: 'Certificate settings saved.' }
  })
}
