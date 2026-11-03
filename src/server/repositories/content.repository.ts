import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import { CURRENT_STATUSES } from '@/lib/interns/lifecycle'

const personSelect = { id: true, first_name: true, last_name: true, display_name: true, avatar_url: true } as const
/** Interns still in the programme (completed, alumni and terminated keep their history). */
const currentInterns = { deleted_at: null, status: { in: [...CURRENT_STATUSES] } } satisfies Prisma.InternWhereInput

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

  /** Everything the structure editor shows, archived records included. */
  managementView(organizationId: string) {
    const teamSelect = {
      id: true,
      name: true,
      description: true,
      department_id: true,
      is_active: true,
      team_lead: { select: personSelect },
      _count: { select: { interns: { where: currentInterns } } },
    } as const
    const positionSelect = {
      id: true,
      title: true,
      description: true,
      department_id: true,
      is_active: true,
      _count: { select: { interns: { where: currentInterns } } },
    } as const
    return Promise.all([
      prisma.department.findMany({
        where: { organization_id: organizationId },
        orderBy: [{ is_active: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          description: true,
          is_active: true,
          head: { select: personSelect },
          teams: { orderBy: [{ is_active: 'desc' }, { name: 'asc' }], select: teamSelect },
          positions: { orderBy: [{ is_active: 'desc' }, { title: 'asc' }], select: positionSelect },
          _count: { select: { interns: { where: currentInterns } } },
        },
      }),
      prisma.team.findMany({
        where: { organization_id: organizationId, department_id: null },
        orderBy: [{ is_active: 'desc' }, { name: 'asc' }],
        select: teamSelect,
      }),
      prisma.position.findMany({
        where: { organization_id: organizationId, department_id: null },
        orderBy: [{ is_active: 'desc' }, { title: 'asc' }],
        select: positionSelect,
      }),
    ])
  },

  /** People who can head a department or lead a team: active members of the organization. */
  activeMembers(organizationId: string) {
    return prisma.user.findMany({
      where: { organization_id: organizationId, status: 'ACTIVE', deleted_at: null },
      orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
      select: personSelect,
    })
  },

  isActiveMember(organizationId: string, userId: string) {
    return prisma.user
      .count({ where: { id: userId, organization_id: organizationId, status: 'ACTIVE', deleted_at: null } })
      .then((count) => count > 0)
  },

  findDepartment(organizationId: string, id: string) {
    return prisma.department.findFirst({
      where: { id, organization_id: organizationId },
      select: { id: true, name: true, description: true, head_user_id: true, is_active: true },
    })
  },

  findTeam(organizationId: string, id: string) {
    return prisma.team.findFirst({
      where: { id, organization_id: organizationId },
      select: { id: true, name: true, description: true, department_id: true, team_lead_id: true, is_active: true },
    })
  },

  findPosition(organizationId: string, id: string) {
    return prisma.position.findFirst({
      where: { id, organization_id: organizationId },
      select: { id: true, title: true, description: true, department_id: true, is_active: true },
    })
  },

  /** Another record of this kind already using the name (case-insensitive, archived included). */
  async nameTaken(kind: 'department' | 'team' | 'position', organizationId: string, name: string, excludeId?: string) {
    const base = { organization_id: organizationId, ...(excludeId ? { id: { not: excludeId } } : {}) }
    const match = { equals: name, mode: 'insensitive' as const }
    const select = { is_active: true }
    const row =
      kind === 'department'
        ? await prisma.department.findFirst({ where: { ...base, name: match }, select })
        : kind === 'team'
          ? await prisma.team.findFirst({ where: { ...base, name: match }, select })
          : await prisma.position.findFirst({ where: { ...base, title: match }, select })
    return row ? { archived: !row.is_active } : null
  },

  /** Slugs already used by this kind (slugs are unique per organization and never change). */
  async slugsLike(kind: 'department' | 'team' | 'position', organizationId: string, prefix: string) {
    const where = { organization_id: organizationId, slug: { startsWith: prefix } }
    const rows =
      kind === 'department'
        ? await prisma.department.findMany({ where, select: { slug: true } })
        : kind === 'team'
          ? await prisma.team.findMany({ where, select: { slug: true } })
          : await prisma.position.findMany({ where, select: { slug: true } })
    return new Set(rows.map((row) => row.slug))
  },

  /** What still depends on a department, team or position (blocks archiving). */
  async dependents(kind: 'department' | 'team' | 'position', id: string) {
    const where =
      kind === 'department' ? { department_id: id } : kind === 'team' ? { team_id: id } : { position_id: id }
    const [interns, teams] = await Promise.all([
      prisma.intern.count({ where: { ...where, ...currentInterns } }),
      kind === 'department' ? prisma.team.count({ where: { department_id: id, is_active: true } }) : Promise.resolve(0),
    ])
    return { interns, teams }
  },

  createDepartment(data: Prisma.DepartmentUncheckedCreateInput) {
    return prisma.department.create({ data, select: { id: true } })
  },
  updateDepartment(id: string, data: Prisma.DepartmentUncheckedUpdateInput) {
    return prisma.department.update({ where: { id }, data, select: { id: true } })
  },
  createTeam(data: Prisma.TeamUncheckedCreateInput) {
    return prisma.team.create({ data, select: { id: true } })
  },
  updateTeam(id: string, data: Prisma.TeamUncheckedUpdateInput) {
    return prisma.team.update({ where: { id }, data, select: { id: true } })
  },
  createPosition(data: Prisma.PositionUncheckedCreateInput) {
    return prisma.position.create({ data, select: { id: true } })
  },
  updatePosition(id: string, data: Prisma.PositionUncheckedUpdateInput) {
    return prisma.position.update({ where: { id }, data, select: { id: true } })
  },
}
