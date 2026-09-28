import { prisma } from '@/lib/db/client'
import { supabase, supabaseAdmin } from '@/lib/auth/supabase'
import { auditService } from './audit.service'
import { hash, compare } from 'bcryptjs'
import { nanoid } from 'nanoid'

interface LoginInput {
  email: string
  password: string
}

interface LoginResult {
  success: boolean
  user?: {
    id: string
    email: string
    firstName: string
    lastName: string
    role: string
    organizationId: string
  }
  error?: string
  session?: {
    token: string
    expiresAt: Date
  }
}

interface RegisterInput {
  email: string
  password: string
  firstName: string
  lastName: string
  organizationId: string
  role?: string
}

interface SessionData {
  userId: string
  token: string
  ipAddress?: string
  userAgent?: string
  expiresAt: Date
}

export class AuthService {
  /**
   * Login with email and password
   */
  async login(input: LoginInput, ipAddress?: string, userAgent?: string): Promise<LoginResult> {
    try {
      // Find user by email
      const user = await prisma.user.findFirst({
        where: { email: input.email.toLowerCase() },
        include: { organization: true },
      })

      if (!user) {
        await auditService.log({
          organizationId: 'unknown',
          action: 'LOGIN_FAILURE',
          resourceType: 'authentication',
          metadata: { email: input.email, reason: 'User not found' },
          ipAddress,
          userAgent,
        })
        return { success: false, error: 'Invalid credentials' }
      }

      // Check account status
      if (!user.is_active || user.status !== 'ACTIVE') {
        await auditService.log({
          organizationId: user.organization_id,
          actorUserId: user.id,
          action: 'LOGIN_FAILURE',
          resourceType: 'authentication',
          metadata: { reason: 'Account inactive or suspended' },
          ipAddress,
          userAgent,
        })
        return { success: false, error: 'Account is inactive or suspended' }
      }

      // Verify password
      const isValidPassword = await compare(input.password, user.passwordHash)
      if (!isValidPassword) {
        await auditService.log({
          organizationId: user.organization_id,
          actorUserId: user.id,
          action: 'LOGIN_FAILURE',
          resourceType: 'authentication',
          metadata: { reason: 'Invalid password' },
          ipAddress,
          userAgent,
        })
        return { success: false, error: 'Invalid credentials' }
      }

      // Create session
      const sessionToken = this.generateSessionToken()
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

      await prisma.session.create({
        data: {
          user_id: user.id,
          token: sessionToken,
          ip_address: ipAddress,
          user_agent: userAgent,
          expires_at: expiresAt,
        },
      })

      // Update last login
      await prisma.user.update({
        where: { id: user.id },
        data: { last_login_at: new Date() },
      })

      // Log successful login
      await auditService.log({
        organizationId: user.organization_id,
        actorUserId: user.id,
        action: 'LOGIN_SUCCESS',
        resourceType: 'authentication',
        ipAddress,
        userAgent,
      })

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role,
          organizationId: user.organization_id,
        },
        session: {
          token: sessionToken,
          expiresAt,
        },
      }
    } catch (error) {
      console.error('Login error:', error)
      return { success: false, error: 'An error occurred during login' }
    }
  }

  /**
   * Logout user
   */
  async logout(sessionToken: string): Promise<boolean> {
    try {
      const session = await prisma.session.findUnique({
        where: { token: sessionToken },
        include: { user: true },
      })

      if (session) {
        await auditService.log({
          organizationId: session.user.organization_id,
          actorUserId: session.user_id,
          action: 'LOGOUT',
          resourceType: 'authentication',
        })

        await prisma.session.delete({
          where: { id: session.id },
        })
      }

      return true
    } catch (error) {
      console.error('Logout error:', error)
      return false
    }
  }

  /**
   * Revoke all sessions except current
   */
  async revokeOtherSessions(userId: string, currentToken: string): Promise<boolean> {
    try {
      await prisma.session.deleteMany({
        where: {
          user_id: userId,
          token: { not: currentToken },
        },
      })
      return true
    } catch (error) {
      console.error('Revoke sessions error:', error)
      return false
    }
  }

  /**
   * Revoke all sessions for a user
   */
  async revokeAllSessions(userId: string): Promise<boolean> {
    try {
      await prisma.session.deleteMany({
        where: { user_id: userId },
      })
      return true
    } catch (error) {
      console.error('Revoke all sessions error:', error)
      return false
    }
  }

  /**
   * Validate session and get user
   */
  async validateSession(sessionToken: string): Promise<LoginResult['user'] | null> {
    try {
      const session = await prisma.session.findUnique({
        where: { token: sessionToken },
        include: { user: true },
      })

      if (!session || session.expires_at < new Date()) {
        if (session) {
          await prisma.session.delete({ where: { id: session.id } })
        }
        return null
      }

      const user = session.user
      if (!user.is_active || user.status !== 'ACTIVE') {
        return null
      }

      return {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        organizationId: user.organization_id,
      }
    } catch (error) {
      console.error('Validate session error:', error)
      return null
    }
  }

  /**
   * Create invitation
   */
  async createInvitation(
    email: string,
    role: string,
    organizationId: string,
    createdBy: string
  ): Promise<{ success: boolean; token?: string; error?: string }> {
    try {
      // Check if user already exists
      const existingUser = await prisma.user.findFirst({
        where: { email: email.toLowerCase() },
      })

      if (existingUser) {
        return { success: false, error: 'User already exists' }
      }

      // Generate invitation token
      const token = nanoid(32)
      const tokenHash = await hash(token, 10)
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

      await prisma.userInvitation.create({
        data: {
          organization_id: organizationId,
          email: email.toLowerCase(),
          role: role as any,
          tokenHash,
          expires_at: expiresAt,
          created_by: createdBy,
        },
      })

      await auditService.log({
        organizationId,
        actorUserId: createdBy,
        action: 'INVITATION_CREATED',
        resourceType: 'invitation',
        metadata: { email, role },
      })

      return { success: true, token }
    } catch (error) {
      console.error('Create invitation error:', error)
      return { success: false, error: 'Failed to create invitation' }
    }
  }

  /**
   * Accept invitation
   */
  async acceptInvitation(
    token: string,
    password: string,
    firstName: string,
    lastName: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const tokenHash = await hash(token, 10)
      const invitation = await prisma.userInvitation.findFirst({
        where: { tokenHash },
      })

      if (!invitation || invitation.expires_at < new Date() || invitation.accepted_at) {
        return { success: false, error: 'Invalid or expired invitation' }
      }

      // Create user
      const passwordHash = await hash(password, 10)
      const user = await prisma.user.create({
        data: {
          organization_id: invitation.organization_id,
          email: invitation.email,
          passwordHash,
          first_name: firstName,
          last_name: lastName,
          role: invitation.role,
          status: 'ACTIVE',
          is_active: true,
        },
      })

      // Mark invitation as accepted
      await prisma.userInvitation.update({
        where: { id: invitation.id },
        data: { accepted_at: new Date() },
      })

      await auditService.log({
        organizationId: invitation.organization_id,
        actorUserId: user.id,
        action: 'INVITATION_ACCEPTED',
        resourceType: 'invitation',
        metadata: { email: invitation.email },
      })

      return { success: true }
    } catch (error) {
      console.error('Accept invitation error:', error)
      return { success: false, error: 'Failed to accept invitation' }
    }
  }

  /**
   * Change password
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
      })

      if (!user) {
        return { success: false, error: 'User not found' }
      }

      // Verify current password
      const isValidPassword = await compare(currentPassword, user.passwordHash)
      if (!isValidPassword) {
        return { success: false, error: 'Current password is incorrect' }
      }

      // Create user
      const newPasswordHash = await hash(newPassword, 10)

      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash: newPasswordHash },
      })

      // Revoke all sessions for security
      await this.revokeAllSessions(userId)

      await auditService.log({
        organizationId: user.organization_id,
        actorUserId: userId,
        action: 'PASSWORD_CHANGED',
        resourceType: 'user',
      })

      return { success: true }
    } catch (error) {
      console.error('Change password error:', error)
      return { success: false, error: 'Failed to change password' }
    }
  }

  /**
   * Generate session token
   */
  private generateSessionToken(): string {
    return nanoid(32)
  }

  /**
   * Get user sessions
   */
  async getUserSessions(userId: string) {
    return prisma.session.findMany({
      where: { user_id: userId, expires_at: { gte: new Date() } },
      orderBy: { created_at: 'desc' },
    })
  }
}

export const authService = new AuthService()
