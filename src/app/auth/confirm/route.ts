import { NextResponse, type NextRequest } from 'next/server'
import { getRequestMeta } from '@/lib/http/request-meta'
import { authService } from '@/server/services/auth.service'

export const dynamic = 'force-dynamic'

/**
 * Landing point for links in auth emails (password reset, email
 * confirmation). Exchanges the one-time token for a session, then redirects.
 * Tokens are never logged.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const target = await authService.confirmLink(
    {
      tokenHash: params.get('token_hash') ?? undefined,
      type: params.get('type') ?? undefined,
      code: params.get('code') ?? undefined,
      next: params.get('next') ?? undefined,
    },
    await getRequestMeta(),
  )
  const url = new URL(target, request.nextUrl.origin)
  const response = NextResponse.redirect(url)
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}
