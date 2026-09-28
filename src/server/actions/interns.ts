'use server'

import { revalidatePath } from 'next/cache'
import { ForbiddenError, ValidationError } from '@/lib/errors'
import { getRequestMeta } from '@/lib/http/request-meta'
import { requireApiContext } from '../context'
import { documentService } from '../services/document.service'
import { internLifecycleService } from '../services/intern-lifecycle.service'
import { internService } from '../services/intern.service'
import { invitationService } from '../services/invitation.service'
import { onboardingTemplateService } from '../services/onboarding-template.service'
import { onboardingService } from '../services/onboarding.service'
import { formError, formFields, safeValues, type FormState } from './form-state'

/**
 * Intern management, onboarding and documents. The browser sends ids and
 * field values only; permissions, scope, transitions and visibility are all
 * decided by the services (see intern-access.ts).
 */

function fileFrom(formData: FormData, key: string) {
  const value = formData.get(key)
  return value instanceof File && value.size > 0 ? value : null
}

async function toUpload(file: File) {
  return { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }
}

function refreshIntern(internId: string) {
  revalidatePath(`/interns/${internId}`)
  revalidatePath('/interns')
}

export type CreateInternResult = { internId: string; employeeCode: string; inviteUrl: string | null; warnings: string[] }

export async function createInternAction(
  _previous: FormState<CreateInternResult>,
  formData: FormData,
): Promise<FormState<CreateInternResult>> {
  const fields = formFields(formData)
  try {
    const ctx = await requireApiContext()
    const photo = fileFrom(formData, 'photo')
    const result = await internService.create(ctx, fields, await getRequestMeta(), photo ? await toUpload(photo) : undefined)
    revalidatePath('/interns')
    revalidatePath('/hr')
    revalidatePath('/onboarding')
    return {
      status: 'success',
      message: `Intern created (${result.employeeCode}).`,
      data: {
        internId: result.internId,
        employeeCode: result.employeeCode,
        inviteUrl: result.invitation?.inviteUrl ?? null,
        warnings: result.warnings,
      },
    }
  } catch (error) {
    return formError(error, safeValues(fields))
  }
}

export async function updateInternAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { internId, ...fields } = formFields(formData)
  try {
    const ctx = await requireApiContext()
    await internService.updateDetails(ctx, internId ?? '', fields)
    refreshIntern(internId ?? '')
    return { status: 'success', message: 'Intern details saved.' }
  } catch (error) {
    return formError(error, safeValues(fields))
  }
}

export async function assignInternAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const fields = formFields(formData)
  try {
    const ctx = await requireApiContext()
    const { changed } = await internService.assign(ctx, fields)
    refreshIntern(fields.internId ?? '')
    return { status: 'success', message: changed ? `${fields.role === 'mentor' ? 'Mentor' : 'Manager'} updated.` : 'No change.' }
  } catch (error) {
    return formError(error)
  }
}

export async function updateOwnInternProfileAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const fields = formFields(formData)
  try {
    const ctx = await requireApiContext()
    await internService.updateOwnProfile(ctx, fields)
    revalidatePath('/interns', 'layout')
    return { status: 'success', message: 'Profile saved.' }
  } catch (error) {
    return formError(error, safeValues(fields))
  }
}

export async function transitionInternAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const fields = formFields(formData)
  try {
    const ctx = await requireApiContext()
    const { to } = await internLifecycleService.transitionStatus(ctx, fields)
    refreshIntern(fields.internId ?? '')
    revalidatePath('/hr')
    revalidatePath('/onboarding')
    return { status: 'success', message: `Status changed to ${to.replace('_', ' ').toLowerCase()}.` }
  } catch (error) {
    return formError(error, safeValues(fields))
  }
}

export async function resendInternInvitationAction(
  _previous: FormState<{ inviteUrl: string | null }>,
  formData: FormData,
): Promise<FormState<{ inviteUrl: string | null }>> {
  try {
    const ctx = await requireApiContext()
    const access = await internService.getProfile(ctx, String(formData.get('internId') ?? ''))
    if (!access.can.editDetails) throw new ForbiddenError()
    const result = await invitationService.inviteExistingUser(ctx, access.userId, await getRequestMeta())
    refreshIntern(access.id)
    return {
      status: 'success',
      message: result.delivery === 'email' ? 'Invitation sent.' : 'Invitation link created.',
      data: { inviteUrl: result.inviteUrl },
    }
  } catch (error) {
    return formError(error)
  }
}

// ── Onboarding ──────────────────────────────────────────────────────────────

export async function completeOnboardingItemAction(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireApiContext()
    const { changed } = await onboardingService.completeItem(ctx, String(formData.get('itemId') ?? ''))
    revalidatePath('/onboarding', 'layout')
    revalidatePath('/interns', 'layout')
    return { status: 'success', message: changed ? 'Item completed.' : 'Already complete.' }
  } catch (error) {
    return formError(error)
  }
}

export async function acknowledgePolicyAction(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireApiContext()
    await onboardingService.acknowledgeItem(ctx, String(formData.get('itemId') ?? ''), await getRequestMeta())
    revalidatePath('/onboarding', 'layout')
    revalidatePath('/interns', 'layout')
    return { status: 'success', message: 'Policy acknowledged.' }
  } catch (error) {
    return formError(error)
  }
}

export async function setOnboardingItemStatusAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const fields = formFields(formData)
  try {
    const ctx = await requireApiContext()
    await onboardingService.setItemStatus(ctx, fields)
    revalidatePath('/onboarding', 'layout')
    revalidatePath('/interns', 'layout')
    return { status: 'success', message: 'Item updated.' }
  } catch (error) {
    return formError(error)
  }
}

// ── Documents ───────────────────────────────────────────────────────────────

export async function uploadDocumentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const fields = formFields(formData)
  try {
    const ctx = await requireApiContext()
    const file = fileFrom(formData, 'file')
    await documentService.upload(
      ctx,
      fields,
      file ? await toUpload(file) : { name: '', type: '', bytes: new Uint8Array() },
      await getRequestMeta(),
    )
    revalidatePath('/interns', 'layout')
    revalidatePath('/onboarding', 'layout')
    return { status: 'success', message: 'Document uploaded.' }
  } catch (error) {
    return formError(error)
  }
}

export async function deleteDocumentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireApiContext()
    await documentService.remove(ctx, String(formData.get('documentId') ?? ''), await getRequestMeta())
    revalidatePath('/interns', 'layout')
    revalidatePath('/onboarding', 'layout')
    return { status: 'success', message: 'Document deleted.' }
  } catch (error) {
    return formError(error)
  }
}

// ── Onboarding templates ────────────────────────────────────────────────────

export async function saveTemplateAction(
  _previous: FormState<{ id: string }>,
  formData: FormData,
): Promise<FormState<{ id: string }>> {
  const { templateId, ...fields } = formFields(formData)
  try {
    const ctx = await requireApiContext()
    let id = templateId
    if (templateId) await onboardingTemplateService.update(ctx, templateId, fields)
    else id = (await onboardingTemplateService.create(ctx, fields)).id
    revalidatePath('/onboarding/templates', 'layout')
    return { status: 'success', message: templateId ? 'Template saved.' : 'Template created.', data: { id: id! } }
  } catch (error) {
    return formError(error, safeValues(fields))
  }
}

export async function saveTemplateItemAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const { templateId, itemId, ...fields } = formFields(formData)
  try {
    const ctx = await requireApiContext()
    if (itemId) await onboardingTemplateService.updateItem(ctx, itemId, fields)
    else await onboardingTemplateService.addItem(ctx, templateId ?? '', fields)
    revalidatePath('/onboarding/templates', 'layout')
    return { status: 'success', message: itemId ? 'Item saved.' : 'Item added.' }
  } catch (error) {
    return formError(error, safeValues(fields))
  }
}

export async function templateItemCommandAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const itemId = String(formData.get('itemId') ?? '')
  const command = String(formData.get('command') ?? '')
  try {
    const ctx = await requireApiContext()
    if (command === 'delete') await onboardingTemplateService.removeItem(ctx, itemId)
    else if (command === 'up' || command === 'down') await onboardingTemplateService.moveItem(ctx, itemId, command)
    else throw new ValidationError('Unknown command')
    revalidatePath('/onboarding/templates', 'layout')
    return { status: 'success', message: command === 'delete' ? 'Item removed.' : 'Order updated.' }
  } catch (error) {
    return formError(error)
  }
}
