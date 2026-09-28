import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { getAuthProvider, type AuthSession } from '@/lib/auth/provider'
import { config } from '@/lib/config'
import { AppError, UnauthenticatedError } from '@/lib/errors'
import { getRequestMeta } from '@/lib/http/request-meta'
import { widerScope, type PermissionScope } from '@/lib/permissions'
import type { AuthorizationActor } from '@/lib/permissions/engine'
import { fullName } from '@/lib/utils/format'
import { identityRepository, type ActorRecord } from './repositories/identity.repository'
import { sessionRepository } from './repositories/session.repository'

/**
 * The authenticated-user resolver.
 *
 * Authentication (who are you?) comes from the auth provider's session.
 * Everything that governs authorization — organization, account status,
 * roles, permission grants and their scopes — comes from our database and is
 * resolved here on the server. Nothing is taken from the client.
 */
export interface Actor extends AuthorizationActor {
  email: string
  displayName: string
  avatarUrl: string | null
  roles: { id: string; slug: string; name: string; rank: number }[]
  /** Highest role rank held — bounds which roles this actor may assign. */
  rank: number
}

export interface CurrentOrganization {
  id: string
  name: string
  slug: string
  timezone: string
  logoUrl: string | null
}

export interface RequestContext {
  actor: Actor
  organization: CurrentOrganization
  authUser: { id: string; email: string | null; sessionId: string | null }
}

export type AuthState =
  | { status: 'AUTHENTICATED'; context: RequestContext }
  | { status: 'UNAUTHENTICATED' }
  | { status: 'SESSION_EXPIRED' }
  | { status: 'ACCOUNT_SUSPENDED'; email: string }
  | { status: 'ACCOUNT_INACTIVE'; email: string }
  | { status: 'PROFILE_INCOMPLETE'; email: string | null }
  | { status: 'EMAIL_UNVERIFIED'; email: string }

export function toRequestContext(
  record: ActorRecord,
  session: Pick<AuthSession, 'authUserId' | 'email' | 'sessionId'>,
): RequestContext {
  const permissions = new Map<string, PermissionScope>()
  const roles: Actor['roles'] = []
  for (const { role } of record.user_roles) {
    // Defense in depth: ignore any role that belongs to another organization.
    if (role.organization_id !== record.organization_id) continue
    roles.push({ id: role.id, slug: role.slug, name: role.name, rank: role.rank })
    for (const grant of role.role_permissions) {
      const key = `${grant.permission.resource}.${grant.permission.action}`
      const current = permissions.get(key)
      permissions.set(key, current ? widerScope(current, grant.scope) : grant.scope)
    }
  }
  roles.sort((a, b) => b.rank - a.rank)
  return {
    actor: {
      userId: record.id,
      organizationId: record.organization_id,
      email: record.email,
      displayName: fullName(record),
      avatarUrl: record.avatar_url,
      roles,
      rank: roles[0]?.rank ?? 0,
      permissions,
      ledTeamIds: record.teams_led.map((team) => team.id),
      headedDepartmentIds: record.departments_led.map((department) => department.id),
    },
    organization: {
      id: record.organization.id,
      name: record.organization.name,
      slug: record.organization.slug,
      timezone: record.organization.timezone,
      logoUrl: record.organization.logo_url,
    },
    authUser: { id: session.authUserId, email: session.email, sessionId: session.sessionId },
  }
}

/** Classifies an application account. Exported for unit tests. */
export function classifyAccount(
  record: ActorRecord | null,
  session: AuthSession,
  options: { requireEmailVerification: boolean },
): Exclude<AuthState['status'], 'AUTHENTICATED' | 'UNAUTHENTICATED' | 'SESSION_EXPIRED'> | 'OK' {
  if (!record || record.status === 'INVITED') return 'PROFILE_INCOMPLETE'
  if (record.deleted_at || record.status === 'INACTIVE') return 'ACCOUNT_INACTIVE'
  if (record.status === 'SUSPENDED') return 'ACCOUNT_SUSPENDED'
  if (options.requireEmailVerification && !record.email_verified_at && !session.emailVerified) return 'EMAIL_UNVERIFIED'
  return 'OK'
}

/** Resolves the current auth state once per request (memoized). */
export const getAuthState = cache(async (): Promise<AuthState> => {
  // Identity is per request: pages depending on it must never be prerendered.
  await connection()
  const session = await getAuthProvider().getSession()
  if (!session) return { status: 'UNAUTHENTICATED' }

  const record = await identityRepository.findByAuthUserId(session.authUserId)
  const classification = classifyAccount(record, session, {
    requireEmailVerification: config.auth.requireEmailVerification,
  })
  if (classification === 'PROFILE_INCOMPLETE') return { status: 'PROFILE_INCOMPLETE', email: session.email }
  if (!record) return { status: 'PROFILE_INCOMPLETE', email: session.email }
  if (classification !== 'OK') return { status: classification, email: record.email }

  // The provider confirmed the email outside our callback: record it.
  if (!record.email_verified_at && session.emailVerified) {
    await identityRepository.markEmailVerified(record.id, new Date())
  }

  if (session.sessionId) {
    const meta = await getRequestMeta()
    const { revoked } = await sessionRepository.touch({
      authSessionId: session.sessionId,
      userId: record.id,
      organizationId: record.organization_id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    })
    if (revoked) return { status: 'SESSION_EXPIRED' }
  }

  return { status: 'AUTHENTICATED', context: toRequestContext(record, session) }
})

/** The authenticated application user, or null. */
export async function getCurrentUser(): Promise<RequestContext | null> {
  const state = await getAuthState()
  return state.status === 'AUTHENTICATED' ? state.context : null
}

/** Where a non-authenticated state should send the browser. */
export function redirectPathFor(state: Exclude<AuthState, { status: 'AUTHENTICATED' }>, next?: string): string {
  const nextParam = next && next !== '/' ? `&next=${encodeURIComponent(next)}` : ''
  switch (state.status) {
    case 'UNAUTHENTICATED':
      return `/login${nextParam ? `?${nextParam.slice(1)}` : ''}`
    case 'SESSION_EXPIRED':
      // A route handler clears the (revoked) session cookies, then shows login.
      return '/auth/signout?reason=session_expired'
    case 'EMAIL_UNVERIFIED':
      return '/verify-email'
    case 'ACCOUNT_SUSPENDED':
      return '/account-status?state=suspended'
    case 'ACCOUNT_INACTIVE':
      return '/account-status?state=inactive'
    case 'PROFILE_INCOMPLETE':
      return '/account-status?state=profile'
  }
}

/** For pages and layouts: redirects unless the user is fully authenticated. */
export async function requirePageContext(): Promise<RequestContext> {
  const state = await getAuthState()
  if (state.status !== 'AUTHENTICATED') redirect(redirectPathFor(state))
  return state.context
}

/** For route handlers and server actions: 401 when not signed in, 403 for unusable accounts. */
export async function requireApiContext(): Promise<RequestContext> {
  const state = await getAuthState()
  switch (state.status) {
    case 'AUTHENTICATED':
      return state.context
    case 'UNAUTHENTICATED':
      throw new UnauthenticatedError()
    case 'SESSION_EXPIRED':
      throw new UnauthenticatedError('Your session has expired. Please sign in again.')
    case 'EMAIL_UNVERIFIED':
      throw new AppError('FORBIDDEN', 'Verify your email address to continue.')
    default:
      throw new AppError('FORBIDDEN', 'Your account does not have access.')
  }
}
