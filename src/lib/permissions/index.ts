export {
  PERMISSION_CATALOG,
  PERMISSION_DEFINITIONS,
  ALL_PERMISSIONS,
  PERMISSION_SCOPES,
  SYSTEM_ROLES,
  DEFAULT_ROLE_GRANTS,
  isPermissionKey,
  permissionKey,
  scopeRank,
  widerScope,
} from './catalog'
export type { PermissionKey, PermissionDefinition, PermissionScope, RoleGrants, SystemRoleSlug } from './catalog'

import { scopeRank, type PermissionKey, type PermissionScope } from './catalog'

/** A resolved permission set for one user: permission key → broadest granted scope. */
export type PermissionSet = ReadonlyMap<string, PermissionScope>

export function can(permissions: PermissionSet, permission: PermissionKey): boolean {
  return permissions.has(permission)
}

export function canAny(permissions: PermissionSet, required: readonly PermissionKey[]): boolean {
  return required.some((permission) => permissions.has(permission))
}

export function canAll(permissions: PermissionSet, required: readonly PermissionKey[]): boolean {
  return required.every((permission) => permissions.has(permission))
}

/** The scope a permission is granted with, or null when not granted. */
export function scopeOf(permissions: PermissionSet, permission: PermissionKey): PermissionScope | null {
  return permissions.get(permission) ?? null
}

/** True when the permission is granted with at least `minimum` scope. */
export function canWithScope(permissions: PermissionSet, permission: PermissionKey, minimum: PermissionScope): boolean {
  const scope = permissions.get(permission)
  return scope !== undefined && scopeRank(scope) >= scopeRank(minimum)
}
