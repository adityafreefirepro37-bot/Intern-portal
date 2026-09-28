import { z } from 'zod'
import { getAuthProvider } from '@/lib/auth/provider'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { describeUserAgent } from '@/lib/http/request-meta'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { sessionRepository } from '../repositories/session.repository'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'

/**
 * The signed-in user's own sessions (devices).
 *
 * What is recorded is only what the application observes itself: when a
 * session was first and last seen, and the browser/IP at that time. Revoking
 * a session marks it revoked here — the request context then rejects it on its
 * next request — and "sign out other sessions" also revokes the provider's
 * refresh tokens for them.
 */
export const sessionService = {
  async listOwn(ctx: RequestContext) {
    const rows = await sessionRepository.listActiveForUser(ctx.actor.userId)
    return rows.map(({ auth_session_id, ...row }) => ({
      ...row,
      device: describeUserAgent(row.user_agent),
      current: auth_session_id === ctx.authUser.sessionId,
    }))
  },

  async revoke(ctx: RequestContext, sessionId: string) {
    const id = parseInput(z.uuid(), sessionId)
    const sessions = await sessionRepository.listActiveForUser(ctx.actor.userId)
    const target = sessions.find((session) => session.id === id)
    // Another user's session id is reported exactly like a missing one.
    if (!target) throw new NotFoundError('Session')
    if (target.auth_session_id === ctx.authUser.sessionId) {
      throw new ValidationError('Use “Sign out” to end the session you are using')
    }
    await sessionRepository.revokeById(ctx.actor.userId, id, 'revoked_by_user')
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.SESSION_REVOKED,
      resourceType: 'session',
      resourceId: id,
      metadata: { scope: 'single' },
    })
  },

  async revokeOthers(ctx: RequestContext) {
    await getAuthProvider().signOut('others')
    const { count } = await sessionRepository.revokeAllForUser(
      ctx.actor.userId,
      'revoked_by_user',
      ctx.authUser.sessionId,
    )
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.SESSION_REVOKED,
      resourceType: 'session',
      metadata: { scope: 'others', count },
    })
    return { count }
  },
}
