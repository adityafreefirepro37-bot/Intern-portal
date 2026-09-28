import {
  type Permission,
  type SystemRole,
  roleHasPermission,
} from './permissions'

export type AuthorizationDecision = 'ALLOWED' | 'DENIED'

export type AccountLifecycle = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'INACTIVE' | 'DELETED'

export interface AuthorizationActor {
  id: string
  organizationId: string
  role: SystemRole | string
  status: AccountLifecycle
  isActive: boolean
  departmentId?: string | null
  teamId?: string | null
  permissions?: Permission[]
}

export interface ResourceScope {
  type: string
  id: string
  organizationId: string
  ownerUserId?: string | null
  internUserId?: string | null
  managerId?: string | null
  mentorId?: string | null
  departmentId?: string | null
  teamId?: string | null
  assignedToUserId?: string | null
  createdByUserId?: string | null
  memberUserIds?: string[]
}

export interface AuthorizeInput {
  user: AuthorizationActor
  permission: Permission
  resource?: ResourceScope
}

export interface AuthorizeResult {
  decision: AuthorizationDecision
  allowed: boolean
  reason?: string
  layer?:
    | 'authentication'
    | 'account'
    | 'organization'
    | 'role'
    | 'permission'
    | 'resource'
}

const ORG_WIDE_ROLES: ReadonlySet<string> = new Set(['SUPER_ADMIN', 'ADMIN', 'HR'])

export function isAccountUsable(user: AuthorizationActor): AuthorizeResult {
  if (user.status === 'DELETED' || Boolean((user as { deletedAt?: Date | null }).deletedAt)) {
    return {
      decision: 'DENIED',
      allowed: false,
      reason: 'Account is not available',
      layer: 'account',
    }
  }
  if (user.status === 'SUSPENDED' || !user.isActive) {
    return {
      decision: 'DENIED',
      allowed: false,
      reason: 'Account is suspended or inactive',
      layer: 'account',
    }
  }
  if (user.status === 'INACTIVE') {
    return {
      decision: 'DENIED',
      allowed: false,
      reason: 'Account is inactive',
      layer: 'account',
    }
  }
  if (user.status === 'INVITED') {
    return {
      decision: 'DENIED',
      allowed: false,
      reason: 'Invitation has not been accepted',
      layer: 'account',
    }
  }
  if (user.status !== 'ACTIVE') {
    return {
      decision: 'DENIED',
      allowed: false,
      reason: 'Account is not active',
      layer: 'account',
    }
  }
  return { decision: 'ALLOWED', allowed: true }
}

export function actorHasPermission(user: AuthorizationActor, permission: Permission): boolean {
  if (user.permissions) {
    return user.permissions.includes(permission)
  }
  return roleHasPermission(user.role, permission)
}

export function isOrgWideRole(role: string): boolean {
  return ORG_WIDE_ROLES.has(role)
}

export function canAccessScopedResource(
  user: AuthorizationActor,
  resource: ResourceScope
): boolean {
  if (resource.organizationId !== user.organizationId) {
    return false
  }

  if (isOrgWideRole(user.role)) {
    return true
  }

  if (resource.ownerUserId && resource.ownerUserId === user.id) {
    return true
  }

  if (resource.internUserId && resource.internUserId === user.id) {
    return true
  }

  if (resource.assignedToUserId && resource.assignedToUserId === user.id) {
    return true
  }

  if (resource.createdByUserId && resource.createdByUserId === user.id) {
    return true
  }

  if (resource.memberUserIds?.includes(user.id)) {
    return true
  }

  if (user.role === 'MANAGER') {
    if (resource.managerId && resource.managerId === user.id) return true
    return false
  }

  if (user.role === 'MENTOR') {
    if (resource.mentorId && resource.mentorId === user.id) return true
    return false
  }

  if (user.role === 'INTERN') {
    return (
      resource.ownerUserId === user.id ||
      resource.internUserId === user.id ||
      resource.assignedToUserId === user.id ||
      resource.id === user.id
    )
  }

  return false
}

export function authorize(input: AuthorizeInput): AuthorizeResult {
  const { user, permission, resource } = input

  const account = isAccountUsable(user)
  if (!account.allowed) return account

  if (!actorHasPermission(user, permission)) {
    return {
      decision: 'DENIED',
      allowed: false,
      reason: 'Missing required permission',
      layer: 'permission',
    }
  }

  if (!resource) {
    return { decision: 'ALLOWED', allowed: true, layer: 'permission' }
  }

  if (resource.organizationId !== user.organizationId) {
    return {
      decision: 'DENIED',
      allowed: false,
      reason: 'Organization access denied',
      layer: 'organization',
    }
  }

  if (!canAccessScopedResource(user, resource)) {
    return {
      decision: 'DENIED',
      allowed: false,
      reason: 'Resource access denied',
      layer: 'resource',
    }
  }

  return { decision: 'ALLOWED', allowed: true, layer: 'resource' }
}

export function assertNoClientPrivilegeFields(body: Record<string, unknown>): string[] {
  const blocked = [
    'role',
    'role_id',
    'roleId',
    'organization_id',
    'organizationId',
    'permission_id',
    'permissionId',
    'permissions',
    'manager_id',
    'managerId',
    'mentor_id',
    'mentorId',
    'is_active',
    'isActive',
    'status',
    'auth_user_id',
    'authUserId',
  ]
  return blocked.filter((key) => Object.prototype.hasOwnProperty.call(body, key))
}
