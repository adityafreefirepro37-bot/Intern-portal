import 'server-only'
import { prisma } from '@/lib/db/client'

/** Courses and announcement search (read paths). */
export const courseRepository = {
  list(organizationId: string) {
    return prisma.course.findMany({
      where: { organization_id: organizationId, status: { not: 'ARCHIVED' } },
      orderBy: [{ status: 'desc' }, { title: 'asc' }],
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        status: true,
        lessons: { select: { estimated_minutes: true } },
      },
    })
  },

  search(organizationId: string, term: string, take: number) {
    return prisma.course.findMany({
      where: {
        organization_id: organizationId,
        status: 'PUBLISHED',
        title: { contains: term, mode: 'insensitive' },
      },
      take,
      select: { id: true, title: true, slug: true },
    })
  },
}

export const announcementRepository = {
  search(organizationId: string, term: string, now: Date, take: number) {
    return prisma.announcement.findMany({
      where: {
        organization_id: organizationId,
        published_at: { not: null, lte: now },
        status: { in: ['PUBLISHED', 'SCHEDULED'] },
        // Search only surfaces organization-wide announcements; targeted ones
        // are reachable through the viewer's own feed.
        audience: 'EVERYONE',
        OR: [{ expires_at: null }, { expires_at: { gt: now } }],
        title: { contains: term, mode: 'insensitive' },
      },
      take,
      select: { id: true, title: true },
    })
  },
}

export const organizationStructureRepository = {
  listDepartments(organizationId: string) {
    return prisma.department.findMany({
      where: { organization_id: organizationId, is_active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    })
  },

  departmentsWithTeams(organizationId: string) {
    return prisma.department.findMany({
      where: { organization_id: organizationId, is_active: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        head: { select: { first_name: true, last_name: true, display_name: true, avatar_url: true } },
        teams: {
          where: { is_active: true },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            description: true,
            team_lead: { select: { first_name: true, last_name: true, display_name: true, avatar_url: true } },
            _count: { select: { interns: { where: { deleted_at: null } } } },
          },
        },
        positions: { where: { is_active: true }, orderBy: { title: 'asc' }, select: { id: true, title: true } },
        _count: { select: { interns: { where: { deleted_at: null } } } },
      },
    })
  },
}
