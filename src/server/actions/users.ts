'use server'

import { revalidatePath } from 'next/cache'
import { getRequestMeta } from '@/lib/http/request-meta'
import { requireApiContext } from '../context'
import { invitationService } from '../services/invitation.service'
import { userService } from '../services/user.service'
import { formError, formFields, safeValues, type FormState } from './form-state'

/**
 * User administration. The browser only sends ids and choices; every rule
 * (permission, organization, rank, self-protection, last super admin) is
 * enforced by the services.
 */

export async function inviteUserAction(
  _previous: FormState<{ inviteUrl: string | null; delivery: 'email' | 'link' }>,
  formData: FormData,
): Promise<FormState<{ inviteUrl: string | null; delivery: 'email' | 'link' }>> {
  const fields = formFields(formData)
  try {
    const ctx = await requireApiContext()
    const result = await invitationService.create(ctx, fields, await getRequestMeta())
    revalidatePath('/users')
    return {
      status: 'success',
      message: result.delivery === 'email' ? `Invitation sent to ${fields.email}.` : 'Invitation created.',
      data: { inviteUrl: result.inviteUrl, delivery: result.delivery },
    }
  } catch (error) {
    return formError(error, safeValues(fields))
  }
}

export async function changeRoleAction(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireApiContext()
    const { changed } = await userService.changeRole(ctx, {
      userId: String(formData.get('userId') ?? ''),
      roleId: String(formData.get('roleId') ?? ''),
    })
    revalidatePath('/users')
    return { status: 'success', message: changed ? 'Role updated.' : 'No change.' }
  } catch (error) {
    return formError(error)
  }
}

export async function setUserStatusAction(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireApiContext()
    const status = String(formData.get('status') ?? '') as 'ACTIVE' | 'SUSPENDED' | 'INACTIVE'
    const { changed } = await userService.setStatus(ctx, { userId: String(formData.get('userId') ?? ''), status })
    revalidatePath('/users')
    const verb = status === 'ACTIVE' ? 'reactivated' : status === 'SUSPENDED' ? 'suspended' : 'deactivated'
    return { status: 'success', message: changed ? `User ${verb}.` : 'No change.' }
  } catch (error) {
    return formError(error)
  }
}

export async function revokeInvitationAction(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireApiContext()
    await invitationService.revoke(ctx, String(formData.get('invitationId') ?? ''))
    revalidatePath('/users')
    return { status: 'success', message: 'Invitation revoked.' }
  } catch (error) {
    return formError(error)
  }
}
