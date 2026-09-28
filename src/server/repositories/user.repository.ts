import 'server-only'
import type { Prisma, UserStatus } from '@prisma/client'
import { prisma } from '@/lib/db/client'

export interface UserFilter {
  search?: string
  status?: UserStatus
  roleId?: string
  departmentId?: string
}

const roleSelect = { role: { select: { id: true, name: true, slug: true, rank: true } } } as const

export const userRepository = {
  listPage(organizationId: string, filter: UserFilter, skip: number, take: number) {
    const search = filter.search?.trim()
    const where: Prisma.UserWhereInput = {
      organization_id: organizationId,
      deleted_at: null,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.roleId ? { user_roles: { some: { role_id: filter.roleId } } } : {}),
      ...(filter.departmentId
        ? {
            OR: [
              { intern: { is: { department_id: filter.departmentId } } },
              { departments_led: { some: { id: filter.departmentId } } },
            ],
          }
        : {}),
      ...(search
        ? {
            AND: [
              {
                OR: [
                  { email: { contains: search, mode: 'insensitive' } },
                  { first_name: { contains: search, mode: 'insensitive' } },
                  { last_name: { contains: search, mode: 'insensitive' } },
                  { display_name: { contains: search, mode: 'insensitive' } },
                ],
              },
            ],
          }
        : {}),
    }
    return prisma.$transaction([
      prisma.user.findMany({
        where,
        orderBy: [{ status: 'asc' }, { first_name: 'asc' }],
        skip,
        take,
        select: {
          id: true,
          email: true,
          first_name: true,
          last_name: true,
          display_name: true,
          avatar_url: true,
          phone: true,
          status: true,
          last_login_at: true,
          email_verified_at: true,
          user_roles: { select: roleSelect },
          intern: { select: { department: { select: { name: true } }, team: { select: { name: true } } } },
        },
      }),
      prisma.user.count({ where }),
    ])
  },

  /** A user in the organization with the data needed for admin decisions. */
  findForAdmin(organizationId: string, id: string) {
    return prisma.user.findFirst({
      where: { id, organization_id: organizationId, deleted_at: null },
      select: {
        id: true,
        organization_id: true,
        auth_user_id: true,
        email: true,
        first_name: true,
        last_name: true,
        status: true,
        user_roles: {
          select: {
            role: {
              select: {
                id: true,
                name: true,
                slug: true,
                rank: true,
                role_permissions: { select: { permission: { select: { resource: true, action: true } } } },
              },
            },
          },
        },
      },
    })
  },

  findByEmail(organizationId: string, email: string) {
    return prisma.user.findUnique({
      where: { organization_id_email: { organization_id: organizationId, email: email.toLowerCase() } },
      select: { id: true, status: true, deleted_at: true, auth_user_id: true },
    })
  },

  /** Active users holding any role that grants `resource.action` (e.g. the owner-level permission). */
  countActiveHoldersOf(organizationId: string, resource: string, action: string, excludeUserId?: string) {
    return prisma.user.count({
      where: {
        organization_id: organizationId,
        status: 'ACTIVE',
        deleted_at: null,
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
        user_roles: { some: { role: { role_permissions: { some: { permission: { resource, action } } } } } },
      },
    })
  },

  setStatus(id: string, status: UserStatus) {
    return prisma.user.update({ where: { id }, data: { status }, select: { id: true, status: true } })
  },

  /** Replaces the user's roles atomically. */
  replaceRoles(userId: string, roleIds: string[], grantedBy: string) {
    return prisma.$transaction([
      prisma.userRole.deleteMany({ where: { user_id: userId, role_id: { notIn: roleIds } } }),
      prisma.userRole.createMany({
        data: roleIds.map((role_id) => ({ user_id: userId, role_id, granted_by: grantedBy })),
        skipDuplicates: true,
      }),
    ])
  },

  getProfile(id: string) {
    return prisma.user.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        display_name: true,
        avatar_url: true,
        phone: true,
        timezone: true,
        status: true,
        email_verified_at: true,
        last_login_at: true,
        created_at: true,
        organization: { select: { name: true } },
        user_roles: { select: roleSelect },
        departments_led: { select: { name: true } },
        teams_led: { select: { name: true } },
        intern: {
          select: {
            employee_code: true,
            status: true,
            department: { select: { name: true } },
            team: { select: { name: true } },
            position: { select: { title: true } },
            manager: { select: { first_name: true, last_name: true, display_name: true } },
            mentor: { select: { first_name: true, last_name: true, display_name: true } },
          },
        },
      },
    })
  },

  updateProfile(id: string, data: Prisma.UserUpdateInput) {
    return prisma.user.update({ where: { id }, data, select: { id: true } })
  },
}

export const roleRepository = {
  findInOrg(organizationId: string, id: string) {
    return prisma.role.findFirst({
      where: { id, organization_id: organizationId },
      select: { id: true, name: true, slug: true, rank: true, is_system_role: true },
    })
  },

  listWithDetails(organizationId: string) {
    return prisma.role.findMany({
      where: { organization_id: organizationId },
      orderBy: { rank: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        rank: true,
        is_system_role: true,
        _count: { select: { user_roles: { where: { user: { deleted_at: null } } } } },
        role_permissions: {
          select: { scope: true, permission: { select: { resource: true, action: true, description: true } } },
        },
      },
    })
  },

  listBasic(organizationId: string) {
    return prisma.role.findMany({
      where: { organization_id: organizationId },
      orderBy: { rank: 'desc' },
      select: { id: true, name: true, slug: true, rank: true },
    })
  },
}
