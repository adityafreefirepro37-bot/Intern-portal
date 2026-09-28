import 'server-only'
import type { AuthError, SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logging'
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
  createSupabaseStatelessClient,
  isSupabaseConfigured,
} from './supabase'

/**
 * Authentication provider boundary. Services depend on this interface, not on
 * Supabase directly, so auth logic can be unit/integration tested with a fake
 * provider and the provider could be swapped without touching business rules.
 *
 * Every method returns normalized, non-sensitive results — never raw tokens.
 */
export interface AuthSession {
  authUserId: string
  email: string | null
  /** Provider session id (JWT `session_id`), used for device tracking/revocation. */
  sessionId: string | null
  emailVerified: boolean
}

export interface AuthUser {
  id: string
  email: string | null
  emailConfirmedAt: Date | null
}

export type SignInResult =
  | { ok: true; user: AuthUser; sessionId: string | null }
  | { ok: false; reason: 'invalid_credentials' | 'email_not_confirmed' | 'rate_limited' | 'unavailable' }

export type LinkType = 'recovery' | 'signup' | 'email' | 'invite' | 'magiclink' | 'email_change'

export type ExchangeResult =
  { ok: true; user: AuthUser; sessionId: string | null } | { ok: false; reason: 'expired' | 'invalid' }

export type SignUpResult =
  | { ok: true; userId: string; sessionCreated: boolean; emailConfirmedAt: Date | null }
  | { ok: false; reason: 'already_registered' | 'weak_password' | 'rate_limited' | 'unavailable' }

export type UpdatePasswordResult =
  | { ok: true }
  | { ok: false; reason: 'no_session' | 'weak_password' | 'same_password' | 'reauthentication_needed' | 'unavailable' }

export interface AuthProvider {
  readonly configured: boolean
  getSession(): Promise<AuthSession | null>
  signInWithPassword(email: string, password: string): Promise<SignInResult>
  signOut(scope: 'local' | 'others' | 'global'): Promise<void>
  /** Verifies a password without creating or changing any session. */
  verifyPassword(email: string, password: string): Promise<boolean>
  requestPasswordReset(email: string, redirectTo: string): Promise<void>
  updatePassword(newPassword: string): Promise<UpdatePasswordResult>
  exchangeLink(params: { tokenHash?: string; type?: LinkType; code?: string }): Promise<ExchangeResult>
  signUp(email: string, password: string, redirectTo: string): Promise<SignUpResult>
  resendVerification(email: string, redirectTo: string): Promise<void>
  /** Blocks (or unblocks) sign-in and token refresh at the provider. Requires service role. */
  setBlocked(authUserId: string, blocked: boolean): Promise<boolean>
}

function toAuthUser(user: { id: string; email?: string | null; email_confirmed_at?: string | null }): AuthUser {
  return {
    id: user.id,
    email: user.email ?? null,
    emailConfirmedAt: user.email_confirmed_at ? new Date(user.email_confirmed_at) : null,
  }
}

function errorCode(error: AuthError | null | undefined): string | undefined {
  return (error as (AuthError & { code?: string }) | null | undefined)?.code
}

async function currentSessionId(client: SupabaseClient): Promise<string | null> {
  const { data } = await client.auth.getClaims()
  return (data?.claims?.session_id as string | undefined) ?? null
}

class SupabaseAuthProvider implements AuthProvider {
  readonly configured = true

  async getSession(): Promise<AuthSession | null> {
    const client = await createSupabaseServerClient()
    const { data, error } = await client.auth.getClaims()
    if (error || !data?.claims?.sub) return null
    const claims = data.claims
    const metadata = (claims.user_metadata ?? {}) as { email_verified?: boolean }
    return {
      authUserId: claims.sub,
      email: (claims.email as string | undefined) ?? null,
      sessionId: (claims.session_id as string | undefined) ?? null,
      emailVerified: metadata.email_verified === true,
    }
  }

  async signInWithPassword(email: string, password: string): Promise<SignInResult> {
    const client = await createSupabaseServerClient()
    const { data, error } = await client.auth.signInWithPassword({ email, password })
    if (error || !data.user) {
      const code = errorCode(error)
      if (code === 'email_not_confirmed') return { ok: false, reason: 'email_not_confirmed' }
      if (code === 'over_request_rate_limit' || error?.status === 429) return { ok: false, reason: 'rate_limited' }
      if (error?.status && error.status >= 500) {
        logger.error('Auth provider unavailable during sign-in', { status: error.status, code })
        return { ok: false, reason: 'unavailable' }
      }
      return { ok: false, reason: 'invalid_credentials' }
    }
    return { ok: true, user: toAuthUser(data.user), sessionId: await currentSessionId(client) }
  }

  async signOut(scope: 'local' | 'others' | 'global'): Promise<void> {
    const client = await createSupabaseServerClient()
    const { error } = await client.auth.signOut({ scope })
    if (error) logger.warn('Sign-out reported an error', { scope, code: errorCode(error) })
  }

  async verifyPassword(email: string, password: string): Promise<boolean> {
    const client = createSupabaseStatelessClient()
    const { data, error } = await client.auth.signInWithPassword({ email, password })
    if (error || !data.session) return false
    // Discard the throwaway session so it doesn't linger at the provider.
    await client.auth.signOut({ scope: 'local' }).catch(() => undefined)
    return true
  }

  async requestPasswordReset(email: string, redirectTo: string): Promise<void> {
    const client = await createSupabaseServerClient()
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo })
    // Deliberately not surfaced: the caller always shows the same message.
    if (error)
      logger.warn('Password reset request failed at provider', { code: errorCode(error), status: error.status })
  }

  async updatePassword(newPassword: string): Promise<UpdatePasswordResult> {
    const client = await createSupabaseServerClient()
    const { data } = await client.auth.getClaims()
    if (!data?.claims?.sub) return { ok: false, reason: 'no_session' }
    const { error } = await client.auth.updateUser({ password: newPassword })
    if (!error) return { ok: true }
    const code = errorCode(error)
    if (code === 'weak_password') return { ok: false, reason: 'weak_password' }
    if (code === 'same_password') return { ok: false, reason: 'same_password' }
    if (code === 'reauthentication_needed') return { ok: false, reason: 'reauthentication_needed' }
    logger.warn('Password update failed at provider', { code, status: error.status })
    return { ok: false, reason: 'unavailable' }
  }

  async exchangeLink(params: { tokenHash?: string; type?: LinkType; code?: string }): Promise<ExchangeResult> {
    const client = await createSupabaseServerClient()
    const result =
      params.tokenHash && params.type
        ? await client.auth.verifyOtp({ token_hash: params.tokenHash, type: params.type })
        : params.code
          ? await client.auth.exchangeCodeForSession(params.code)
          : null
    if (!result) return { ok: false, reason: 'invalid' }
    const { data, error } = result
    if (error || !data.user) {
      const code = errorCode(error)
      return { ok: false, reason: code === 'otp_expired' || code === 'flow_state_expired' ? 'expired' : 'invalid' }
    }
    return { ok: true, user: toAuthUser(data.user), sessionId: await currentSessionId(client) }
  }

  async signUp(email: string, password: string, redirectTo: string): Promise<SignUpResult> {
    const client = await createSupabaseServerClient()
    const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } })
    if (error || !data.user) {
      const code = errorCode(error)
      if (code === 'user_already_exists' || code === 'email_exists') return { ok: false, reason: 'already_registered' }
      if (code === 'weak_password') return { ok: false, reason: 'weak_password' }
      if (code === 'over_email_send_rate_limit' || error?.status === 429) return { ok: false, reason: 'rate_limited' }
      logger.warn('Sign-up failed at provider', { code, status: error?.status })
      return { ok: false, reason: 'unavailable' }
    }
    // With email confirmation on, Supabase returns an obfuscated user without
    // identities when the address is already registered.
    if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return { ok: false, reason: 'already_registered' }
    }
    return {
      ok: true,
      userId: data.user.id,
      sessionCreated: Boolean(data.session),
      emailConfirmedAt: data.user.email_confirmed_at ? new Date(data.user.email_confirmed_at) : null,
    }
  }

  async resendVerification(email: string, redirectTo: string): Promise<void> {
    const client = await createSupabaseServerClient()
    const { error } = await client.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo } })
    if (error) logger.warn('Verification resend failed at provider', { code: errorCode(error), status: error.status })
  }

  async setBlocked(authUserId: string, blocked: boolean): Promise<boolean> {
    const admin = createSupabaseAdminClient()
    if (!admin) return false
    const { error } = await admin.auth.admin.updateUserById(authUserId, {
      ban_duration: blocked ? '876000h' : 'none',
    })
    if (error) {
      logger.error('Could not update provider ban state', { blocked, code: errorCode(error) })
      return false
    }
    return true
  }
}

/** Used when Supabase is not configured: nobody can authenticate. */
class UnconfiguredAuthProvider implements AuthProvider {
  readonly configured = false
  async getSession() {
    return null
  }
  async signInWithPassword(): Promise<SignInResult> {
    return { ok: false, reason: 'unavailable' }
  }
  async signOut() {}
  async verifyPassword() {
    return false
  }
  async requestPasswordReset() {}
  async updatePassword(): Promise<UpdatePasswordResult> {
    return { ok: false, reason: 'unavailable' }
  }
  async exchangeLink(): Promise<ExchangeResult> {
    return { ok: false, reason: 'invalid' }
  }
  async signUp(): Promise<SignUpResult> {
    return { ok: false, reason: 'unavailable' }
  }
  async resendVerification() {}
  async setBlocked() {
    return false
  }
}

let override: AuthProvider | null = null

export function getAuthProvider(): AuthProvider {
  if (override) return override
  return isSupabaseConfigured() ? new SupabaseAuthProvider() : new UnconfiguredAuthProvider()
}

/** Test seam: replace the provider (never used by application code). */
export function setAuthProviderForTesting(provider: AuthProvider | null) {
  if (process.env.NODE_ENV === 'production') throw new Error('Auth provider override is test-only')
  override = provider
}
