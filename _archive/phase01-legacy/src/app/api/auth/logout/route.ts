import { NextRequest, NextResponse } from 'next/server'
import { authService } from '@/server/services/auth.service'

export async function POST(request: NextRequest) {
  try {
    const sessionToken = request.headers.get('authorization')?.replace('Bearer ', '')

    if (!sessionToken) {
      return NextResponse.json(
        { success: false, error: 'No session token provided' },
        { status: 401 }
      )
    }

    await authService.logout(sessionToken)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Logout API error:', error)
    return NextResponse.json(
      { success: false, error: 'An error occurred' },
      { status: 500 }
    )
  }
}
