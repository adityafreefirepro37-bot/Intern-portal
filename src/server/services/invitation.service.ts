import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { checkPassword } from '@/lib/auth/password-policy'
import { getAuthProvider } from '@/lib/auth/provider'
import { config } from '@/lib/config'
import { prisma } from '@/lib/db/client'
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import type { RequestMeta } from '@/lib/http/request-meta'
import { maskEmail } from '@/lib/security/masking'
import { generateSecureToken, hashToken } from '@/lib/security/tokens'
import { emailSchema, nameSchema, parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { lifecycleRepository } from '../repositories/lifecycle.repository'
import { invitationRepository } from '../repositories/invitation.repository'
import { roleRepository, userRepository } from '../repositories/user.repository'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { emailService } from './email.service'
import { rateLimitService } from './rate-limit.service'
import { assignableRoleFilter } from './user.service'

/**
 * Invitations.
 *
 * Tokens: 32 random bytes (base64url) from the OS CSPRNG. Only their SHA-256
 * hash is stored; the raw token exists solely in the invitation link. Tokens
 * expire (INVITATION_TTL_HOURS), are single-use (atomic claim), and are
 * invalidated when a newer invitation is sent or the invitation is revoked.
 * Tokens are never logged or written to audit metadata.
 */

export const createInvitationSchema = z.object({
  email: emailSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  roleId: z.uuid({ message: 'Choose a role' }),
})

export const acceptInvitationSchema = z
  .object({
    token: z.string().min(20).max(200),
    firstName: nameSchema,
    lastName: nameSchema,
    password: z.string().min(1, 'Enter a password').max(128),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Passwords don’t match',
    path: ['confirmPassword'],
  })

function inviteUrl(token: string) {
  return `${config.app.url}/invite/${token}`
}

export type InvitationPreview =
  | { valid: true; email: string; organizationName: string; roleName: string; firstName: string; lastName: string }
  | { valid: false; reason: 'invalid' | 'expired' | 'used' | 'revoked' }

type Tx = Prisma.TransactionClient

/**
 * Invitation building blocks, shared by user invitations and intern creation
 * (which writes the invitation inside its own transaction).
 */
export const invitationIssuer = {
  /** Production must be able to email invitations; development may fall back to a link. */
  assertDeliveryAvailable(): boolean {
    const deliverByEmail = emailService.isConfigured()
    if (!deliverByEmail && config.isProduction) {
      throw new AppError('NOT_IMPLEMENTED', 'Email delivery must be configured before sending invitations')
    }
    return deliverByEmail
  },

  /** Revokes older pending invitations for the user and stores a new hashed token. */
  async createRecord(tx: Tx, ctx: RequestContext, user: { id: string; email: string }, roleId: string) {
    const token = generateSecureToken(32)
    const expiresAt = new Date(Date.now() + config.auth.invitationTtlMs)
    await tx.userInvitation.updateMany({
      where: { user_id: user.id, accepted_at: null, revoked_at: null },
      data: { revoked_at: new Date(), revoked_by: ctx.actor.userId },
    })
    const invitation = await tx.userInvitation.create({
      data: {
        organization_id: ctx.organization.id,
        user_id: user.id,
        email: user.email,
        role_id: roleId,
        token_hash: hashToken(token),
        expires_at: expiresAt,
        created_by: ctx.actor.userId,
      },
      select: { id: true },
    })
    return { invitationId: invitation.id, token, expiresAt }
  },

  /** Sends the email (or returns the one-time development link) and audits. Runs after commit. */
  async deliver(
    ctx: RequestContext,
    issued: { invitationId: string; token: string; expiresAt: Date },
    target: { userId: string; email: string; roleName: string; roleSlug: string },
    meta: RequestMeta,
    deliverByEmail: boolean,
  ) {
    if (deliverByEmail) {
      await emailService.send(
        emailService.invitationMessage({
          to: target.email,
          inviteUrl: inviteUrl(issued.token),
          organizationName: ctx.organization.name,
          roleName: target.roleName,
          inviterName: ctx.actor.displayName,
          expiresAt: issued.expiresAt,
        }),
      )
    }
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.INVITATION_CREATED,
      resourceType: 'invitation',
      resourceId: issued.invitationId,
      metadata: { email: maskEmail(target.email), role: target.roleSlug, delivery: deliverByEmail ? 'email' : 'link' },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    })
    await domainEvents.emit('invitation.created', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: {
        userId: target.userId,
        invitationId: issued.invitationId,
        delivery: deliverByEmail ? 'email' : 'link',
      },
    })
    return {
      invitationId: issued.invitationId,
      delivery: deliverByEmail ? ('email' as const) : ('link' as const),
      // Development fallback only: shown once to the inviting admin, never logged.
      inviteUrl: deliverByEmail ? null : inviteUrl(issued.token),
      expiresAt: issued.expiresAt,
    }
  },
}

export const invitationService = {
  /**
   * Creates (or re-sends) an invitation. When email delivery isn't configured
   * the link is returned to the inviting admin in development only; in
   * production the request fails instead of exposing a token.
   */
  async create(ctx: RequestContext, input: unknown, meta: RequestMeta) {
    authorizationService.require(ctx, 'user.invite')
    const data = parseInput(createInvitationSchema, input)
    const deliverByEmail = invitationIssuer.assertDeliveryAvailable()
    await rateLimitService.consume('invitationCreate', ctx.actor.userId)

    const role = await roleRepository.findInOrg(ctx.organization.id, data.roleId)
    if (!role) throw new NotFoundError('Role')
    if (!assignableRoleFilter(ctx)(role))
      throw new ForbiddenError('You can’t invite someone with a role at or above your own')

    const existing = await userRepository.findByEmail(ctx.organization.id, data.email)
    if (existing && !existing.deleted_at && (existing.status === 'ACTIVE' || existing.status === 'SUSPENDED')) {
      throw new ConflictError('Someone with this email already has an account')
    }

    const { userId, issued, created } = await prisma.$transaction(async (tx) => {
      const user = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: { first_name: data.firstName, last_name: data.lastName, status: 'INVITED', deleted_at: null },
            select: { id: true },
          })
        : await tx.user.create({
            data: {
              organization_id: ctx.organization.id,
              email: data.email,
              first_name: data.firstName,
              last_name: data.lastName,
              status: 'INVITED',
            },
            select: { id: true },
          })
      await tx.userRole.deleteMany({ where: { user_id: user.id } })
      await tx.userRole.create({ data: { user_id: user.id, role_id: role.id, granted_by: ctx.actor.userId } })
      const issued = await invitationIssuer.createRecord(tx, ctx, { id: user.id, email: data.email }, role.id)
      return { userId: user.id, issued, created: !existing }
    })

    if (created) {
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.USER_CREATED,
        resourceType: 'user',
        resourceId: userId,
        metadata: { via: 'invitation', role: role.slug },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      })
    }
    return invitationIssuer.deliver(
      ctx,
      issued,
      { userId, email: data.email, roleName: role.name, roleSlug: role.slug },
      meta,
      deliverByEmail,
    )
  },

  /** (Re)sends an invitation to an existing, not-yet-activated profile, keeping its role. */
  async inviteExistingUser(ctx: RequestContext, userId: string, meta: RequestMeta) {
    authorizationService.require(ctx, 'user.invite')
    const id = parseInput(z.uuid(), userId)
    const deliverByEmail = invitationIssuer.assertDeliveryAvailable()
    await rateLimitService.consume('invitationCreate', ctx.actor.userId)
    const user = await prisma.user.findFirst({
      where: { id, organization_id: ctx.organization.id, deleted_at: null },
      select: {
        id: true,
        email: true,
        status: true,
        user_roles: { select: { role: { select: { id: true, name: true, slug: true, rank: true } } } },
      },
    })
    if (!user) throw new NotFoundError('User')
    if (user.status !== 'INVITED') throw new ConflictError('This person has already activated their account')
    const role = user.user_roles.map(({ role: r }) => r).sort((a, b) => b.rank - a.rank)[0]
    if (!role) throw new ValidationError('Assign a role before inviting')
    if (!assignableRoleFilter(ctx)(role)) {
      throw new ForbiddenError('You can’t invite someone with a role at or above your own')
    }
    const issued = await prisma.$transaction((tx) =>
      invitationIssuer.createRecord(tx, ctx, { id: user.id, email: user.email }, role.id),
    )
    return invitationIssuer.deliver(
      ctx,
      issued,
      { userId: user.id, email: user.email, roleName: role.name, roleSlug: role.slug },
      meta,
      deliverByEmail,
    )
  },

  async listPending(ctx: RequestContext) {
    authorizationService.require(ctx, 'user.invite')
    return invitationRepository.listPending(ctx.organization.id, new Date())
  },

  async revoke(ctx: RequestContext, invitationId: string) {
    authorizationService.require(ctx, 'user.invite')
    const id = parseInput(z.uuid(), invitationId)
    const invitation = await invitationRepository.findInOrg(ctx.organization.id, id)
    if (!invitation || invitation.accepted_at || invitation.revoked_at) throw new NotFoundError('Invitation')
    await invitationRepository.revoke(id, ctx.actor.userId)
    await prisma.user.updateMany({
      where: { id: invitation.user_id, status: 'INVITED' },
      data: { status: 'INACTIVE' },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.INVITATION_REVOKED,
      resourceType: 'invitation',
      resourceId: id,
      metadata: { email: maskEmail(invitation.email) },
    })
  },

  /** Public: validates a token for the acceptance page without consuming it. */
  async preview(token: string): Promise<InvitationPreview> {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return { valid: false, reason: 'invalid' }
    const invitation = await invitationRepository.findByTokenHash(hashToken(token))
    if (!invitation) return { valid: false, reason: 'invalid' }
    if (invitation.revoked_at) return { valid: false, reason: 'revoked' }
    if (invitation.accepted_at) return { valid: false, reason: 'used' }
    if (invitation.expires_at <= new Date()) return { valid: false, reason: 'expired' }
    return {
      valid: true,
      email: invitation.email,
      organizationName: invitation.organization.name,
      roleName: invitation.role.name,
      firstName: invitation.user.first_name,
      lastName: invitation.user.last_name,
    }
  },

  /**
   * Public: accepts an invitation — creates the sign-in account at the auth
   * provider and activates the linked application user. Single-use.
   */
  async accept(input: unknown, meta: RequestMeta): Promise<{ sessionCreated: boolean; email: string }> {
    const data = parseInput(acceptInvitationSchema, input)
    await rateLimitService.consume('invitationAccept', meta.ipAddress ?? 'unknown')

    const invitation = await invitationRepository.findByTokenHash(hashToken(data.token))
    if (!invitation) throw new ValidationError('This invitation link is invalid', { token: 'invalid' })

    const policy = checkPassword(data.password, {
      minLength: config.auth.passwordMinLength,
      email: invitation.email,
      name: data.firstName,
    })
    if (!policy.valid) throw new ValidationError('Choose a stronger password', { password: policy.errors.join('. ') })

    const now = new Date()
    if (!(await invitationRepository.claim(invitation.id, now))) {
      throw new ValidationError('This invitation has expired or was already used', { token: 'unavailable' })
    }

    const signUp = await getAuthProvider().signUp(
      invitation.email,
      data.password,
      `${config.app.url}/auth/confirm?next=/`,
    )
    if (!signUp.ok) {
      await invitationRepository.release(invitation.id)
      if (signUp.reason === 'already_registered') {
        throw new ConflictError('A sign-in account already exists for this email. Ask HR to link it to your profile.')
      }
      if (signUp.reason === 'weak_password')
        throw new ValidationError('Choose a stronger password', { password: 'Too weak' })
      if (signUp.reason === 'rate_limited')
        throw new AppError('RATE_LIMITED', 'Too many attempts. Please try again later.')
      throw new AppError('INTERNAL_ERROR', 'We couldn’t create your account. Please try again.')
    }

    await prisma.user.update({
      where: { id: invitation.user_id },
      data: {
        auth_user_id: signUp.userId,
        first_name: data.firstName,
        last_name: data.lastName,
        status: 'ACTIVE',
        email_verified_at: signUp.emailConfirmedAt,
      },
    })
    await auditService.log({
      organizationId: invitation.organization_id,
      actorUserId: invitation.user_id,
      action: AUDIT_ACTIONS.INVITATION_ACCEPTED,
      resourceType: 'invitation',
      resourceId: invitation.id,
      metadata: { emailConfirmationPending: !signUp.emailConfirmedAt },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    })
    const intern = await prisma.intern.findUnique({ where: { user_id: invitation.user_id }, select: { id: true } })
    if (intern) {
      await lifecycleRepository.record(prisma, {
        organizationId: invitation.organization_id,
        internId: intern.id,
        type: 'INVITATION_ACCEPTED',
        description: 'Invitation accepted — account activated',
        actorUserId: invitation.user_id,
        idempotencyKey: `invitation_accepted:${invitation.id}`,
      })
    }
    await domainEvents.emit('invitation.accepted', {
      organizationId: invitation.organization_id,
      actorUserId: invitation.user_id,
      payload: { userId: invitation.user_id, invitationId: invitation.id },
    })
    return { sessionCreated: signUp.sessionCreated, email: invitation.email }
  },
}
