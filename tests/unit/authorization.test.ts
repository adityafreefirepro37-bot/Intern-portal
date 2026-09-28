import { ForbiddenError, NotFoundError } from '@/lib/errors'
import type { PermissionScope } from '@/lib/permissions'
import { authorize, withinScope, type AuthorizationActor, type ResourceFacts } from '@/lib/permissions/engine'
import { classifyAccount, redirectPathFor, toRequestContext } from '@/server/context'
import type { ActorRecord } from '@/server/repositories/identity.repository'
import { authorizationService } from '@/server/services/authorization.service'

jest.mock('@/server/repositories/audit.repository', () => ({
  auditRepository: { create: jest.fn().mockResolvedValue({ id: 'x' }) },
}))

const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG = '22222222-2222-4222-8222-222222222222'
const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TEAM = 'teamteam-0000-4000-8000-000000000001'
const DEPT = 'deptdept-0000-4000-8000-000000000001'

function actor(grants: Record<string, PermissionScope>, extra: Partial<AuthorizationActor> = {}): AuthorizationActor {
  return {
    userId: ME,
    organizationId: ORG,
    permissions: new Map(Object.entries(grants)),
    ledTeamIds: [],
    headedDepartmentIds: [],
    ...extra,
  }
}

const intern = (
  overrides: Partial<{
    managerId: string | null
    mentorId: string | null
    teamId: string | null
    departmentId: string | null
  }> = {},
) => ({
  managerId: null,
  mentorId: null,
  teamId: null,
  departmentId: null,
  ...overrides,
})

describe('withinScope', () => {
  const facts = (f: Partial<ResourceFacts> = {}): ResourceFacts => ({ organizationId: ORG, ...f })

  it('OWN covers only the actor’s own records', () => {
    const a = actor({})
    expect(withinScope(a, 'OWN', facts({ ownerUserIds: [ME] }))).toBe(true)
    expect(withinScope(a, 'OWN', facts({ ownerUserIds: ['someone'], interns: [intern({ managerId: ME })] }))).toBe(
      false,
    )
  })

  it('ASSIGNED adds interns the actor manages or mentors', () => {
    const a = actor({})
    expect(withinScope(a, 'ASSIGNED', facts({ interns: [intern({ mentorId: ME })] }))).toBe(true)
    expect(withinScope(a, 'ASSIGNED', facts({ interns: [intern({ managerId: 'another-manager' })] }))).toBe(false)
  })

  it('TEAM and DEPARTMENT follow leadership, and include narrower scopes', () => {
    const lead = actor({}, { ledTeamIds: [TEAM], headedDepartmentIds: [DEPT] })
    expect(withinScope(lead, 'TEAM', facts({ interns: [intern({ teamId: TEAM })] }))).toBe(true)
    expect(withinScope(lead, 'TEAM', facts({ interns: [intern({ departmentId: DEPT })] }))).toBe(false)
    expect(withinScope(lead, 'DEPARTMENT', facts({ interns: [intern({ departmentId: DEPT })] }))).toBe(true)
    expect(withinScope(lead, 'DEPARTMENT', facts({ ownerUserIds: [ME] }))).toBe(true)
  })

  it('ORGANIZATION covers everything in the organization but nothing outside it', () => {
    const a = actor({})
    expect(withinScope(a, 'ORGANIZATION', facts())).toBe(true)
    expect(withinScope(a, 'ORGANIZATION', { organizationId: OTHER_ORG })).toBe(false)
  })
})

describe('authorize', () => {
  it('denies by layer: organization, permission, scope', () => {
    const manager = actor({ 'intern.read': 'ASSIGNED' })
    expect(
      authorize({ actor: manager, permission: 'intern.read', resource: { organizationId: OTHER_ORG } }),
    ).toMatchObject({ allowed: false, layer: 'organization' })
    expect(authorize({ actor: manager, permission: 'intern.update' })).toMatchObject({
      allowed: false,
      layer: 'permission',
    })
    expect(
      authorize({
        actor: manager,
        permission: 'intern.read',
        resource: { organizationId: ORG, interns: [intern({ managerId: 'someone-else' })] },
      }),
    ).toMatchObject({ allowed: false, layer: 'scope' })
    expect(
      authorize({
        actor: manager,
        permission: 'intern.read',
        resource: { organizationId: ORG, interns: [intern({ managerId: ME })] },
      }),
    ).toMatchObject({ allowed: true, decision: 'ALLOWED', scope: 'ASSIGNED' })
  })
})

function record(
  overrides: Partial<ActorRecord> = {},
  roles: { slug: string; rank: number; org?: string; grants: [string, string, PermissionScope][] }[] = [],
): ActorRecord {
  return {
    id: ME,
    organization_id: ORG,
    auth_user_id: 'auth-1',
    email: 'person@example.com',
    first_name: 'Test',
    last_name: 'Person',
    display_name: null,
    avatar_url: null,
    status: 'ACTIVE',
    timezone: null,
    email_verified_at: new Date(),
    deleted_at: null,
    organization: { id: ORG, name: 'Org', slug: 'org', timezone: 'Asia/Kolkata', logo_url: null },
    teams_led: [],
    departments_led: [],
    user_roles: roles.map((role, index) => ({
      role: {
        id: `role-${index}`,
        slug: role.slug,
        name: role.slug,
        rank: role.rank,
        organization_id: role.org ?? ORG,
        role_permissions: role.grants.map(([resource, action, scope]) => ({ scope, permission: { resource, action } })),
      },
    })),
    ...overrides,
  }
}

const session = { authUserId: 'auth-1', email: 'person@example.com', sessionId: 'sess-1', emailVerified: false }

describe('toRequestContext', () => {
  it('unions grants across roles, keeping the broadest scope, and takes the highest rank', () => {
    const ctx = toRequestContext(
      record({}, [
        {
          slug: 'mentor',
          rank: 40,
          grants: [
            ['intern', 'read', 'ASSIGNED'],
            ['feedback', 'create', 'ASSIGNED'],
          ],
        },
        { slug: 'hr', rank: 60, grants: [['intern', 'read', 'ORGANIZATION']] },
      ]),
      session,
    )
    expect(ctx.actor.permissions.get('intern.read')).toBe('ORGANIZATION')
    expect(ctx.actor.permissions.get('feedback.create')).toBe('ASSIGNED')
    expect(ctx.actor.rank).toBe(60)
    expect(ctx.actor.roles.map((role) => role.slug)).toEqual(['hr', 'mentor'])
    expect(ctx.authUser).toEqual({ id: 'auth-1', email: 'person@example.com', sessionId: 'sess-1' })
  })

  it('ignores roles that belong to another organization', () => {
    const ctx = toRequestContext(
      record({}, [
        { slug: 'intern', rank: 10, grants: [['task', 'read', 'ASSIGNED']] },
        { slug: 'super_admin', rank: 100, org: OTHER_ORG, grants: [['audit_log', 'read', 'ORGANIZATION']] },
      ]),
      session,
    )
    expect(ctx.actor.permissions.has('audit_log.read')).toBe(false)
    expect(ctx.actor.rank).toBe(10)
  })
})

describe('classifyAccount', () => {
  const opts = { requireEmailVerification: true }
  it('maps account states', () => {
    expect(classifyAccount(null, session, opts)).toBe('PROFILE_INCOMPLETE')
    expect(classifyAccount(record({ status: 'INVITED' }), session, opts)).toBe('PROFILE_INCOMPLETE')
    expect(classifyAccount(record({ status: 'SUSPENDED' }), session, opts)).toBe('ACCOUNT_SUSPENDED')
    expect(classifyAccount(record({ status: 'INACTIVE' }), session, opts)).toBe('ACCOUNT_INACTIVE')
    expect(classifyAccount(record({ deleted_at: new Date() }), session, opts)).toBe('ACCOUNT_INACTIVE')
    expect(classifyAccount(record({ email_verified_at: null }), session, opts)).toBe('EMAIL_UNVERIFIED')
    expect(classifyAccount(record({ email_verified_at: null }), { ...session, emailVerified: true }, opts)).toBe('OK')
    expect(classifyAccount(record({ email_verified_at: null }), session, { requireEmailVerification: false })).toBe(
      'OK',
    )
    expect(classifyAccount(record(), session, opts)).toBe('OK')
  })

  it('routes each state to the right page', () => {
    expect(redirectPathFor({ status: 'UNAUTHENTICATED' })).toBe('/login')
    expect(redirectPathFor({ status: 'SESSION_EXPIRED' })).toBe('/auth/signout?reason=session_expired')
    expect(redirectPathFor({ status: 'EMAIL_UNVERIFIED', email: 'a@b.c' })).toBe('/verify-email')
    expect(redirectPathFor({ status: 'ACCOUNT_SUSPENDED', email: 'a@b.c' })).toBe('/account-status?state=suspended')
  })
})

describe('authorizationService', () => {
  const ctx = toRequestContext(
    record({}, [{ slug: 'manager', rank: 50, grants: [['intern', 'read', 'ASSIGNED']] }]),
    session,
  )

  it('returns the scope for granted permissions and throws 403 otherwise', () => {
    expect(authorizationService.require(ctx, 'intern.read')).toBe('ASSIGNED')
    expect(() => authorizationService.require(ctx, 'intern.update')).toThrow(ForbiddenError)
  })

  it('reports out-of-scope and cross-organization records as not found', () => {
    expect(() =>
      authorizationService.authorizeResource(
        ctx,
        'intern.read',
        { organizationId: ORG, interns: [intern({ managerId: 'x' })] },
        { resourceType: 'Intern' },
      ),
    ).toThrow(NotFoundError)
    expect(() => authorizationService.authorizeResource(ctx, 'intern.read', { organizationId: OTHER_ORG })).toThrow(
      NotFoundError,
    )
    expect(() => authorizationService.authorizeResource(ctx, 'intern.update', { organizationId: ORG })).toThrow(
      ForbiddenError,
    )
  })
})
