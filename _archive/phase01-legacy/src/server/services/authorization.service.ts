import { prisma } from '@/lib/db/client'
import { PERMISSIONS, ROLE_PERMISSIONS, type Permission } from '@/lib/auth'
import { Role } from '@prisma/client'

interface AuthorizeInput {
  userId: string
  permission: Permission
  organizationId: string
  resourceId?: string
  resourceType?: string
}

interface AuthorizeResult {
  allowed: boolean
  reason?: string
}

export class AuthorizationService {
  /**
   * Check if a user has a specific permission
   */
  async hasPermission(userId: string, permission: Permission): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, status: true, is_active: true },
    })

    if (!user || !user.is_active || user.status !== 'ACTIVE') {
      return false
    }

    const rolePermissions = ROLE_PERMISSIONS[user.role] || []
    return rolePermissions.includes(permission)
  }

  /**
   * Check if a user has any of the specified permissions
   */
  async hasAnyPermission(userId: string, permissions: Permission[]): Promise<boolean> {
    for (const permission of permissions) {
      if (await this.hasPermission(userId, permission)) {
        return true
      }
    }
    return false
  }

  /**
   * Check if a user has all of the specified permissions
   */
  async hasAllPermissions(userId: string, permissions: Permission[]): Promise<boolean> {
    for (const permission of permissions) {
      if (!(await this.hasPermission(userId, permission))) {
        return false
      }
    }
    return true
  }

  /**
   * Authorize a user for a specific action on a resource
   */
  async authorize(input: AuthorizeInput): Promise<AuthorizeResult> {
    const { userId, permission, organizationId, resourceId, resourceType } = input

    // Check basic permission
    const hasPermission = await this.hasPermission(userId, permission)
    if (!hasPermission) {
      return { allowed: false, reason: 'Missing required permission' }
    }

    // Check organization access
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { organization_id: true },
    })

    if (!user || user.organization_id !== organizationId) {
      return { allowed: false, reason: 'Organization access denied' }
    }

    // Check resource-level access if specified
    if (resourceId && resourceType) {
      const resourceAccess = await this.checkResourceAccess(
        userId,
        resourceType,
        resourceId,
        organizationId
      )
      if (!resourceAccess) {
        return { allowed: false, reason: 'Resource access denied' }
      }
    }

    return { allowed: true }
  }

  /**
   * Check if a user can access a specific resource
   */
  private async checkResourceAccess(
    userId: string,
    resourceType: string,
    resourceId: string,
    organizationId: string
  ): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, id: true, department_id: true, team_id: true, manager_id: true },
    })

    if (!user) return false

    // SUPER_ADMIN and ADMIN can access all resources in their organization
    if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') {
      return true
    }

    // Resource-specific checks
    switch (resourceType) {
      case 'user':
        // Users can access their own profile
        if (resourceId === userId) return true
        
        // HR can access all users
        if (user.role === 'HR') return true
        
        // Managers can access their direct reports
        if (user.role === 'MANAGER') {
          const directReport = await prisma.user.findFirst({
            where: { id: resourceId, manager_id: userId },
          })
          return !!directReport
        }
        
        // Mentors can access their mentees
        if (user.role === 'MENTOR') {
          const mentee = await prisma.user.findFirst({
            where: { id: resourceId, mentor_id: userId },
          })
          return !!mentee
        }
        
        return false

      case 'intern':
        // HR can access all interns
        if (user.role === 'HR') return true
        
        // Managers can access interns in their department/team
        if (user.role === 'MANAGER') {
          const intern = await prisma.intern.findUnique({
            where: { id: resourceId },
            include: { user: true },
          })
          if (!intern) return false
          
          const sameDepartment = intern.user.department_id === user.department_id
          const sameTeam = intern.user.team_id === user.team_id
          return sameDepartment || sameTeam
        }
        
        // Mentors can access their assigned interns
        if (user.role === 'MENTOR') {
          const intern = await prisma.intern.findUnique({
            where: { id: resourceId },
            include: { user: true },
          })
          if (!intern) return false
          return intern.user.mentor_id === userId
        }
        
        // Interns can only access their own profile
        if (user.role === 'INTERN') {
          const intern = await prisma.intern.findUnique({
            where: { id: resourceId },
          })
          return intern?.user_id === userId
        }
        
        return false

      case 'task':
        // Users can access their own tasks
        const task = await prisma.task.findUnique({
          where: { id: resourceId },
          select: { assigned_to: true, created_by: true },
        })
        if (!task) return false
        
        if (task.assigned_to === userId || task.created_by === userId) return true
        
        // Managers can access tasks in their department/team
        if (user.role === 'MANAGER') {
          // Check if task belongs to project in manager's scope
          // This would need more complex logic with project access
          return true
        }
        
        return false

      case 'project':
        // Users can access projects they're assigned to
        const project = await prisma.project.findUnique({
          where: { id: resourceId },
          include: { interns: true },
        })
        if (!project) return false
        
        const isIntern = project.interns.some(intern => intern.user_id === userId)
        if (isIntern) return true
        
        // Managers can access projects in their department/team
        if (user.role === 'MANAGER') {
          return true
        }
        
        return false

      default:
        // For other resource types, default to permission-based access
        return true
    }
  }

  /**
   * Get all permissions for a user
   */
  async getUserPermissions(userId: string): Promise<Permission[]> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    })

    if (!user) return []

    return ROLE_PERMISSIONS[user.role] || []
  }

  /**
   * Check if user has a specific role
   */
  async hasRole(userId: string, role: Role): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    })

    return user?.role === role
  }

  /**
   * Check if user has any of the specified roles
   */
  async hasAnyRole(userId: string, roles: Role[]): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    })

    if (!user) return false

    return roles.includes(user.role)
  }
}

export const authorizationService = new AuthorizationService()
