import 'server-only'
import type { InternStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'

const personSelect = { id: true, first_name: true, last_name: true, display_name: true, avatar_url: true } as const

export interface InternDirectoryFilter {
  q?: string
  status?: InternStatus
  departmentId?: string
  teamId?: string
  positionId?: string
  managerId?: string
  mentorId?: string
  joinedFrom?: Date
  joinedTo?: Date
  endFrom?: Date
  endTo?: Date
}

export const INTERN_SORTS = ['name', 'joining', 'end', 'status', 'department', 'created'] as const
export type InternSort = (typeof INTERN_SORTS)[number]

function filterWhere(filter: InternDirectoryFilter): Prisma.InternWhereInput[] {
  const q = filter.q?.trim()
  const range = (from?: Date, to?: Date) =>
    from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined
  const joining = range(filter.joinedFrom, filter.joinedTo)
  const ending = range(filter.endFrom, filter.endTo)
  return [
    ...(filter.status ? [{ status: filter.status }] : []),
    ...(filter.departmentId ? [{ department_id: filter.departmentId }] : []),
    ...(filter.teamId ? [{ team_id: filter.teamId }] : []),
    ...(filter.positionId ? [{ position_id: filter.positionId }] : []),
    ...(filter.managerId ? [{ manager_id: filter.managerId }] : []),
    ...(filter.mentorId ? [{ mentor_id: filter.mentorId }] : []),
    ...(joining ? [{ joining_date: joining }] : []),
    ...(ending ? [{ expected_end_date: ending }] : []),
    ...(q
      ? [
          {
            OR: [
              { employee_code: { contains: q, mode: 'insensitive' as const } },
              { user: { first_name: { contains: q, mode: 'insensitive' as const } } },
              { user: { last_name: { contains: q, mode: 'insensitive' as const } } },
              { user: { display_name: { contains: q, mode: 'insensitive' as const } } },
              { user: { email: { contains: q, mode: 'insensitive' as const } } },
              { position: { title: { contains: q, mode: 'insensitive' as const } } },
              { department: { name: { contains: q, mode: 'insensitive' as const } } },
              { team: { name: { contains: q, mode: 'insensitive' as const } } },
            ],
          },
        ]
      : []),
  ]
}

function orderBy(sort: InternSort, dir: 'asc' | 'desc'): Prisma.InternOrderByWithRelationInput[] {
  const nulls = { sort: dir, nulls: 'last' as const }
  switch (sort) {
    case 'name':
      return [{ user: { first_name: dir } }, { user: { last_name: dir } }, { id: 'asc' }]
    case 'joining':
      return [{ joining_date: nulls }, { id: 'asc' }]
    case 'end':
      return [{ expected_end_date: nulls }, { id: 'asc' }]
    case 'status':
      return [{ status: dir }, { id: 'asc' }]
    case 'department':
      return [{ department: { name: dir } }, { id: 'asc' }]
    case 'created':
      return [{ created_at: dir }, { id: 'asc' }]
  }
}

/** Columns for directory rows — selective, no personal data. */
const directorySelect = {
  id: true,
  employee_code: true,
  status: true,
  joining_date: true,
  expected_end_date: true,
  created_at: true,
  user: { select: { ...personSelect, email: true } },
  position: { select: { id: true, title: true } },
  department: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
  manager: { select: personSelect },
  mentor: { select: personSelect },
} as const

/**
 * Every method takes a `scope` filter from src/server/repositories/scope.ts
 * (it already pins the organization), so callers cannot forget tenant or
 * record-level restrictions.
 */
export const internRepository = {
  count(scope: Prisma.InternWhereInput, statuses?: InternStatus[]) {
    return prisma.intern.count({
      where: { AND: [scope, { deleted_at: null }, ...(statuses ? [{ status: { in: statuses } }] : [])] },
    })
  },

  async countByStatus(scope: Prisma.InternWhereInput) {
    const rows = await prisma.intern.groupBy({
      by: ['status'],
      where: { AND: [scope, { deleted_at: null }] },
      _count: { _all: true },
    })
    return Object.fromEntries(rows.map((row) => [row.status, row._count._all])) as Partial<Record<InternStatus, number>>
  },

  directoryPage(
    scope: Prisma.InternWhereInput,
    options: { filter: InternDirectoryFilter; sort: InternSort; dir: 'asc' | 'desc'; skip: number; take: number },
  ) {
    const where: Prisma.InternWhereInput = { AND: [scope, { deleted_at: null }, ...filterWhere(options.filter)] }
    return prisma.$transaction([
      prisma.intern.findMany({
        where,
        orderBy: orderBy(options.sort, options.dir),
        skip: options.skip,
        take: options.take,
        select: directorySelect,
      }),
      prisma.intern.count({ where }),
    ])
  },

  /** Backwards-compatible simple list used by existing callers. */
  listPage(scope: Prisma.InternWhereInput, options: { skip: number; take: number; status?: InternStatus }) {
    return this.directoryPage(scope, {
      filter: { status: options.status },
      sort: 'status',
      dir: 'asc',
      skip: options.skip,
      take: options.take,
    })
  },

  /** One intern within scope, or null (out-of-scope is indistinguishable from missing). */
  findInScope(scope: Prisma.InternWhereInput, id: string) {
    return prisma.intern.findFirst({
      where: { AND: [scope, { id, deleted_at: null }] },
      select: {
        id: true,
        organization_id: true,
        user_id: true,
        employee_code: true,
        status: true,
        joining_date: true,
        expected_end_date: true,
        actual_end_date: true,
        manager_id: true,
        mentor_id: true,
        team_id: true,
        department_id: true,
        position_id: true,
        created_at: true,
        user: { select: { ...personSelect, email: true, phone: true, status: true } },
        department: { select: { id: true, name: true } },
        team: { select: { id: true, name: true } },
        position: { select: { id: true, title: true } },
        mentor: { select: { ...personSelect, email: true } },
        manager: { select: { ...personSelect, email: true } },
        profile: {
          select: {
            date_of_birth: true,
            gender: true,
            address_line_1: true,
            address_line_2: true,
            city: true,
            state: true,
            postal_code: true,
            country: true,
            education_level: true,
            institution: true,
            field_of_study: true,
            graduation_year: true,
            bio: true,
          },
        },
        emergency_contacts: {
          orderBy: { created_at: 'asc' },
          select: { id: true, name: true, relationship: true, phone: true, email: true },
        },
        internships: {
          orderBy: { start_date: 'desc' },
          take: 1,
          select: {
            id: true,
            title: true,
            status: true,
            start_date: true,
            expected_end_date: true,
            actual_end_date: true,
            work_mode: true,
            location: true,
            description: true,
            onboarding: { select: { id: true, started_at: true, completed_at: true, template_name: true } },
          },
        },
      },
    })
  },

  /** Minimal lookup of the intern record belonging to a user. */
  findByUserId(organizationId: string, userId: string) {
    return prisma.intern.findFirst({
      where: { organization_id: organizationId, user_id: userId, deleted_at: null },
      select: { id: true, status: true },
    })
  },

  search(scope: Prisma.InternWhereInput, term: string, take: number) {
    return prisma.intern.findMany({
      where: { AND: [scope, { deleted_at: null }, ...filterWhere({ q: term })] },
      take,
      select: { id: true, employee_code: true, user: { select: personSelect }, position: { select: { title: true } } },
    })
  },

  /** Interns related to the viewer (for My Interns / My Mentees). */
  listRelated(organizationId: string, relation: { managerId?: string; mentorId?: string }) {
    return prisma.intern.findMany({
      where: {
        organization_id: organizationId,
        deleted_at: null,
        ...(relation.managerId ? { manager_id: relation.managerId } : {}),
        ...(relation.mentorId ? { mentor_id: relation.mentorId } : {}),
      },
      orderBy: [{ status: 'asc' }, { expected_end_date: { sort: 'asc', nulls: 'last' } }],
      take: 200,
      select: {
        ...directorySelect,
        internships: {
          orderBy: { start_date: 'desc' },
          take: 1,
          select: {
            id: true,
            start_date: true,
            expected_end_date: true,
            actual_end_date: true,
            onboarding: { select: { id: true, completed_at: true } },
            onboarding_items: { select: { required: true, status: true, due_date: true } },
          },
        },
      },
    })
  },

  countFiltered(scope: Prisma.InternWhereInput, filter: InternDirectoryFilter) {
    return prisma.intern.count({ where: { AND: [scope, { deleted_at: null }, ...filterWhere(filter)] } })
  },

  /** Open (not completed/cancelled) tasks per assignee, limited to tasks within `taskScope`. */
  async openTaskCounts(taskScope: Prisma.TaskWhereInput, userIds: string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map()
    const rows = await prisma.taskAssignee.groupBy({
      by: ['user_id'],
      where: {
        user_id: { in: userIds },
        task: { AND: [taskScope, { deleted_at: null, status: { notIn: ['COMPLETED', 'CANCELLED'] } }] },
      },
      _count: { _all: true },
    })
    return new Map(rows.map((row) => [row.user_id, row._count._all]))
  },

  /** Current interns missing a manager or a mentor. */
  countUnassigned(scope: Prisma.InternWhereInput, statuses: InternStatus[]) {
    return prisma.intern.count({
      where: {
        AND: [
          scope,
          { deleted_at: null, status: { in: statuses } },
          { OR: [{ manager_id: null }, { mentor_id: null }] },
        ],
      },
    })
  },

  countRelated(organizationId: string, userId: string) {
    return prisma.$transaction([
      prisma.intern.count({ where: { organization_id: organizationId, deleted_at: null, manager_id: userId } }),
      prisma.intern.count({ where: { organization_id: organizationId, deleted_at: null, mentor_id: userId } }),
    ])
  },
}

export type InternDirectoryRow = Awaited<ReturnType<typeof internRepository.directoryPage>>[0][number]
export type InternRecord = NonNullable<Awaited<ReturnType<typeof internRepository.findInScope>>>
