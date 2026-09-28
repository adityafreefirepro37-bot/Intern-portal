import { setAuthProviderForTesting } from '@/lib/auth/provider'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { hashToken } from '@/lib/security/tokens'
import { getAuthState } from '@/server/context'
import { AUDIT_ACTIONS } from '@/server/services/audit-actions'
import { auditService } from '@/server/services/audit.service'
import { internService } from '@/server/services/intern.service'
import { invitationService } from '@/server/services/invitation.service'
import { taskService } from '@/server/services/task.service'
import { userService } from '@/server/services/user.service'
import type { FakeAuthProvider } from './fake-auth'
import { AYAVA_ORGANIZATION_ID, contextFor, createUser, meta, prisma, uniqueSuffix, useFakeAuth } from './helpers'

let fake: FakeAuthProvider
beforeEach(() => {
  fake = useFakeAuth()
})
afterAll(async () => {
  setAuthProviderForTesting(null)
  await prisma.$disconnect()
})

const page = { page: 1, pageSize: 100 }

/** An intern placed under a different manager and mentor than the seeded staff. */
async function unrelatedIntern() {
  const otherManager = await createUser(fake, { role: 'manager' })
  const internUser = await createUser(fake, { role: 'intern' })
  const intern = await prisma.intern.create({
    data: {
      organization_id: AYAVA_ORGANIZATION_ID,
      user_id: internUser.user.id,
      employee_code: `T-${uniqueSuffix()}`,
      status: 'ACTIVE',
      manager_id: otherManager.user.id,
      mentor_id: otherManager.user.id,
    },
  })
  return { intern, otherManager }
}

describe('authorization matrix (Prompt 02 §54)', () => {
  it('intern → own profile: ALLOW', async () => {
    const intern = await contextFor('intern@ayavacreatives.com')
    const profile = await userService.getOwnProfile(intern)
    expect(profile.email).toBe('intern@ayavacreatives.com')
  })

  it('intern → another intern: DENY', async () => {
    const intern = await contextFor('intern@ayavacreatives.com')
    const other = await prisma.intern.findFirstOrThrow({
      where: { user: { email: { not: 'intern@ayavacreatives.com' } } },
    })
    // Out of scope is indistinguishable from missing (no existence leak).
    await expect(internService.getProfile(intern, other.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(internService.list(intern, page)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('intern → change own role or organization: DENY', async () => {
    const intern = await contextFor('intern@ayavacreatives.com')
    const adminRole = await prisma.role.findFirstOrThrow({
      where: { organization_id: AYAVA_ORGANIZATION_ID, slug: 'admin' },
    })
    await expect(
      userService.changeRole(intern, { userId: intern.actor.userId, roleId: adminRole.id }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    for (const smuggled of [
      { roleId: adminRole.id },
      { organizationId: '00000000-0000-4000-8000-000000000000' },
      { status: 'ACTIVE' },
      { managerId: intern.actor.userId },
      { permissions: ['audit_log.read'] },
    ]) {
      await expect(
        userService.updateOwnProfile(intern, { firstName: 'Aanya', lastName: 'Sharma', ...smuggled }),
      ).rejects.toBeInstanceOf(ValidationError)
    }
    const after = await contextFor('intern@ayavacreatives.com')
    expect(after.actor.roles.map((role) => role.slug)).toEqual(['intern'])
  })

  it('manager → assigned intern: ALLOW; unrelated intern: DENY (404)', async () => {
    const manager = await contextFor('manager@ayavacreatives.com')
    const assigned = await prisma.intern.findFirstOrThrow({ where: { manager_id: manager.actor.userId } })
    await expect(internService.getProfile(manager, assigned.id)).resolves.toMatchObject({ id: assigned.id })

    const { intern } = await unrelatedIntern()
    await expect(internService.getProfile(manager, intern.id)).rejects.toBeInstanceOf(NotFoundError)
    const list = await internService.list(manager, page)
    expect(list.items.some((row) => row.id === intern.id)).toBe(false)
    expect(list.items.length).toBeGreaterThan(0)
  })

  it('manager sees assigned interns’ phone masked and no organization-wide HR data', async () => {
    const manager = await contextFor('manager@ayavacreatives.com')
    const assigned = await prisma.intern.findFirstOrThrow({ where: { manager_id: manager.actor.userId } })
    await prisma.user.update({ where: { id: assigned.user_id }, data: { phone: '+91 98765 43210' } })
    const detail = await internService.getProfile(manager, assigned.id)
    expect(detail.phone).toBe('••••••3210')
    expect(detail.emergencyContacts).toBeNull()
    await expect(userService.list(manager, page)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('HR → HR records: ALLOW (organization-wide, full contact details)', async () => {
    const hr = await contextFor('hr@ayavacreatives.com')
    const { intern } = await unrelatedIntern()
    await prisma.user.update({ where: { id: intern.user_id }, data: { phone: '+91 90000 11111' } })
    const detail = await internService.getProfile(hr, intern.id)
    expect(detail.phone).toBe('+91 90000 11111')
  })

  it('intern → audit logs: DENY, and the denial itself is audited', async () => {
    const intern = await contextFor('intern@ayavacreatives.com')
    await expect(auditService.listPage(intern, page)).rejects.toBeInstanceOf(ForbiddenError)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const denial = await prisma.auditLog.findFirst({
      where: { action: AUDIT_ACTIONS.ACCESS_DENIED, actor_user_id: intern.actor.userId },
      orderBy: { created_at: 'desc' },
    })
    expect(denial?.status).toBe('DENIED')
  })

  it('admin → operational data: ALLOW (organization-wide)', async () => {
    const admin = await contextFor('admin@ayavacreatives.com')
    const tasks = await taskService.list(admin, page)
    const all = await prisma.task.count({ where: { organization_id: AYAVA_ORGANIZATION_ID, deleted_at: null } })
    expect(tasks.total).toBe(all)
  })

  it('intern sees only tasks assigned to them', async () => {
    const intern = await contextFor('intern@ayavacreatives.com')
    const tasks = await taskService.list(intern, page)
    expect(tasks.total).toBeGreaterThan(0)
    for (const task of tasks.items) {
      expect(task.assignees.some(({ user }) => user.id === intern.actor.userId)).toBe(true)
    }
  })
})

describe('privilege escalation (Prompt 02 §30, §55)', () => {
  async function roleId(slug: string) {
    return (await prisma.role.findFirstOrThrow({ where: { organization_id: AYAVA_ORGANIZATION_ID, slug } })).id
  }

  it('HR cannot grant a role at or above their own, or manage an admin', async () => {
    const hr = await contextFor('hr@ayavacreatives.com')
    const target = await createUser(fake, { role: 'intern' })
    await expect(
      userService.changeRole(hr, { userId: target.user.id, roleId: await roleId('admin') }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      userService.changeRole(hr, { userId: target.user.id, roleId: await roleId('hr') }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      userService.changeRole(hr, { userId: target.user.id, roleId: await roleId('manager') }),
    ).resolves.toEqual({ changed: true })

    const admin = await contextFor('admin@ayavacreatives.com')
    await expect(userService.setStatus(hr, { userId: admin.actor.userId, status: 'SUSPENDED' })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('nobody can change their own role or suspend themselves', async () => {
    const owner = await contextFor('admin@ayavacreatives.com')
    await expect(
      userService.changeRole(owner, { userId: owner.actor.userId, roleId: await roleId('intern') }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(
      userService.setStatus(owner, { userId: owner.actor.userId, status: 'SUSPENDED' }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('an admin cannot demote a super admin; only owner-level users manage peers', async () => {
    const admin = await createUser(fake, { role: 'admin' })
    fake.signInAs(admin.email)
    const state = await getAuthState()
    if (state.status !== 'AUTHENTICATED') throw new Error('expected authenticated')
    const owner = await contextFor('admin@ayavacreatives.com')
    await expect(
      userService.changeRole(state.context, { userId: owner.actor.userId, roleId: await roleId('intern') }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('role_id / organization_id / user_id from another organization resolve to not found', async () => {
    const other = await prisma.organization.create({ data: { name: 'Elsewhere', slug: `elsewhere-${uniqueSuffix()}` } })
    const foreignRole = await prisma.role.create({
      data: { organization_id: other.id, name: 'Boss', slug: `boss_${uniqueSuffix()}`, rank: 1 },
    })
    const foreignUser = await prisma.user.create({
      data: {
        organization_id: other.id,
        email: `x-${uniqueSuffix()}@elsewhere.dev`,
        first_name: 'X',
        last_name: 'Y',
        status: 'ACTIVE',
      },
    })
    const admin = await contextFor('admin@ayavacreatives.com')
    const target = await createUser(fake, { role: 'intern' })

    await expect(
      userService.changeRole(admin, { userId: target.user.id, roleId: foreignRole.id }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      userService.changeRole(admin, { userId: foreignUser.id, roleId: await roleId('intern') }),
    ).rejects.toBeInstanceOf(NotFoundError)
    await expect(userService.setStatus(admin, { userId: foreignUser.id, status: 'SUSPENDED' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
    expect((await prisma.user.findUniqueOrThrow({ where: { id: foreignUser.id } })).status).toBe('ACTIVE')
  })

  it('intern_id manipulation across organizations returns 404', async () => {
    const other = await prisma.organization.create({
      data: { name: 'Elsewhere 2', slug: `elsewhere-${uniqueSuffix()}` },
    })
    const user = await prisma.user.create({
      data: { organization_id: other.id, email: `i-${uniqueSuffix()}@elsewhere.dev`, first_name: 'I', last_name: 'J' },
    })
    const foreignIntern = await prisma.intern.create({
      data: { organization_id: other.id, user_id: user.id, employee_code: 'EXT-1' },
    })
    const hr = await contextFor('hr@ayavacreatives.com')
    await expect(internService.getProfile(hr, foreignIntern.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('malformed ids are rejected as validation errors, not database errors', async () => {
    const admin = await contextFor('admin@ayavacreatives.com')
    await expect(userService.changeRole(admin, { userId: "1' OR '1'='1", roleId: 'x' })).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it('role changes take effect on the next request and are audited', async () => {
    const admin = await contextFor('admin@ayavacreatives.com')
    const target = await createUser(fake, { role: 'intern' })
    await userService.changeRole(admin, { userId: target.user.id, roleId: await roleId('mentor') })
    fake.signInAs(target.email)
    const state = await getAuthState()
    if (state.status !== 'AUTHENTICATED') throw new Error('expected authenticated')
    expect(state.context.actor.roles.map((role) => role.slug)).toEqual(['mentor'])
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.ROLE_CHANGED, resource_id: target.user.id },
    })
    expect(audit.metadata).toMatchObject({ from: ['intern'], to: 'mentor' })
  })
})

describe('invitations (Prompt 02 §25–26)', () => {
  async function roleId(slug: string) {
    return (await prisma.role.findFirstOrThrow({ where: { organization_id: AYAVA_ORGANIZATION_ID, slug } })).id
  }

  it('creates a hashed, single-use invitation and activates the user on acceptance', async () => {
    const hr = await contextFor('hr@ayavacreatives.com')
    const email = `newbie-${uniqueSuffix()}@test.ayava.dev`
    const created = await invitationService.create(
      hr,
      { email, firstName: 'New', lastName: 'Intern', roleId: await roleId('intern') },
      meta(),
    )
    expect(created.delivery).toBe('link')
    const token = created.inviteUrl!.split('/invite/')[1]

    const stored = await prisma.userInvitation.findUniqueOrThrow({ where: { id: created.invitationId } })
    expect(stored.token_hash).toBe(hashToken(token))
    expect(stored.token_hash).not.toContain(token)
    const invited = await prisma.user.findFirstOrThrow({ where: { email } })
    expect(invited.status).toBe('INVITED')

    expect(await invitationService.preview(token)).toMatchObject({ valid: true, email, roleName: 'Intern' })
    await expect(
      invitationService.accept(
        { token, firstName: 'New', lastName: 'Intern', password: 'password123', confirmPassword: 'password123' },
        meta(),
      ),
    ).rejects.toBeInstanceOf(ValidationError)

    const result = await invitationService.accept(
      {
        token,
        firstName: 'Nia',
        lastName: 'Intern',
        password: 'a solid passphrase',
        confirmPassword: 'a solid passphrase',
      },
      meta(),
    )
    expect(result).toEqual({ sessionCreated: false, email })
    const activated = await prisma.user.findUniqueOrThrow({ where: { id: invited.id } })
    expect(activated).toMatchObject({ status: 'ACTIVE', first_name: 'Nia' })
    expect(activated.auth_user_id).toBe(fake.users.get(email)!.id)

    // Single use.
    expect(await invitationService.preview(token)).toEqual({ valid: false, reason: 'used' })
    await expect(
      invitationService.accept(
        {
          token,
          firstName: 'Nia',
          lastName: 'Intern',
          password: 'a solid passphrase',
          confirmPassword: 'a solid passphrase',
        },
        meta(),
      ),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(
      await prisma.auditLog.findFirst({
        where: { action: AUDIT_ACTIONS.INVITATION_ACCEPTED, resource_id: created.invitationId },
      }),
    ).not.toBeNull()
  })

  it('never writes the token to the audit log', async () => {
    const hr = await contextFor('hr@ayavacreatives.com')
    const created = await invitationService.create(
      hr,
      {
        email: `audit-${uniqueSuffix()}@test.ayava.dev`,
        firstName: 'Al',
        lastName: 'Bee',
        roleId: await roleId('intern'),
      },
      meta(),
    )
    const token = created.inviteUrl!.split('/invite/')[1]
    const rows = await prisma.auditLog.findMany({ where: { resource_id: created.invitationId } })
    expect(JSON.stringify(rows)).not.toContain(token)
  })

  it('rejects expired, revoked and superseded invitations', async () => {
    const hr = await contextFor('hr@ayavacreatives.com')
    const email = `later-${uniqueSuffix()}@test.ayava.dev`
    const first = await invitationService.create(
      hr,
      { email, firstName: 'La', lastName: 'Ter', roleId: await roleId('intern') },
      meta(),
    )
    const second = await invitationService.create(
      hr,
      { email, firstName: 'La', lastName: 'Ter', roleId: await roleId('intern') },
      meta(),
    )
    expect(await invitationService.preview(first.inviteUrl!.split('/invite/')[1])).toEqual({
      valid: false,
      reason: 'revoked',
    })

    await prisma.userInvitation.update({
      where: { id: second.invitationId },
      data: { expires_at: new Date(Date.now() - 1000), created_at: new Date(Date.now() - 5000) },
    })
    expect(await invitationService.preview(second.inviteUrl!.split('/invite/')[1])).toEqual({
      valid: false,
      reason: 'expired',
    })
    expect(await invitationService.preview('not-a-real-token-at-all-000000')).toEqual({
      valid: false,
      reason: 'invalid',
    })
  })

  it('does not let HR invite someone with an elevated role, or interns invite anyone', async () => {
    const hr = await contextFor('hr@ayavacreatives.com')
    await expect(
      invitationService.create(
        hr,
        {
          email: `boss-${uniqueSuffix()}@test.ayava.dev`,
          firstName: 'Bo',
          lastName: 'Ss',
          roleId: await roleId('admin'),
        },
        meta(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)
    const intern = await contextFor('intern@ayavacreatives.com')
    await expect(
      invitationService.create(
        intern,
        {
          email: `x-${uniqueSuffix()}@test.ayava.dev`,
          firstName: 'Xx',
          lastName: 'Yy',
          roleId: await roleId('intern'),
        },
        meta(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('rate limiter', () => {
  it('counts concurrent hits correctly across the shared database store', async () => {
    const { rateLimitService } = await import('@/server/services/rate-limit.service')
    const id = `concurrency-${uniqueSuffix()}`
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => rateLimitService.consume('passwordReset', id)),
    )
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(5)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(7)
  })
})
