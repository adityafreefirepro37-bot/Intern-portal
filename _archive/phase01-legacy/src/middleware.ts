import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const publicPaths = ['/auth/login', '/auth/forgot-password', '/auth/reset-password', '/auth/invite']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public paths
  if (publicPaths.some(path => pathname.startsWith(path))) {
    return NextResponse.next()
  }

  // Allow root path for now (will be protected in subsequent phases)
  if (pathname === '/') {
    return NextResponse.next()
  }

  // Check for session token
  const sessionToken = request.cookies.get('session_token')?.value || 
                       request.headers.get('authorization')?.replace('Bearer ', '')

  if (!sessionToken) {
    // Redirect to login for protected routes
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!api|_next/static|_next/image|favicon.ico|public).*)',
  ],
}
