import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { prisma } from '@/lib/db/client'
import { authService } from '@/server/services/auth.service'
import { authorizationService } from '@/server/services/authorization.service'
import { PERMISSIONS } from '@/lib/auth'

describe('Authentication Service', () => {
  let testUserId: string
  let testOrganizationId: string

  beforeEach(async () => {
    // Create test organization
    const org = await prisma.organization.create({
      data: {
        name: 'Test Organization',
        slug: 'test-org-auth',
      },
    })
    testOrganizationId = org.id

    // Create test user
    const user = await prisma.user.create({
      data: {
        organization_id: testOrganizationId,
        email: 'test@example.com',
        passwordHash: await (await import('bcryptjs')).hash('password123', 10),
        first_name: 'Test',
        last_name: 'User',
        role: 'INTERN',
        status: 'ACTIVE',
        is_active: true,
      },
    })
    testUserId = user.id
  })

  afterEach(async () => {
    // Clean up test data
    await prisma.session.deleteMany({ where: { user_id: testUserId } })
    await prisma.user.delete({ where: { id: testUserId } })
    await prisma.organization.delete({ where: { id: testOrganizationId } })
  })

  it('should login with valid credentials', async () => {
    const result = await authService.login({
      email: 'test@example.com',
      password: 'password123',
    })

    expect(result.success).toBe(true)
    expect(result.user).toBeDefined()
    expect(result.user?.email).toBe('test@example.com')
    expect(result.session).toBeDefined()
    expect(result.session?.token).toBeDefined()
  })

  it('should fail login with invalid credentials', async () => {
    const result = await authService.login({
      email: 'test@example.com',
      password: 'wrongpassword',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('should fail login for inactive user', async () => {
    await prisma.user.update({
      where: { id: testUserId },
      data: { is_active: false },
    })

    const result = await authService.login({
      email: 'test@example.com',
      password: 'password123',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('inactive')
  })

  it('should validate session', async () => {
    const loginResult = await authService.login({
      email: 'test@example.com',
      password: 'password123',
    })

    const user = await authService.validateSession(loginResult.session!.token)
    expect(user).toBeDefined()
    expect(user?.id).toBe(testUserId)
  })

  it('should logout successfully', async () => {
    const loginResult = await authService.login({
      email: 'test@example.com',
      password: 'password123',
    })

    const logoutResult = await authService.logout(loginResult.session!.token)
    expect(logoutResult).toBe(true)

    const user = await authService.validateSession(loginResult.session!.token)
    expect(user).toBeNull()
  })

  it('should create invitation', async () => {
    const result = await authService.createInvitation(
      'newuser@example.com',
      'INTERN',
      testOrganizationId,
      testUserId
    )

    expect(result.success).toBe(true)
    expect(result.token).toBeDefined()
  })

  it('should fail to create invitation for existing user', async () => {
    const result = await authService.createInvitation(
      'test@example.com',
      'INTERN',
      testOrganizationId,
      testUserId
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('already exists')
  })
})

describe('Authorization Service', () => {
  let testUserId: string
  let testOrganizationId: string

  beforeEach(async () => {
    // Create test organization
    const org = await prisma.organization.create({
      data: {
        name: 'Test Organization',
        slug: 'test-org-authz',
      },
    })
    testOrganizationId = org.id

    // Create test user with ADMIN role
    const user = await prisma.user.create({
      data: {
        organization_id: testOrganizationId,
        email: 'admin@example.com',
        passwordHash: await (await import('bcryptjs')).hash('password123', 10),
        first_name: 'Admin',
        last_name: 'User',
        role: 'ADMIN',
        status: 'ACTIVE',
        is_active: true,
      },
    })
    testUserId = user.id
  })

  afterEach(async () => {
    await prisma.user.delete({ where: { id: testUserId } })
    await prisma.organization.delete({ where: { id: testOrganizationId } })
  })

  it('should check permission for user', async () => {
    const hasPermission = await authorizationService.hasPermission(
      testUserId,
      PERMISSIONS.USERS_READ
    )

    expect(hasPermission).toBe(true)
  })

  it('should deny permission for unauthorized user', async () => {
    const hasPermission = await authorizationService.hasPermission(
      testUserId,
      PERMISSIONS.PERMISSIONS_MANAGE
    )

    expect(hasPermission).toBe(false)
  })

  it('should authorize user with valid permission', async () => {
    const result = await authorizationService.authorize({
      userId: testUserId,
      permission: PERMISSIONS.USERS_READ,
      organizationId: testOrganizationId,
    })

    expect(result.allowed).toBe(true)
  })

  it('should deny authorization for invalid permission', async () => {
    const result = await authorizationService.authorize({
      userId: testUserId,
      permission: PERMISSIONS.PERMISSIONS_MANAGE,
      organizationId: testOrganizationId,
    })

    expect(result.allowed).toBe(false)
    expect(result.reason).toBeDefined()
  })

  it('should deny authorization for wrong organization', async () => {
    const result = await authorizationService.authorize({
      userId: testUserId,
      permission: PERMISSIONS.USERS_READ,
      organizationId: 'different-org-id',
    })

    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Organization')
  })

  it('should get user permissions', async () => {
    const permissions = await authorizationService.getUserPermissions(testUserId)

    expect(permissions).toBeDefined()
    expect(Array.isArray(permissions)).toBe(true)
    expect(permissions.length).toBeGreaterThan(0)
  })

  it('should check user role', async () => {
    const hasRole = await authorizationService.hasRole(testUserId, 'ADMIN')

    expect(hasRole).toBe(true)
  })

  it('should check if user has any of specified roles', async () => {
    const hasAnyRole = await authorizationService.hasAnyRole(testUserId, ['ADMIN', 'SUPER_ADMIN'])

    expect(hasAnyRole).toBe(true)
  })
})
