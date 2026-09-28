import { scopeRank, type PermissionKey, type PermissionScope } from './catalog'
import type { PermissionSet } from './index'

/**
 * Central authorization engine (pure — no I/O, fully unit-tested).
 *
 *   authorize({ actor, permission, resource? }) → { decision: 'ALLOWED' | 'DENIED', … }
 *
 * Layers, in order:
 *   1. authentication  — an actor exists and is active (resolved upstream)
 *   2. organization    — the resource belongs to the actor's organization
 *   3/4. role + permission — the actor's roles grant the permission
 *   5. resource scope  — the resource lies within the grant's scope
 *
 * The same scope semantics are implemented as database filters in
 * src/server/repositories/scope.ts so list queries and single-record checks
 * can never disagree.
 */

export interface AuthorizationActor {
  userId: string
  organizationId: string
  permissions: PermissionSet
  /** Teams the actor leads. */
  ledTeamIds: readonly string[]
  /** Departments the actor heads. */
  headedDepartmentIds: readonly string[]
}

/** Placement of an intern whose record (or work) the resource concerns. */
export interface InternRelation {
  managerId: string | null
  mentorId: string | null
  teamId: string | null
  departmentId: string | null
}

/**
 * Facts about a resource, relative to which scope is evaluated.
 * - `ownerUserIds`: users the record belongs to or is assigned to (the
 *   subject of a profile/attendance/leave record, task assignees and creator,
 *   project owner and members).
 * - `interns`: placements of the interns among those users.
 */
export interface ResourceFacts {
  organizationId: string
  ownerUserIds?: readonly (string | null | undefined)[]
  interns?: readonly InternRelation[]
}

export type DenialLayer = 'organization' | 'permission' | 'scope'

export type AuthorizationResult =
  | { decision: 'ALLOWED'; allowed: true; scope: PermissionScope | null }
  | { decision: 'DENIED'; allowed: false; layer: DenialLayer; reason: string }

/** Does `facts` fall within `scope` for this actor? Broader scopes include narrower ones. */
export function withinScope(actor: AuthorizationActor, scope: PermissionScope, facts: ResourceFacts): boolean {
  if (facts.organizationId !== actor.organizationId) return false
  const rank = scopeRank(scope)
  const interns = facts.interns ?? []

  if (rank >= scopeRank('ORGANIZATION')) return true
  if (
    rank >= scopeRank('DEPARTMENT') &&
    interns.some((i) => i.departmentId && actor.headedDepartmentIds.includes(i.departmentId))
  ) {
    return true
  }
  if (rank >= scopeRank('TEAM') && interns.some((i) => i.teamId && actor.ledTeamIds.includes(i.teamId))) return true
  if (
    rank >= scopeRank('ASSIGNED') &&
    interns.some((i) => i.managerId === actor.userId || i.mentorId === actor.userId)
  ) {
    return true
  }
  return (facts.ownerUserIds ?? []).some((id) => id === actor.userId)
}

export function authorize(input: {
  actor: AuthorizationActor
  permission: PermissionKey
  resource?: ResourceFacts
}): AuthorizationResult {
  const { actor, permission, resource } = input

  if (resource && resource.organizationId !== actor.organizationId) {
    return {
      decision: 'DENIED',
      allowed: false,
      layer: 'organization',
      reason: 'Resource belongs to another organization',
    }
  }

  const scope = actor.permissions.get(permission)
  if (!scope) {
    return { decision: 'DENIED', allowed: false, layer: 'permission', reason: `Missing permission ${permission}` }
  }

  if (resource && !withinScope(actor, scope, resource)) {
    return { decision: 'DENIED', allowed: false, layer: 'scope', reason: `Resource is outside ${scope} scope` }
  }

  return { decision: 'ALLOWED', allowed: true, scope: resource ? scope : null }
}
