import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { can, canAny, type PermissionKey, type PermissionScope } from '@/lib/permissions'
import { authorize, type AuthorizationResult, type ResourceFacts } from '@/lib/permissions/engine'
import { logger } from '@/lib/logging'
import type { RequestContext } from '../context'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditRepository } from '../repositories/audit.repository'

/**
 * Authorization for services — the only place access decisions are made.
 * Permissions and scopes come from the database via the request context;
 * nothing here knows role names.
 *
 *   require(ctx, perm)                → permission check (throws 403)
 *   scope(ctx, perm)                  → the granted scope, for scoped queries
 *   authorizeResource(ctx, perm, rf)  → full decision for one record
 *
 * Out-of-scope or cross-organization records are reported as 404 so their
 * existence isn't revealed. Denials are written to the audit log.
 */
function recordDenial(ctx: RequestContext, permission: string, reason: string, resourceId?: string | null) {
  // Fire-and-forget: a denial must never be delayed or blocked by logging.
  void auditRepository
    .create({
      organization_id: ctx.organization.id,
      actor_user_id: ctx.actor.userId,
      action: AUDIT_ACTIONS.ACCESS_DENIED,
      resource_type: permission.split('.')[0],
      resource_id: resourceId ?? null,
      status: 'DENIED',
      metadata: { permission, reason },
    })
    .catch((error) => logger.warn('Could not record access denial', { error }))
}

export const authorizationService = {
  can(ctx: RequestContext, permission: PermissionKey): boolean {
    return can(ctx.actor.permissions, permission)
  },

  canAny(ctx: RequestContext, permissions: readonly PermissionKey[]): boolean {
    return canAny(ctx.actor.permissions, permissions)
  },

  /** The scope the actor holds for a permission, or null. */
  scopeOf(ctx: RequestContext, permission: PermissionKey): PermissionScope | null {
    return ctx.actor.permissions.get(permission) ?? null
  },

  /** Throws 403 unless the permission is granted; returns its scope. */
  require(ctx: RequestContext, permission: PermissionKey): PermissionScope {
    const scope = ctx.actor.permissions.get(permission)
    if (!scope) {
      recordDenial(ctx, permission, 'missing_permission')
      throw new ForbiddenError()
    }
    return scope
  },

  /** Full decision for a specific record (organization, permission, scope). */
  decide(ctx: RequestContext, permission: PermissionKey, resource: ResourceFacts): AuthorizationResult {
    return authorize({ actor: ctx.actor, permission, resource })
  },

  /**
   * Throws unless the actor may perform `permission` on the resource.
   * Organization and scope denials surface as 404 (not found), permission
   * denials as 403.
   */
  authorizeResource(
    ctx: RequestContext,
    permission: PermissionKey,
    resource: ResourceFacts,
    options: { resourceType?: string; resourceId?: string | null } = {},
  ) {
    const result = authorize({ actor: ctx.actor, permission, resource })
    if (result.allowed) return result
    recordDenial(ctx, permission, result.reason, options.resourceId)
    if (result.layer === 'permission') throw new ForbiddenError()
    throw new NotFoundError(options.resourceType ?? 'Resource')
  },

  /** Records from another organization are reported as "not found". */
  assertSameOrganization(ctx: RequestContext, record: { organization_id: string } | null, resource = 'Resource') {
    if (!record || record.organization_id !== ctx.organization.id) {
      throw new NotFoundError(resource)
    }
  },
}
