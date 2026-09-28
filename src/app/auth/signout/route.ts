import { NextResponse, type NextRequest } from 'next/server'
import { getAuthProvider } from '@/lib/auth/provider'
import { getAuthState } from '@/server/context'

export const dynamic = 'force-dynamic'

/**
 * Clears session cookies for a session the application no longer accepts
 * (revoked or expired). It refuses to sign out a valid session, so a forged
 * GET request cannot log anyone out — deliberate sign-out uses a POST
 * server action.
 */
export async function GET(request: NextRequest) {
  const state = await getAuthState()
  const url = new URL('/login', request.nextUrl.origin)
  if (state.status === 'AUTHENTICATED') return NextResponse.redirect(new URL('/', request.nextUrl.origin))
  await getAuthProvider().signOut('local')
  const reason = request.nextUrl.searchParams.get('reason')
  if (reason === 'session_expired') url.searchParams.set('reason', 'session_expired')
  return NextResponse.redirect(url)
}
