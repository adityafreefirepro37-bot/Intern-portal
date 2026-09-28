import type { AuditStatus, Prisma } from '@prisma/client'
import { logger, redact } from '@/lib/logging'
import type { Pagination } from '@/lib/validation'
import type { RequestContext } from '../context'
import { auditRepository, type AuditFilter } from '../repositories/audit.repository'
import { authorizationService } from './authorization.service'
import { toPage } from './pagination'

/**
 * Server-side audit trail. Call from services after security-relevant events:
 *
 *   await auditService.logForContext(ctx, { action: AUDIT_ACTIONS.USER_SUSPENDED,
 *                                          resourceType: 'user', resourceId: user.id })
 *
 * Metadata is redacted with the logger's rules; never put passwords, tokens,
 * document contents or unnecessary personal data in it. Audit failures are
 * logged but never break the user's operation.
 */
export interface AuditEvent {
  organizationId: string
  actorUserId?: string | null
  action: string
  resourceType: string
  resourceId?: string | null
  status?: AuditStatus
  metadata?: Record<string, unknown>
  ipAddress?: string | null
  userAgent?: string | null
}

export const auditService = {
  async log(event: AuditEvent): Promise<void> {
    try {
      await auditRepository.create({
        organization_id: event.organizationId,
        actor_user_id: event.actorUserId ?? null,
        action: event.action,
        resource_type: event.resourceType,
        resource_id: event.resourceId ?? null,
        status: event.status ?? 'SUCCESS',
        metadata: event.metadata ? (redact(event.metadata) as Prisma.InputJsonValue) : undefined,
        ip_address: event.ipAddress ?? null,
        user_agent: event.userAgent?.slice(0, 512) ?? null,
      })
    } catch (error) {
      logger.error('Failed to write audit log', {
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        error,
      })
    }
  },

  /** Convenience wrapper that takes organization and actor from the context. */
  logForContext(ctx: RequestContext, event: Omit<AuditEvent, 'organizationId' | 'actorUserId'>) {
    return this.log({ ...event, organizationId: ctx.organization.id, actorUserId: ctx.actor.userId })
  },

  async listPage(ctx: RequestContext, pagination: Pagination, filter: AuditFilter = {}) {
    authorizationService.require(ctx, 'audit_log.read')
    const [items, total] = await auditRepository.listPage(
      ctx.organization.id,
      filter,
      (pagination.page - 1) * pagination.pageSize,
      pagination.pageSize,
    )
    return toPage(items, total, pagination)
  },

  async listActors(ctx: RequestContext) {
    authorizationService.require(ctx, 'audit_log.read')
    return auditRepository.listActors(ctx.organization.id)
  },
}
