import { setAuthProviderForTesting } from '@/lib/auth/provider'
import { AppError, UnauthenticatedError, ValidationError } from '@/lib/errors'
import { getAuthState, requireApiContext, requirePageContext } from '@/server/context'
import { AUDIT_ACTIONS } from '@/server/services/audit-actions'
import { authService, GENERIC_LOGIN_ERROR } from '@/server/services/auth.service'
import { sessionService } from '@/server/services/session.service'
import { userService } from '@/server/services/user.service'
import type { FakeAuthProvider } from './fake-auth'
import { contextFor, createUser, meta, prisma, uniqueSuffix, useFakeAuth } from './helpers'

let fake: FakeAuthProvider

beforeEach(() => {
  fake = useFakeAuth()
})
afterAll(async () => {
  setAuthProviderForTesting(null)
  await prisma.$disconnect()
})

async function latestAudit(action: string, actorUserId?: string) {
  return prisma.auditLog.findFirst({
    where: { action, ...(actorUserId ? { actor_user_id: actorUserId } : {}) },
    orderBy: { created_at: 'desc' },
  })
}

describe('sign in', () => {
  it('signs in an active user, records the session and audits success', async () => {
    const { user, email, password } = await createUser(fake, { role: 'intern' })
    const outcome = await authService.signIn({ email, password, next: '/tasks' }, meta())
    expect(outcome).toEqual({ ok: true, redirectTo: '/tasks' })

    const session = await prisma.userSession.findUnique({ where: { auth_session_id: fake.session!.sessionId! } })
    expect(session?.user_id).toBe(user.id)
    expect(session?.user_agent).toBe('jest-integration')
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).last_login_at).not.toBeNull()
    expect(await latestAudit(AUDIT_ACTIONS.LOGIN_SUCCESS, user.id)).not.toBeNull()

    const state = await getAuthState()
    expect(state.status).toBe('AUTHENTICATED')
  })

  it('returns the same generic error for a wrong password and an unknown email', async () => {
    const { email } = await createUser(fake, { role: 'intern' })
    const wrong = await authService.signIn({ email, password: 'not-the-password' }, meta())
    const unknown = await authService.signIn(
      { email: `nobody-${uniqueSuffix()}@test.ayava.dev`, password: 'whatever-123' },
      meta(),
    )
    expect(wrong).toEqual({ ok: false, state: 'INVALID', message: GENERIC_LOGIN_ERROR })
    expect(unknown).toEqual(wrong)
    const failure = await latestAudit(AUDIT_ACTIONS.LOGIN_FAILURE)
    expect(failure?.status).toBe('FAILURE')
    expect(JSON.stringify(failure?.metadata)).not.toContain('not-the-password')
  })

  it.each([
    ['SUSPENDED', 'ACCOUNT_SUSPENDED'],
    ['INACTIVE', 'ACCOUNT_INACTIVE'],
    ['INVITED', 'PROFILE_INCOMPLETE'],
  ] as const)('denies a %s account and ends the provider session', async (status, state) => {
    const { email, password } = await createUser(fake, { role: 'intern', status })
    const outcome = await authService.signIn({ email, password }, meta())
    expect(outcome).toMatchObject({ ok: false, state })
    expect(fake.session).toBeNull()
    expect(fake.calls.some((call) => call.method === 'signOut')).toBe(true)
  })

  it('denies a sign-in account that has no application profile', async () => {
    const email = `orphan-${uniqueSuffix()}@test.ayava.dev`
    fake.addUser(email, 'Orphan-passphrase-1')
    expect(await authService.signIn({ email, password: 'Orphan-passphrase-1' }, meta())).toMatchObject({
      ok: false,
      state: 'PROFILE_INCOMPLETE',
    })
  })

  it('reports unconfirmed emails and sends unverified users to verification', async () => {
    const unconfirmed = await createUser(fake, { role: 'intern', verified: false })
    fake.users.get(unconfirmed.email)!.confirmedAt = null
    expect(
      await authService.signIn({ email: unconfirmed.email, password: unconfirmed.password }, meta()),
    ).toMatchObject({
      ok: false,
      state: 'EMAIL_UNVERIFIED',
    })
  })

  it('never redirects off-site after sign-in', async () => {
    const { email, password } = await createUser(fake, { role: 'intern' })
    expect(await authService.signIn({ email, password, next: '//evil.example/steal' }, meta())).toEqual({
      ok: true,
      redirectTo: '/',
    })
  })

  it('rate-limits repeated failures for an account', async () => {
    const { email, password } = await createUser(fake, { role: 'intern' })
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await authService.signIn({ email, password: `wrong-${attempt}` }, meta())
    }
    // Even the correct password is refused while the account is throttled.
    const outcome = await authService.signIn({ email, password }, meta())
    expect(outcome).toMatchObject({ ok: false, state: 'RATE_LIMITED' })
  })

  it('validates input before contacting the provider', async () => {
    await expect(authService.signIn({ email: 'not-an-email', password: '' }, meta())).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(fake.calls).toHaveLength(0)
  })
})

describe('auth states and protected access', () => {
  it('treats a missing session as unauthenticated (401 for APIs, redirect for pages)', async () => {
    expect((await getAuthState()).status).toBe('UNAUTHENTICATED')
    await expect(requireApiContext()).rejects.toBeInstanceOf(UnauthenticatedError)
    await expect(requirePageContext()).rejects.toMatchObject({ digest: expect.stringContaining('/login') })
  })

  it('blocks a user suspended mid-session on their next request', async () => {
    const { user, email } = await createUser(fake, { role: 'intern' })
    fake.signInAs(email)
    expect((await getAuthState()).status).toBe('AUTHENTICATED')
    const admin = await contextFor('admin@ayavacreatives.com')
    await userService.setStatus(admin, { userId: user.id, status: 'SUSPENDED' })
    expect((await getAuthState()).status).toBe('ACCOUNT_SUSPENDED')
    await expect(requireApiContext()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(fake.calls).toContainEqual({ method: 'setBlocked', args: [user.auth_user_id, true] })
  })

  it('requires email verification when configured', async () => {
    const { email } = await createUser(fake, { role: 'intern', verified: false })
    fake.users.get(email)!.confirmedAt = null
    fake.signInAs(email)
    expect((await getAuthState()).status).toBe('EMAIL_UNVERIFIED')
    await expect(requirePageContext()).rejects.toMatchObject({ digest: expect.stringContaining('/verify-email') })
  })

  it('rejects a revoked session and lets the owner revoke other sessions', async () => {
    const { email } = await createUser(fake, { role: 'intern' })
    const other = fake.signInAs(email)
    await getAuthState() // records the "other device" session
    fake.signInAs(email)
    const current = await getAuthState()
    if (current.status !== 'AUTHENTICATED') throw new Error('expected authenticated')

    const sessions = await sessionService.listOwn(current.context)
    expect(sessions).toHaveLength(2)
    const otherRow = sessions.find((session) => !session.current)!
    await sessionService.revoke(current.context, otherRow.id)

    fake.session = { ...fake.session!, sessionId: other.sessionId }
    expect((await getAuthState()).status).toBe('SESSION_EXPIRED')
    expect(await latestAudit(AUDIT_ACTIONS.SESSION_REVOKED)).not.toBeNull()
  })

  it('cannot revoke another user’s session (IDOR)', async () => {
    const victim = await createUser(fake, { role: 'intern' })
    fake.signInAs(victim.email)
    await getAuthState()
    const victimSession = await prisma.userSession.findFirstOrThrow({ where: { user_id: victim.user.id } })

    const attacker = await createUser(fake, { role: 'intern' })
    fake.signInAs(attacker.email)
    const state = await getAuthState()
    if (state.status !== 'AUTHENTICATED') throw new Error('expected authenticated')
    await expect(sessionService.revoke(state.context, victimSession.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await prisma.userSession.findUniqueOrThrow({ where: { id: victimSession.id } })).revoked_at).toBeNull()
  })
})

describe('logout', () => {
  it('ends the session, revokes the session record and audits', async () => {
    const { email } = await createUser(fake, { role: 'intern' })
    fake.signInAs(email)
    const state = await getAuthState()
    if (state.status !== 'AUTHENTICATED') throw new Error('expected authenticated')
    await authService.signOut(state.context, meta())
    expect(fake.session).toBeNull()
    const record = await prisma.userSession.findUniqueOrThrow({
      where: { auth_session_id: state.context.authUser.sessionId! },
    })
    expect(record.revoked_reason).toBe('signed_out')
    expect((await getAuthState()).status).toBe('UNAUTHENTICATED')
    expect(await latestAudit(AUDIT_ACTIONS.LOGOUT, state.context.actor.userId)).not.toBeNull()
  })
})

describe('password reset and change', () => {
  it('responds identically for known and unknown emails and audits the request', async () => {
    const { email } = await createUser(fake, { role: 'intern' })
    await expect(authService.requestPasswordReset({ email }, meta())).resolves.toBeUndefined()
    const ghost = `ghost-${uniqueSuffix()}@test.ayava.dev`
    await expect(authService.requestPasswordReset({ email: ghost }, meta())).resolves.toBeUndefined()
    const audit = await latestAudit(AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED)
    // Only a masked address is stored (domain kept for triage, mailbox name hidden).
    expect(JSON.stringify(audit?.metadata)).not.toContain(ghost.split('@')[0])
  })

  it('rate-limits reset requests per email', async () => {
    const email = `reset-${uniqueSuffix()}@test.ayava.dev`
    for (let i = 0; i < 5; i += 1) await authService.requestPasswordReset({ email }, meta())
    await expect(authService.requestPasswordReset({ email }, meta())).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })

  it('completes a reset through the emailed link and signs out other sessions', async () => {
    const { user, email } = await createUser(fake, { role: 'intern' })
    await authService.requestPasswordReset({ email }, meta())
    const token = [...fake.links.entries()].find(([, link]) => link.email === email)![0]
    expect(await authService.confirmLink({ tokenHash: token, type: 'recovery' }, meta())).toBe('/reset-password')

    await expect(
      authService.completePasswordReset({ password: 'short', confirmPassword: 'short' }, meta()),
    ).rejects.toBeInstanceOf(ValidationError)
    await authService.completePasswordReset(
      { password: 'a brand new passphrase', confirmPassword: 'a brand new passphrase' },
      meta(),
    )
    expect(fake.users.get(email)!.password).toBe('a brand new passphrase')
    expect(fake.calls).toContainEqual({ method: 'signOut', args: ['others'] })
    expect(await latestAudit(AUDIT_ACTIONS.PASSWORD_RESET_COMPLETED, user.id)).not.toBeNull()
  })

  it('rejects expired and invalid reset links without a session', async () => {
    expect(await authService.confirmLink({ tokenHash: 'expired-token', type: 'recovery' }, meta())).toBe(
      '/reset-password?error=expired',
    )
    expect(await authService.confirmLink({ tokenHash: 'made-up', type: 'recovery' }, meta())).toBe(
      '/reset-password?error=invalid',
    )
    await expect(
      authService.completePasswordReset(
        { password: 'a brand new passphrase', confirmPassword: 'a brand new passphrase' },
        meta(),
      ),
    ).rejects.toBeInstanceOf(AppError)
  })

  it('requires the current password to change it', async () => {
    const { email, password } = await createUser(fake, { role: 'intern' })
    fake.signInAs(email)
    const state = await getAuthState()
    if (state.status !== 'AUTHENTICATED') throw new Error('expected authenticated')
    await expect(
      authService.changePassword(
        state.context,
        { currentPassword: 'wrong-one', password: 'another good phrase', confirmPassword: 'another good phrase' },
        meta(),
      ),
    ).rejects.toMatchObject({ fields: { currentPassword: 'Incorrect password' } })
    await authService.changePassword(
      state.context,
      { currentPassword: password, password: 'another good phrase', confirmPassword: 'another good phrase' },
      meta(),
    )
    expect(fake.users.get(email)!.password).toBe('another good phrase')
  })
})

describe('email verification', () => {
  it('marks the application user verified when the confirmation link is used', async () => {
    const { user, email } = await createUser(fake, { role: 'intern', verified: false })
    const fakeUser = fake.users.get(email)!
    fakeUser.confirmedAt = null
    fake.links.set('confirm-token', { email, type: 'signup' })
    expect(await authService.confirmLink({ tokenHash: 'confirm-token', type: 'signup', next: '/' }, meta())).toBe('/')
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email_verified_at).not.toBeNull()
    expect((await getAuthState()).status).toBe('AUTHENTICATED')
  })
})
