import { PERMISSIONS, ROLE_PERMISSIONS, SYSTEM_ROLES, canAssignRole, permissionsForRole, roleHasPermission } from './permissions'
export type { Permission, SystemRole } from './permissions'
export { authorize, actorHasPermission, canAccessScopedResource, assertNoClientPrivilegeFields } from './authorize'
export type { AuthorizeInput, AuthorizeResult, AuthorizationActor, ResourceScope } from './authorize'
export { PERMISSIONS, ROLE_PERMISSIONS, SYSTEM_ROLES, canAssignRole, permissionsForRole, roleHasPermission }
