import 'server-only'

/**
 * Authentication seam.
 *
 * `getAuthIdentity()` answers "who signed in?" using the auth provider
 * (Supabase Auth). It returns the provider's user id, which maps to
 * `users.auth_user_id`. Everything else — organization, roles, permissions —
 * is resolved from our own database by the request context
 * (src/server/context.ts), so swapping auth providers never touches business
 * logic.
 *
 * Phase 01: sign-in is not implemented yet, so there is never an identity.
 * Prompt 02 implements this with @supabase/ssr cookie sessions (httpOnly,
 * Secure, SameSite=Lax) and adds the /login flow.
 */
export interface AuthIdentity {
  authUserId: string
  email: string
}

export async function getAuthIdentity(): Promise<AuthIdentity | null> {
  return null
}
