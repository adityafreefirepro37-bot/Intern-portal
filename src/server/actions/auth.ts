'use server'

import { redirect } from 'next/navigation'
import { getRequestMeta } from '@/lib/http/request-meta'
import { getAuthState, getCurrentUser } from '../context'
import { authService, type SignInOutcome } from '../services/auth.service'
import { invitationService } from '../services/invitation.service'
import { formError, formFields, safeValues, type FormState } from './form-state'

/**
 * Public authentication actions. Next.js rejects cross-origin Server Action
 * calls (Origin must match Host), and session cookies are SameSite=Lax and
 * httpOnly — together this is the CSRF protection for these endpoints.
 */

export async function signInAction(
  _previous: FormState<{ state: string }>,
  formData: FormData,
): Promise<FormState<{ state: string }>> {
  const fields = formFields(formData)
  let outcome: SignInOutcome
  try {
    outcome = await authService.signIn(fields, await getRequestMeta())
  } catch (error) {
    return formError(error, safeValues(fields))
  }
  if (outcome.ok) redirect(outcome.redirectTo)
  return { status: 'error', message: outcome.message, data: { state: outcome.state }, values: safeValues(fields) }
}

export async function signOutAction(): Promise<void> {
  const ctx = await getCurrentUser().catch(() => null)
  await authService.signOut(ctx, await getRequestMeta())
  redirect('/login?signed_out=1')
}

export async function requestPasswordResetAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const fields = formFields(formData)
  try {
    await authService.requestPasswordReset(fields, await getRequestMeta())
  } catch (error) {
    const state = formError(error, safeValues(fields))
    // Validation and rate-limit messages are safe to show; nothing reveals whether the account exists.
    return state
  }
  return {
    status: 'success',
    message: 'If an account exists for that email, a reset link is on its way. It expires in one hour.',
  }
}

export async function completePasswordResetAction(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    await authService.completePasswordReset(formFields(formData), await getRequestMeta())
  } catch (error) {
    return formError(error)
  }
  redirect('/?password_reset=1')
}

export async function resendVerificationAction(_previous: FormState): Promise<FormState> {
  try {
    await authService.resendVerification(await getRequestMeta())
  } catch (error) {
    return formError(error)
  }
  return { status: 'success', message: 'Verification email sent. Check your inbox (and spam folder).' }
}

export async function acceptInvitationAction(
  _previous: FormState<{ email: string; verificationPending: boolean }>,
  formData: FormData,
): Promise<FormState<{ email: string; verificationPending: boolean }>> {
  const fields = formFields(formData)
  let result: { sessionCreated: boolean; email: string }
  try {
    result = await invitationService.accept(fields, await getRequestMeta())
  } catch (error) {
    return formError(error, safeValues(fields))
  }
  if (result.sessionCreated) {
    const state = await getAuthState()
    redirect(state.status === 'AUTHENTICATED' ? '/?welcome=1' : '/verify-email')
  }
  return {
    status: 'success',
    message: 'Account created. Confirm your email address using the link we just sent, then sign in.',
    data: { email: result.email, verificationPending: true },
  }
}
