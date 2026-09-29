import 'server-only'
import type { Prisma } from '@prisma/client'
import { scopeRank, type PermissionScope } from '@/lib/permissions'
import type { AuthorizationActor } from '@/lib/permissions/engine'

/**
 * Database filters implementing permission scopes — the query-side twin of
 * `withinScope()` in src/lib/permissions/engine.ts. Every filter also pins the
 * actor's organization, so no scoped query can cross tenants.
 *
 * Use them for lists (so users only ever receive in-scope rows) and for
 * single-record access (`findFirst({ where: { id, ...scope } })`), which makes
 * out-of-scope records indistinguishable from missing ones (404, no leak).
 */

function atLeast(scope: PermissionScope, minimum: PermissionScope) {
  return scopeRank(scope) >= scopeRank(minimum)
}

/** Interns whose placement puts them in the actor's scope (excluding OWN). */
function internPlacementConditions(actor: AuthorizationActor, scope: PermissionScope): Prisma.InternWhereInput[] {
  const conditions: Prisma.InternWhereInput[] = []
  if (atLeast(scope, 'ASSIGNED')) conditions.push({ manager_id: actor.userId }, { mentor_id: actor.userId })
  if (atLeast(scope, 'TEAM') && actor.ledTeamIds.length) conditions.push({ team_id: { in: [...actor.ledTeamIds] } })
  if (atLeast(scope, 'DEPARTMENT') && actor.headedDepartmentIds.length) {
    conditions.push({ department_id: { in: [...actor.headedDepartmentIds] } })
  }
  return conditions
}

/** Users whose records (profile, attendance, leave, …) are within scope. */
export function userScope(actor: AuthorizationActor, scope: PermissionScope): Prisma.UserWhereInput {
  const base = { organization_id: actor.organizationId }
  if (atLeast(scope, 'ORGANIZATION')) return base
  const placement = internPlacementConditions(actor, scope)
  return {
    ...base,
    OR: [{ id: actor.userId }, ...(placement.length ? [{ intern: { is: { OR: placement } } }] : [])],
  }
}

/** Intern records within scope. */
export function internScope(actor: AuthorizationActor, scope: PermissionScope): Prisma.InternWhereInput {
  const base = { organization_id: actor.organizationId }
  if (atLeast(scope, 'ORGANIZATION')) return base
  return { ...base, OR: [{ user_id: actor.userId }, ...internPlacementConditions(actor, scope)] }
}

/**
 * Tasks within scope: created by or assigned to an in-scope user, or (ASSIGNED
 * and wider) in a project the actor belongs to or leads.
 */
export function taskScope(actor: AuthorizationActor, scope: PermissionScope): Prisma.TaskWhereInput {
  const base = { organization_id: actor.organizationId }
  if (atLeast(scope, 'ORGANIZATION')) return base
  const conditions: Prisma.TaskWhereInput[] = [
    { created_by: actor.userId },
    { assignees: { some: { user: userScope(actor, scope) } } },
  ]
  if (atLeast(scope, 'ASSIGNED')) conditions.push({ project: projectMembership(actor) })
  return { ...base, OR: conditions }
}

/** Projects the actor owns, manages or is a member of. */
function projectMembership(actor: AuthorizationActor): Prisma.ProjectWhereInput {
  return {
    OR: [{ owner_id: actor.userId }, { manager_id: actor.userId }, { members: { some: { user_id: actor.userId } } }],
  }
}

/** Projects within scope: owned by or with a member who is an in-scope user. */
export function projectScope(actor: AuthorizationActor, scope: PermissionScope): Prisma.ProjectWhereInput {
  const base = { organization_id: actor.organizationId }
  if (atLeast(scope, 'ORGANIZATION')) return base
  return {
    ...base,
    OR: [
      { owner_id: actor.userId },
      { manager_id: actor.userId },
      { members: { some: { user: userScope(actor, scope) } } },
    ],
  }
}
