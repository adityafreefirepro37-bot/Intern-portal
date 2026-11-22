'use server'

import { revalidatePath } from 'next/cache'
import { requireApiContext } from '../context'
import { outreachService } from '../services/outreach.service'
import { formError, type FormState } from './form-state'

/** Growth outreach (admins). Every rule lives in outreachService and the outreach engine. */

async function call(operation: () => Promise<string>): Promise<FormState> {
  try {
    const message = await operation()
    revalidatePath('/growth', 'layout')
    return { status: 'success', message }
  } catch (error) {
    return formError(error)
  }
}

export async function saveOutreachSettingsAction(input: unknown) {
  return call(async () => {
    await outreachService.saveSettings(await requireApiContext(), input)
    return 'Outreach settings saved.'
  })
}

export async function approveOutreachAction(input: { messageId: string; subject?: string; body?: string }) {
  return call(async () => {
    await outreachService.approve(await requireApiContext(), input)
    return 'Approved: it goes out in the next sending window.'
  })
}

export async function rejectOutreachAction(messageId: string) {
  return call(async () => {
    await outreachService.reject(await requireApiContext(), messageId)
    return 'Not sent. This lead gets no automatic emails.'
  })
}

export async function stopOutreachAction(leadId: string) {
  return call(async () => {
    await outreachService.stop(await requireApiContext(), leadId)
    return 'Automatic emails stopped for this lead.'
  })
}
