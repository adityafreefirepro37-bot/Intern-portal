import { randomUUID } from 'node:crypto'
import { setAuthProviderForTesting } from '@/lib/auth/provider'
import { prisma } from '@/lib/db/client'
import type { RequestMeta } from '@/lib/http/request-meta'
import { toRequestContext, type RequestContext } from '@/server/context'
import { identityRepository } from '@/server/repositories/identity.repository'
import { AYAVA_ORGANIZATION_ID } from '../../prisma/seed/ids'
import { FakeAuthProvider } from './fake-auth'

export { prisma, AYAVA_ORGANIZATION_ID }

/** Builds a request context for a seeded (active) user, exactly as the app does. */
export async function contextFor(email: string, organizationSlug = 'ayava-creatives'): Promise<RequestContext> {
  const record = await identityRepository.findActiveByEmail(organizationSlug, email)
  if (!record) throw new Error(`Seeded user ${email} not found`)
  return toRequestContext(record, {
    authUserId: record.auth_user_id ?? randomUUID(),
    email: record.email,
    sessionId: randomUUID(),
  })
}

/** Installs a fresh fake auth provider for the test. */
export function useFakeAuth(): FakeAuthProvider {
  const fake = new FakeAuthProvider()
  setAuthProviderForTesting(fake)
  return fake
}

export function setRequest(options: { ip?: string; userAgent?: string }) {
  ;(globalThis as unknown as { __setTestRequest: (o: typeof options) => void }).__setTestRequest(options)
}

export function uniqueSuffix() {
  return Math.random().toString(36).slice(2, 10)
}

/** A random documentation-range IP so rate-limit buckets never collide between tests. */
export function uniqueIp() {
  return `198.51.100.${Math.floor(Math.random() * 250) + 1}`
}

export function meta(ip = uniqueIp()): RequestMeta {
  return { ipAddress: ip, userAgent: 'jest-integration' }
}

/**
 * Creates an application user with a role and a linked fake auth account.
 */
export async function createUser(
  fake: FakeAuthProvider,
  options: {
    role: string
    status?: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE' | 'INVITED'
    verified?: boolean
    password?: string
    organizationId?: string
  },
) {
  const suffix = uniqueSuffix()
  const email = `${options.role}-${suffix}@test.ayava.dev`
  const password = options.password ?? `Passphrase-${suffix}-ok`
  const authUser = fake.addUser(email, password, { confirmed: options.verified !== false })
  const organizationId = options.organizationId ?? AYAVA_ORGANIZATION_ID
  const role = await prisma.role.findFirstOrThrow({ where: { organization_id: organizationId, slug: options.role } })
  const user = await prisma.user.create({
    data: {
      organization_id: organizationId,
      email,
      first_name: 'Test',
      last_name: options.role,
      status: options.status ?? 'ACTIVE',
      auth_user_id: authUser.id,
      email_verified_at: options.verified === false ? null : new Date(),
      user_roles: { create: { role_id: role.id } },
    },
  })
  return { user, email, password, authUser }
}

/** Expects a Prisma operation to be rejected by a database constraint. */
export async function expectDbRejection(operation: Promise<unknown>, pattern?: RegExp) {
  let error: unknown
  try {
    await operation
  } catch (caught) {
    error = caught
  }
  expect(error).toBeDefined()
  if (pattern) expect(String((error as Error).message)).toMatch(pattern)
}
