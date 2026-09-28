'use server'

import { revalidatePath } from 'next/cache'
import { ValidationError } from '@/lib/errors'
import { getRequestMeta } from '@/lib/http/request-meta'
import { requireApiContext } from '../context'
import { authService } from '../services/auth.service'
import { sessionService } from '../services/session.service'
import { userService } from '../services/user.service'
import { formError, formFields, safeValues, type FormState } from './form-state'

/** Self-service actions: every one resolves the actor on the server first. */

export async function updateProfileAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const fields = formFields(formData)
  try {
    const ctx = await requireApiContext()
    await userService.updateOwnProfile(ctx, fields)
  } catch (error) {
    return formError(error, safeValues(fields))
  }
  revalidatePath('/', 'layout')
  return { status: 'success', message: 'Profile updated.' }
}

export async function uploadAvatarAction(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireApiContext()
    const file = formData.get('avatar')
    if (!(file instanceof File) || file.size === 0) throw new ValidationError('Choose an image', { avatar: 'Required' })
    await userService.setOwnAvatar(ctx, {
      name: file.name,
      type: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })
  } catch (error) {
    return formError(error)
  }
  revalidatePath('/', 'layout')
  return { status: 'success', message: 'Photo updated.' }
}

export async function changePasswordAction(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireApiContext()
    await authService.changePassword(ctx, formFields(formData), await getRequestMeta())
  } catch (error) {
    return formError(error)
  }
  revalidatePath('/security')
  return { status: 'success', message: 'Password changed. Your other sessions were signed out.' }
}

export async function revokeSessionAction(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    const ctx = await requireApiContext()
    await sessionService.revoke(ctx, String(formData.get('sessionId') ?? ''))
  } catch (error) {
    return formError(error)
  }
  revalidatePath('/security')
  return { status: 'success', message: 'Session signed out.' }
}

export async function revokeOtherSessionsAction(_previous: FormState): Promise<FormState> {
  try {
    const ctx = await requireApiContext()
    const { count } = await sessionService.revokeOthers(ctx)
    revalidatePath('/security')
    return {
      status: 'success',
      message: count ? `Signed out ${count} other session${count === 1 ? '' : 's'}.` : 'No other sessions were active.',
    }
  } catch (error) {
    return formError(error)
  }
}
