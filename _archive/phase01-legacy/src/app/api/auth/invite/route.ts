import { NextRequest, NextResponse } from 'next/server'
import { authService } from '@/server/services/auth.service'
import { authorizationService } from '@/server/services/authorization.service'
import { PERMISSIONS } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, role, organizationId } = body

    if (!email || !role || !organizationId) {
      return NextResponse.json(
        { success: false, error: 'Email, role, and organizationId are required' },
        { status: 400 }
      )
    }

    // Get current user from session
    const sessionToken = request.headers.get('authorization')?.replace('Bearer ', '')
    if (!sessionToken) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const currentUser = await authService.validateSession(sessionToken)
    if (!currentUser) {
      return NextResponse.json(
        { success: false, error: 'Invalid session' },
        { status: 401 }
      )
    }

    // Check if user has permission to create invitations
    const hasPermission = await authorizationService.hasPermission(
      currentUser.id,
      PERMISSIONS.USERS_CREATE
    )

    if (!hasPermission) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      )
    }

    const result = await authService.createInvitation(
      email,
      role,
      organizationId,
      currentUser.id
    )

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      )
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Invite API error:', error)
    return NextResponse.json(
      { success: false, error: 'An error occurred' },
      { status: 500 }
    )
  }
}
