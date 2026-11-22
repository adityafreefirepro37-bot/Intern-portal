import { NextResponse, type NextRequest } from 'next/server'
import { jsonError, jsonSuccess } from '@/lib/http/response'
import { unsubscribeByToken } from '@/server/services/outreach.service'

export const dynamic = 'force-dynamic'

/**
 * POST /api/outreach/unsubscribe/:token — one-click unsubscribe (RFC 8058, the
 * List-Unsubscribe header mail apps show) and the confirm button on the page.
 * GET (the link in the email footer) opens the confirmation page, so link
 * scanners that open every link don't unsubscribe anyone.
 */
export async function POST(_request: NextRequest, { params }: RouteContext<'/api/outreach/unsubscribe/[token]'>) {
  try {
    const { token } = await params
    return jsonSuccess(await unsubscribeByToken(token))
  } catch (error) {
    return jsonError(error, { route: 'outreach.unsubscribe' })
  }
}

export async function GET(request: NextRequest, { params }: RouteContext<'/api/outreach/unsubscribe/[token]'>) {
  const { token } = await params
  return NextResponse.redirect(new URL(`/unsubscribe/${encodeURIComponent(token)}`, request.url), 303)
}
