import { randomUUID } from 'node:crypto'
import type {
  AuthProvider,
  AuthSession,
  ExchangeResult,
  SignInResult,
  SignUpResult,
  UpdatePasswordResult,
} from '@/lib/auth/provider'

interface FakeUser {
  id: string
  email: string
  password: string
  confirmedAt: Date | null
  blocked: boolean
}

/**
 * In-memory stand-in for Supabase Auth, implementing the same AuthProvider
 * contract. Lets integration tests drive every authentication flow against
 * the real database without network access.
 */
export class FakeAuthProvider implements AuthProvider {
  readonly configured = true
  users = new Map<string, FakeUser>()
  session: AuthSession | null = null
  calls: { method: string; args: unknown[] }[] = []
  /** When true, sign-up confirms the email immediately and creates a session. */
  autoConfirmSignUp = false
  /** One-time link tokens: token → { email, type }. */
  links = new Map<string, { email: string; type: 'recovery' | 'signup' }>()

  addUser(email: string, password: string, options: { confirmed?: boolean; id?: string } = {}) {
    const user: FakeUser = {
      id: options.id ?? randomUUID(),
      email: email.toLowerCase(),
      password,
      confirmedAt: options.confirmed === false ? null : new Date(),
      blocked: false,
    }
    this.users.set(user.email, user)
    return user
  }

  /** Simulates an existing browser session for a user. */
  signInAs(email: string, sessionId: string = randomUUID()) {
    const user = this.users.get(email.toLowerCase())
    if (!user) throw new Error(`fake auth: no user ${email}`)
    this.session = { authUserId: user.id, email: user.email, sessionId, emailVerified: Boolean(user.confirmedAt) }
    return this.session
  }

  private record(method: string, ...args: unknown[]) {
    this.calls.push({ method, args })
  }

  async getSession() {
    return this.session
  }

  async signInWithPassword(email: string, password: string): Promise<SignInResult> {
    this.record('signInWithPassword', email)
    const user = this.users.get(email.toLowerCase())
    if (!user || user.password !== password || user.blocked) return { ok: false, reason: 'invalid_credentials' }
    if (!user.confirmedAt) return { ok: false, reason: 'email_not_confirmed' }
    const session = this.signInAs(email)
    return {
      ok: true,
      user: { id: user.id, email: user.email, emailConfirmedAt: user.confirmedAt },
      sessionId: session.sessionId,
    }
  }

  async signOut(scope: 'local' | 'others' | 'global') {
    this.record('signOut', scope)
    if (scope !== 'others') this.session = null
  }

  async verifyPassword(email: string, password: string) {
    const user = this.users.get(email.toLowerCase())
    return Boolean(user && user.password === password && !user.blocked)
  }

  async requestPasswordReset(email: string, redirectTo: string) {
    this.record('requestPasswordReset', email, redirectTo)
    if (this.users.has(email.toLowerCase()))
      this.links.set(`recovery-${randomUUID()}`, { email: email.toLowerCase(), type: 'recovery' })
  }

  async updatePassword(newPassword: string): Promise<UpdatePasswordResult> {
    this.record('updatePassword')
    if (!this.session) return { ok: false, reason: 'no_session' }
    const user = [...this.users.values()].find((u) => u.id === this.session!.authUserId)!
    if (user.password === newPassword) return { ok: false, reason: 'same_password' }
    user.password = newPassword
    return { ok: true }
  }

  async exchangeLink(params: { tokenHash?: string; code?: string }): Promise<ExchangeResult> {
    const token = params.tokenHash ?? params.code ?? ''
    const link = this.links.get(token)
    if (!link) return { ok: false, reason: token.startsWith('expired') ? 'expired' : 'invalid' }
    this.links.delete(token)
    const user = this.users.get(link.email)!
    if (link.type === 'signup') user.confirmedAt = new Date()
    const session = this.signInAs(user.email)
    return {
      ok: true,
      user: { id: user.id, email: user.email, emailConfirmedAt: user.confirmedAt },
      sessionId: session.sessionId,
    }
  }

  async signUp(email: string, password: string): Promise<SignUpResult> {
    this.record('signUp', email)
    if (this.users.has(email.toLowerCase())) return { ok: false, reason: 'already_registered' }
    const user = this.addUser(email, password, { confirmed: this.autoConfirmSignUp })
    if (this.autoConfirmSignUp) this.signInAs(email)
    else this.links.set(`signup-${user.id}`, { email: user.email, type: 'signup' })
    return { ok: true, userId: user.id, sessionCreated: this.autoConfirmSignUp, emailConfirmedAt: user.confirmedAt }
  }

  async resendVerification(email: string) {
    this.record('resendVerification', email)
  }

  async setBlocked(authUserId: string, blocked: boolean) {
    this.record('setBlocked', authUserId, blocked)
    const user = [...this.users.values()].find((u) => u.id === authUserId)
    if (user) user.blocked = blocked
    return Boolean(user)
  }
}
