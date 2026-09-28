import type { UserStatus } from '@prisma/client'
import { z } from 'zod'
import { getAuthProvider } from '@/lib/auth/provider'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { can } from '@/lib/permissions'
import { maskValue } from '@/lib/security/masking'
import { getStorageService } from '@/lib/storage'
import { nameSchema, parseInput, type Pagination } from '@/lib/validation'
import type { RequestContext } from '../context'
import { sessionRepository } from '../repositories/session.repository'
import { roleRepository, userRepository, type UserFilter } from '../repositories/user.repository'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { toPage } from './pagination'

/**
 * User administration and self-service profile.
 *
 * Privilege-escalation defences (all enforced here, on the server):
 *  - nobody changes their own role or status;
 *  - an actor can only manage users ranked below them and only assign roles
 *    ranked below their own highest role — except holders of the owner-level
 *    permission (`permission.manage`), who may manage peers;
 *  - the organization always keeps at least one active owner-level user;
 *  - client-supplied organization ids are never used: targets are looked up
 *    inside the actor's organization, so foreign ids resolve to "not found".
 */

/** The permission that marks owner-level (super admin) roles. */
export const OWNER_PERMISSION = { resource: 'permission', action: 'manage' } as const

function isOwnerLevel(ctx: RequestContext) {
  return can(ctx.actor.permissions, 'permission.manage')
}

function maxRank(roles: { role: { rank: number } }[]) {
  return roles.reduce((max, { role }) => Math.max(max, role.rank), 0)
}

function grantsOwner(roles: { role: { role_permissions: { permission: { resource: string; action: string } }[] } }[]) {
  return roles.some(({ role }) =>
    role.role_permissions.some(
      ({ permission }) =>
        permission.resource === OWNER_PERMISSION.resource && permission.action === OWNER_PERMISSION.action,
    ),
  )
}

/** Roles this actor may assign. */
export function assignableRoleFilter(ctx: RequestContext) {
  const owner = isOwnerLevel(ctx)
  return (role: { rank: number }) => (owner ? role.rank <= ctx.actor.rank : role.rank < ctx.actor.rank)
}

async function loadManageableTarget(ctx: RequestContext, userId: string) {
  const target = await userRepository.findForAdmin(ctx.organization.id, userId)
  if (!target) throw new NotFoundError('User')
  if (target.id === ctx.actor.userId) throw new ForbiddenError('You can’t change your own account here')
  const targetRank = maxRank(target.user_roles)
  const allowed = isOwnerLevel(ctx) ? targetRank <= ctx.actor.rank : targetRank < ctx.actor.rank
  if (!allowed) throw new ForbiddenError('You can only manage users with a lower role than yours')
  return target
}

async function assertOwnerRemains(ctx: RequestContext, target: Awaited<ReturnType<typeof loadManageableTarget>>) {
  if (!grantsOwner(target.user_roles)) return
  const others = await userRepository.countActiveHoldersOf(
    ctx.organization.id,
    OWNER_PERMISSION.resource,
    OWNER_PERMISSION.action,
    target.id,
  )
  if (others === 0) throw new ConflictError('The organization must keep at least one active Super Admin')
}

async function endAllAccess(target: { id: string; auth_user_id: string | null }, reason: string) {
  await sessionRepository.revokeAllForUser(target.id, reason)
  if (target.auth_user_id) await getAuthProvider().setBlocked(target.auth_user_id, true)
}

export const userListFilterSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'INVITED', 'SUSPENDED', 'INACTIVE']).optional(),
  roleId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
})

export const updateOwnProfileSchema = z.strictObject({
  firstName: nameSchema,
  lastName: nameSchema,
  displayName: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((value) => value || null),
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  timezone: z.string().trim().max(64).optional(),
})

export const userService = {
  async list(ctx: RequestContext, pagination: Pagination, filter: UserFilter = {}) {
    authorizationService.require(ctx, 'user.read')
    const [rows, total] = await userRepository.listPage(
      ctx.organization.id,
      filter,
      (pagination.page - 1) * pagination.pageSize,
      pagination.pageSize,
    )
    const fullContact = authorizationService.scopeOf(ctx, 'user.update') === 'ORGANIZATION'
    // Only authorized fields leave the server; phone is masked, not hidden with CSS.
    const items = rows.map(({ phone, ...row }) => ({ ...row, phone: fullContact ? phone : maskValue(phone) }))
    return toPage(items, total, pagination)
  },

  async listRoles(ctx: RequestContext) {
    authorizationService.require(ctx, 'role.read')
    return roleRepository.listWithDetails(ctx.organization.id)
  },

  /** Roles the actor may assign (for invite / change-role forms). */
  async assignableRoles(ctx: RequestContext) {
    if (!authorizationService.canAny(ctx, ['user.assign_role', 'user.invite'])) return []
    const roles = await roleRepository.listBasic(ctx.organization.id)
    return roles.filter(assignableRoleFilter(ctx))
  },

  async changeRole(ctx: RequestContext, input: { userId: string; roleId: string }) {
    authorizationService.require(ctx, 'user.assign_role')
    const { userId, roleId } = parseInput(z.object({ userId: z.uuid(), roleId: z.uuid() }), input)
    const target = await loadManageableTarget(ctx, userId)
    const role = await roleRepository.findInOrg(ctx.organization.id, roleId)
    if (!role) throw new NotFoundError('Role')
    if (!assignableRoleFilter(ctx)(role)) throw new ForbiddenError('You can’t assign a role at or above your own level')
    const alreadyOnly = target.user_roles.length === 1 && target.user_roles[0].role.id === role.id
    if (alreadyOnly) return { changed: false }

    const losesOwner = grantsOwner(target.user_roles) && !(await roleGrantsOwner(ctx, role.id))
    if (losesOwner) await assertOwnerRemains(ctx, target)

    await userRepository.replaceRoles(target.id, [role.id], ctx.actor.userId)
    // Permissions change immediately: the request context is rebuilt from the database on every request.
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.ROLE_CHANGED,
      resourceType: 'user',
      resourceId: target.id,
      metadata: { from: target.user_roles.map(({ role: r }) => r.slug), to: role.slug },
    })
    return { changed: true }
  },

  async setStatus(
    ctx: RequestContext,
    input: { userId: string; status: Extract<UserStatus, 'ACTIVE' | 'SUSPENDED' | 'INACTIVE'> },
  ) {
    const { userId, status } = parseInput(
      z.object({ userId: z.uuid(), status: z.enum(['ACTIVE', 'SUSPENDED', 'INACTIVE']) }),
      input,
    )
    authorizationService.require(ctx, status === 'INACTIVE' ? 'user.delete' : 'user.suspend')
    const target = await loadManageableTarget(ctx, userId)
    if (target.status === status) return { changed: false }
    if (target.status === 'INVITED') throw new ValidationError('Revoke the invitation instead')

    if (status === 'ACTIVE') {
      await userRepository.setStatus(target.id, 'ACTIVE')
      if (target.auth_user_id) await getAuthProvider().setBlocked(target.auth_user_id, false)
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.USER_REACTIVATED,
        resourceType: 'user',
        resourceId: target.id,
        metadata: { from: target.status },
      })
      return { changed: true }
    }

    await assertOwnerRemains(ctx, target)
    await userRepository.setStatus(target.id, status)
    // Existing sessions are rejected on their next request (status check),
    // recorded sessions are revoked, and the provider blocks token refresh.
    await endAllAccess(target, status === 'SUSPENDED' ? 'account_suspended' : 'account_deactivated')
    await auditService.logForContext(ctx, {
      action: status === 'SUSPENDED' ? AUDIT_ACTIONS.USER_SUSPENDED : AUDIT_ACTIONS.USER_DEACTIVATED,
      resourceType: 'user',
      resourceId: target.id,
      metadata: { from: target.status },
    })
    return { changed: true }
  },

  // ── Self-service ──────────────────────────────────────────────────────────

  async getOwnProfile(ctx: RequestContext) {
    return userRepository.getProfile(ctx.actor.userId)
  },

  /**
   * Updates only the fields a user may edit about themself. The schema is
   * strict: attempts to send role, organization, status, manager, email or
   * any other field are rejected with a validation error.
   */
  async updateOwnProfile(ctx: RequestContext, input: unknown) {
    const data = parseInput(updateOwnProfileSchema, input)
    await userRepository.updateProfile(ctx.actor.userId, {
      first_name: data.firstName,
      last_name: data.lastName,
      display_name: data.displayName,
      phone: data.phone ?? null,
      ...(data.timezone ? { timezone: data.timezone } : {}),
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.USER_UPDATED,
      resourceType: 'user',
      resourceId: ctx.actor.userId,
      metadata: { fields: Object.keys(data), self: true },
    })
  },

  /**
   * Stores a validated image (type, extension, signature, size) and points
   * the profile at the authorized avatar route. The previous file is deleted.
   */
  async setOwnAvatar(ctx: RequestContext, file: { name: string; type: string; bytes: Uint8Array }) {
    await storeAvatar(ctx, ctx.actor.userId, file)
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.USER_UPDATED,
      resourceType: 'user',
      resourceId: ctx.actor.userId,
      metadata: { fields: ['avatar'], self: true },
    })
  },

  /**
   * Stores a photo for another user. Callers must already have authorized the
   * write (e.g. intern creation by HR); this only handles storage + cleanup.
   */
  async setAvatarFor(ctx: RequestContext, userId: string, file: { name: string; type: string; bytes: Uint8Array }) {
    await storeAvatar(ctx, userId, file)
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.USER_UPDATED,
      resourceType: 'user',
      resourceId: userId,
      metadata: { fields: ['avatar'] },
    })
  },
}

async function storeAvatar(ctx: RequestContext, userId: string, file: { name: string; type: string; bytes: Uint8Array }) {
  const storage = getStorageService()
  const stored = await storage.upload({
    organizationId: ctx.organization.id,
    category: 'image',
    fileName: file.name,
    mimeType: file.type,
    data: file.bytes,
  })
  const previous = (await userRepository.getProfile(userId)).avatar_url
  await userRepository.updateProfile(userId, { avatar_url: avatarUrlFor(userId, stored.storagePath) })
  const previousKey = previous ? avatarStorageKey(ctx.organization.id, userId, previous) : null
  if (previousKey) await storage.delete(previousKey).catch(() => undefined)
}

/** `{org}/image/{year}/{file}` → `/api/avatars/{userId}/{year}/{file}` */
export function avatarUrlFor(userId: string, storagePath: string): string {
  const [, , year, fileName] = storagePath.split('/')
  return `/api/avatars/${userId}/${year}/${fileName}`
}

/** Inverse of avatarUrlFor; null if the URL isn't an uploaded avatar of this user. */
export function avatarStorageKey(organizationId: string, userId: string, avatarUrl: string): string | null {
  const match = /^\/api\/avatars\/([0-9a-f-]{36})\/(\d{4})\/([0-9a-f-]{36}\.[a-z0-9]{2,5})$/.exec(avatarUrl)
  if (!match || match[1] !== userId) return null
  return `${organizationId}/image/${match[2]}/${match[3]}`
}

async function roleGrantsOwner(ctx: RequestContext, roleId: string) {
  const roles = await roleRepository.listWithDetails(ctx.organization.id)
  const role = roles.find((r) => r.id === roleId)
  return Boolean(
    role?.role_permissions.some(
      ({ permission }) =>
        permission.resource === OWNER_PERMISSION.resource && permission.action === OWNER_PERMISSION.action,
    ),
  )
}
