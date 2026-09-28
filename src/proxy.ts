import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { buildContentSecurityPolicy, generateNonce } from '@/lib/security/csp'

/**
 * Runs before every page, API route and Server Action request:
 *
 *  1. Sets a nonce-based Content Security Policy.
 *  2. Refreshes the Supabase session (rotating cookies when tokens expire).
 *  3. Optimistic route protection: signed-out visitors are redirected to
 *     /login (pages) or get a 401 JSON error (API routes).
 *
 * This is NOT the authorization layer. Every page, route handler and server
 * action resolves the user and checks permissions on its own (see
 * src/server/context.ts); the proxy only avoids rendering protected pages for
 * visitors who clearly aren't signed in.
 */

const PUBLIC_PATHS = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/account-status',
  '/invite',
  '/auth',
  '/api/health',
]
const SIGNED_IN_BOUNCE = ['/login', '/forgot-password']

const isDev = process.env.NODE_ENV !== 'production'
const supabaseUrl = process.env.SUPABASE_URL?.trim()
const supabaseAnonKey = (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY)?.trim()
const supabaseOrigin = (() => {
  try {
    return supabaseUrl ? new URL(supabaseUrl).origin : undefined
  } catch {
    return undefined
  }
})()

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

function hasAuthCookie(request: NextRequest) {
  return request.cookies.getAll().some((cookie) => cookie.name.startsWith('sb-') && cookie.name.includes('-auth-token'))
}

export async function proxy(request: NextRequest) {
  const nonce = generateNonce()
  const csp = buildContentSecurityPolicy({ nonce, isDev, supabaseOrigin })

  const nextResponse = () => {
    const headers = new Headers(request.headers)
    headers.set('x-nonce', nonce)
    headers.set('content-security-policy', csp)
    return NextResponse.next({ request: { headers } })
  }

  let response = nextResponse()
  const cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[] = []
  const cacheHeaders: Record<string, string> = {}
  let signedIn = false

  if (supabaseUrl && supabaseAnonKey) {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookieOptions: { path: '/', sameSite: 'lax', httpOnly: true, secure: !isDev },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet, headers) => {
          for (const { name, value } of toSet) request.cookies.set(name, value)
          response = nextResponse()
          for (const cookie of toSet) cookiesToSet.push(cookie)
          Object.assign(cacheHeaders, headers)
        },
      },
    })
    // Validates the JWT (and refreshes the session when needed).
    const { data } = await supabase.auth.getClaims()
    signedIn = Boolean(data?.claims?.sub)
  }

  const { pathname, search } = request.nextUrl
  let result: NextResponse = response

  if (!signedIn && !isPublic(pathname)) {
    if (pathname.startsWith('/api/')) {
      result = NextResponse.json(
        { success: false, error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } },
        { status: 401 },
      )
    } else {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.search = ''
      if (pathname !== '/') url.searchParams.set('next', pathname + search)
      if (hasAuthCookie(request)) url.searchParams.set('reason', 'session_expired')
      result = NextResponse.redirect(url)
    }
  } else if (signedIn && SIGNED_IN_BOUNCE.includes(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    result = NextResponse.redirect(url)
  }

  for (const { name, value, options } of cookiesToSet) result.cookies.set(name, value, options)
  for (const [key, value] of Object.entries(cacheHeaders)) result.headers.set(key, value)
  result.headers.set('Content-Security-Policy', csp)
  return result
}

export const config = {
  matcher: [
    // Everything except static assets and image optimization.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
