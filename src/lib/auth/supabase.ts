import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { config } from '@/lib/config'

/**
 * Supabase clients — server-side only.
 *
 * The application never creates a browser Supabase client: every auth call
 * runs on the server (server actions, route handlers, proxy). That lets the
 * session cookies be httpOnly, so page scripts can never read tokens, and it
 * keeps rate limiting and audit logging on the server.
 */

export const AUTH_COOKIE_OPTIONS = {
  path: '/',
  sameSite: 'lax' as const,
  httpOnly: true,
  secure: config.isProduction,
}

export function isSupabaseConfigured(): boolean {
  return config.auth.configured
}

export function isSupabaseAdminConfigured(): boolean {
  return Boolean(config.supabase.url && config.supabase.serviceRoleKey)
}

function requireAuthConfig() {
  const { url, anonKey } = config.supabase
  if (!url || !anonKey) throw new Error('Supabase Auth is not configured (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY)')
  return { url, anonKey }
}

/**
 * Cookie-bound client for Server Components, Server Actions and Route
 * Handlers. In Server Components cookies are read-only; the proxy refreshes
 * sessions, so failed writes there are safe to ignore.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const { url, anonKey } = requireAuthConfig()
  const cookieStore = await cookies()
  return createServerClient(url, anonKey, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet)
            cookieStore.set(name, value, { ...options, ...AUTH_COOKIE_OPTIONS })
        } catch {
          // Called from a Server Component: the proxy persists refreshed sessions.
        }
      },
    },
  })
}

/** Stateless client (no cookies) — used to verify a password without touching the session. */
export function createSupabaseStatelessClient(): SupabaseClient {
  const { url, anonKey } = requireAuthConfig()
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** Service-role client: bypasses Supabase policies. Trusted server code only. */
export function createSupabaseAdminClient(): SupabaseClient | null {
  const { url, serviceRoleKey } = config.supabase
  return url && serviceRoleKey
    ? createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null
}
