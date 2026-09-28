import { z } from 'zod'
import { checkPassword } from '@/lib/auth/password-policy'
import { getAuthProvider, type LinkType } from '@/lib/auth/provider'
import { safeNextPath } from '@/lib/auth/redirect'
import { config } from '@/lib/config'
import { prisma } from '@/lib/db/client'
import { AppError, ValidationError } from '@/lib/errors'
import type { RequestMeta } from '@/lib/http/request-meta'
import { logger } from '@/lib/logging'
import { maskEmail } from '@/lib/security/masking'
import { emailSchema, parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { identityRepository } from '../repositories/identity.repository'
import { sessionRepository } from '../repositories/session.repository'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { rateLimitService } from './rate-limit.service'

/**
 * Authentication flows. The provider (Supabase Auth) verifies credentials
 * and issues sessions; this service decides whether the *application*
 * account may be used, rate-limits attempts, records sessions and writes
 * audit events. Error messages are deliberately generic where detail would
 * enable account enumeration.
 */

export const GENERIC_LOGIN_ERROR = 'Incorrect email or password.'

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(128),
  next: z.string().max(512).optional(),
})

export type SignInOutcome =
  | { ok: true; redirectTo: string }
  | { ok: false; state: 'INVALID' | 'RATE_LIMITED' | 'UNAVAILABLE'; message: string }
  | {
      ok: false
      state: 'EMAIL_UNVERIFIED' | 'ACCOUNT_SUSPENDED' | 'ACCOUNT_INACTIVE' | 'PROFILE_INCOMPLETE'
      message: string
    }

/** Organization used for security events that can't be tied to an account. */
async function defaultOrganizationId(): Promise<string | null> {
  const org = await prisma.organization.findUnique({
    where: { slug: config.app.defaultOrganizationSlug },
    select: { id: true },
  })
  return org?.id ?? null
}

async function auditAnonymous(
  event: Omit<Parameters<typeof auditService.log>[0], 'organizationId'>,
  organizationId?: string | null,
) {
  const orgId = organizationId ?? (await defaultOrganizationId())
  if (orgId) await auditService.log({ ...event, organizationId: orgId })
}

function passwordPolicy(password: string, email?: string | null, name?: string | null) {
  const result = checkPassword(password, { minLength: config.auth.passwordMinLength, email, name })
  if (!result.valid) throw new ValidationError('Choose a stronger password', { password: result.errors.join('. ') })
}

export const authService = {
  async signIn(input: unknown, meta: RequestMeta): Promise<SignInOutcome> {
    const data = parseInput(signInSchema, input)
    const provider = getAuthProvider()
    if (!provider.configured) {
      return { ok: false, state: 'UNAVAILABLE', message: 'Sign-in isn’t configured for this environment yet.' }
    }

    try {
      await rateLimitService.consume('loginIp', meta.ipAddress ?? 'unknown')
      await rateLimitService.check('loginAccount', data.email)
    } catch (error) {
      await auditAnonymous({
        action: AUDIT_ACTIONS.LOGIN_FAILURE,
        resourceType: 'auth',
        status: 'DENIED',
        metadata: { reason: 'rate_limited', email: maskEmail(data.email) },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      })
      return { ok: false, state: 'RATE_LIMITED', message: (error as Error).message }
    }

    const result = await provider.signInWithPassword(data.email, data.password)
    const appUser = await prisma.user.findFirst({
      where: { email: data.email },
      select: { id: true, organization_id: true },
    })

    if (!result.ok) {
      if (result.reason === 'email_not_confirmed') {
        // The provider only reports this after the password matched.
        return {
          ok: false,
          state: 'EMAIL_UNVERIFIED',
          message: 'Confirm your email address to sign in. Check your inbox for the link.',
        }
      }
      if (result.reason === 'unavailable') {
        return {
          ok: false,
          state: 'UNAVAILABLE',
          message: 'Sign-in is temporarily unavailable. Please try again shortly.',
        }
      }
      await rateLimitService.consume('loginAccount', data.email).catch(() => undefined)
      await auditAnonymous(
        {
          actorUserId: appUser?.id ?? null,
          action: AUDIT_ACTIONS.LOGIN_FAILURE,
          resourceType: 'auth',
          status: 'FAILURE',
          metadata: { reason: result.reason, email: maskEmail(data.email), knownAccount: Boolean(appUser) },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
        appUser?.organization_id,
      )
      if (result.reason === 'rate_limited') {
        return { ok: false, state: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' }
      }
      return { ok: false, state: 'INVALID', message: GENERIC_LOGIN_ERROR }
    }

    // Credentials are valid. Now decide whether the application account may be used.
    const record = await identityRepository.findByAuthUserId(result.user.id)
    const deny = async (state: Exclude<SignInOutcome, { ok: true }>['state'], message: string, reason: string) => {
      await provider.signOut('local')
      await auditAnonymous(
        {
          actorUserId: record?.id ?? null,
          action: AUDIT_ACTIONS.LOGIN_FAILURE,
          resourceType: 'auth',
          status: 'DENIED',
          metadata: { reason },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
        record?.organization_id,
      )
      return { ok: false as const, state, message } as SignInOutcome
    }

    if (!record || record.status === 'INVITED') {
      return deny(
        'PROFILE_INCOMPLETE',
        'Your sign-in works, but your Intern OS profile isn’t set up yet. Contact HR.',
        'no_profile',
      )
    }
    if (record.deleted_at || record.status === 'INACTIVE') {
      return deny(
        'ACCOUNT_INACTIVE',
        'This account is no longer active. Contact HR if you think this is a mistake.',
        'inactive',
      )
    }
    if (record.status === 'SUSPENDED') {
      return deny('ACCOUNT_SUSPENDED', 'This account has been suspended. Contact an administrator.', 'suspended')
    }

    await identityRepository.recordLogin(record.id, result.user.emailConfirmedAt)
    if (result.sessionId) {
      await sessionRepository.touch({
        authSessionId: result.sessionId,
        userId: record.id,
        organizationId: record.organization_id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      })
    }
    await rateLimitService.reset('loginAccount', data.email).catch(() => undefined)
    await auditService.log({
      organizationId: record.organization_id,
      actorUserId: record.id,
      action: AUDIT_ACTIONS.LOGIN_SUCCESS,
      resourceType: 'auth',
      resourceId: result.sessionId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    })

    const unverified =
      config.auth.requireEmailVerification && !result.user.emailConfirmedAt && !record.email_verified_at
    return { ok: true, redirectTo: unverified ? '/verify-email' : safeNextPath(data.next) }
  },

  async signOut(ctx: RequestContext | null, meta: RequestMeta) {
    if (ctx?.authUser.sessionId) await sessionRepository.revokeByAuthSessionId(ctx.authUser.sessionId, 'signed_out')
    await getAuthProvider().signOut('local')
    if (ctx) {
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.LOGOUT,
        resourceType: 'auth',
        resourceId: ctx.authUser.sessionId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      })
    }
  },

  /** Always resolves the same way, whether or not the email has an account. */
  async requestPasswordReset(input: unknown, meta: RequestMeta) {
    const { email } = parseInput(z.object({ email: emailSchema }), input)
    await rateLimitService.consume('passwordReset', `ip:${meta.ipAddress ?? 'unknown'}`)
    await rateLimitService.consume('passwordReset', `email:${email}`)
    await getAuthProvider().requestPasswordReset(email, `${config.app.url}/auth/confirm?next=/reset-password`)
    const appUser = await prisma.user.findFirst({ where: { email }, select: { id: true, organization_id: true } })
    await auditAnonymous(
      {
        actorUserId: appUser?.id ?? null,
        action: AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED,
        resourceType: 'auth',
        metadata: { email: maskEmail(email), knownAccount: Boolean(appUser) },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
      appUser?.organization_id,
    )
  },

  /** Sets a new password using the recovery session created by the reset link. */
  async completePasswordReset(input: unknown, meta: RequestMeta) {
    const data = parseInput(
      z
        .object({ password: z.string().min(1, 'Enter a new password').max(128), confirmPassword: z.string() })
        .refine((value) => value.password === value.confirmPassword, {
          message: 'Passwords don’t match',
          path: ['confirmPassword'],
        }),
      input,
    )
    const provider = getAuthProvider()
    const session = await provider.getSession()
    if (!session) throw new AppError('UNAUTHENTICATED', 'This reset link is invalid or has expired. Request a new one.')
    const record = await identityRepository.findByAuthUserId(session.authUserId)
    passwordPolicy(data.password, session.email, record?.first_name)

    const result = await provider.updatePassword(data.password)
    if (!result.ok) {
      if (result.reason === 'same_password')
        throw new ValidationError('Choose a password you haven’t used before', { password: 'Same as current password' })
      if (result.reason === 'weak_password')
        throw new ValidationError('Choose a stronger password', { password: 'Too weak' })
      if (result.reason === 'no_session')
        throw new AppError('UNAUTHENTICATED', 'This reset link is invalid or has expired. Request a new one.')
      throw new AppError('INTERNAL_ERROR', 'We couldn’t update your password. Please try again.')
    }
    // Everyone else using the old password is signed out.
    await provider.signOut('others')
    if (record) {
      await sessionRepository.revokeAllForUser(record.id, 'password_reset', session.sessionId)
      await auditService.log({
        organizationId: record.organization_id,
        actorUserId: record.id,
        action: AUDIT_ACTIONS.PASSWORD_RESET_COMPLETED,
        resourceType: 'auth',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      })
    }
  },

  async changePassword(ctx: RequestContext, input: unknown, meta: RequestMeta) {
    const data = parseInput(
      z
        .object({
          currentPassword: z.string().min(1, 'Enter your current password').max(128),
          password: z.string().min(1, 'Enter a new password').max(128),
          confirmPassword: z.string(),
        })
        .refine((value) => value.password === value.confirmPassword, {
          message: 'Passwords don’t match',
          path: ['confirmPassword'],
        }),
      input,
    )
    await rateLimitService.consume('passwordChange', ctx.actor.userId)
    const provider = getAuthProvider()
    if (!(await provider.verifyPassword(ctx.actor.email, data.currentPassword))) {
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.PASSWORD_CHANGED,
        resourceType: 'auth',
        status: 'FAILURE',
        metadata: { reason: 'wrong_current_password' },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      })
      throw new ValidationError('Current password is incorrect', { currentPassword: 'Incorrect password' })
    }
    passwordPolicy(data.password, ctx.actor.email, ctx.actor.displayName)
    const result = await provider.updatePassword(data.password)
    if (!result.ok) {
      if (result.reason === 'same_password')
        throw new ValidationError('Choose a different password', { password: 'Same as current password' })
      if (result.reason === 'weak_password')
        throw new ValidationError('Choose a stronger password', { password: 'Too weak' })
      throw new AppError('INTERNAL_ERROR', 'We couldn’t update your password. Please try again.')
    }
    await provider.signOut('others')
    await sessionRepository.revokeAllForUser(ctx.actor.userId, 'password_changed', ctx.authUser.sessionId)
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.PASSWORD_CHANGED,
      resourceType: 'auth',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    })
  },

  /** Resends the verification email for the signed-in (unverified) user. */
  async resendVerification(meta: RequestMeta) {
    const provider = getAuthProvider()
    const session = await provider.getSession()
    if (!session?.email) throw new AppError('UNAUTHENTICATED', 'Sign in again to resend the verification email.')
    await rateLimitService.consume('verificationResend', session.authUserId)
    await provider.resendVerification(session.email, `${config.app.url}/auth/confirm?next=/`)
    const record = await identityRepository.findByAuthUserId(session.authUserId)
    if (record) {
      await auditService.log({
        organizationId: record.organization_id,
        actorUserId: record.id,
        action: AUDIT_ACTIONS.VERIFICATION_RESENT,
        resourceType: 'auth',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      })
    }
  },

  /**
   * Handles links from auth emails (password reset, email confirmation).
   * Accepts `token_hash` + `type` (recommended email templates) or a PKCE
   * `code`. Returns where to send the browser next.
   */
  async confirmLink(params: { tokenHash?: string; type?: string; code?: string; next?: string }, meta: RequestMeta) {
    const types: LinkType[] = ['recovery', 'signup', 'email', 'invite', 'magiclink', 'email_change']
    const type = types.find((candidate) => candidate === params.type)
    const next = safeNextPath(params.next)
    const wantsReset = params.type === 'recovery' || params.next === '/reset-password'

    const result = await getAuthProvider().exchangeLink({ tokenHash: params.tokenHash, type, code: params.code })
    if (!result.ok) {
      logger.info('Auth link rejected', { reason: result.reason, type: params.type ?? 'code' })
      return wantsReset ? `/reset-password?error=${result.reason}` : `/login?error=link_${result.reason}`
    }

    const record = await identityRepository.findByAuthUserId(result.user.id)
    if (record && result.user.emailConfirmedAt && !record.email_verified_at) {
      await identityRepository.markEmailVerified(record.id, result.user.emailConfirmedAt)
      await auditService.log({
        organizationId: record.organization_id,
        actorUserId: record.id,
        action: AUDIT_ACTIONS.EMAIL_VERIFIED,
        resourceType: 'auth',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      })
    }
    if (record && result.sessionId) {
      await sessionRepository.touch({
        authSessionId: result.sessionId,
        userId: record.id,
        organizationId: record.organization_id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      })
    }
    return wantsReset ? '/reset-password' : next
  },
}
