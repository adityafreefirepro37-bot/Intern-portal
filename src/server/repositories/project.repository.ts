import 'server-only'
import type { Prisma, ProjectStatus, TaskStatus } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import { CLOSED_TASK_STATUSES, PENDING_REVIEW_STATUSES } from './task.repository'

const personSelect = { id: true, first_name: true, last_name: true, display_name: true, avatar_url: true } as const

export const PROJECT_SORTS = ['name', 'status', 'due', 'start', 'progress', 'updated'] as const
export type ProjectSort = (typeof PROJECT_SORTS)[number]

export interface ProjectFilter {
  q?: string
  statuses?: ProjectStatus[]
  managerId?: string
  memberId?: string
  startFrom?: Date
  startTo?: Date
  dueFrom?: Date
  dueTo?: Date
}

function filterWhere(filter: ProjectFilter): Prisma.ProjectWhereInput[] {
  const where: Prisma.ProjectWhereInput[] = []
  const q = filter.q?.trim()
  if (q) {
    where.push({
      OR: [{ name: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }],
    })
  }
  if (filter.statuses?.length) where.push({ status: { in: filter.statuses } })
  if (filter.managerId) where.push({ OR: [{ manager_id: filter.managerId }, { owner_id: filter.managerId }] })
  if (filter.memberId) where.push({ members: { some: { user_id: filter.memberId } } })
  const range = (from?: Date, to?: Date) =>
    from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined
  const start = range(filter.startFrom, filter.startTo)
  const due = range(filter.dueFrom, filter.dueTo)
  if (start) where.push({ start_date: start })
  if (due) where.push({ target_end_date: due })
  return where
}

function orderBy(sort: ProjectSort, dir: 'asc' | 'desc'): Prisma.ProjectOrderByWithRelationInput[] {
  switch (sort) {
    case 'name':
      return [{ name: dir }, { id: 'asc' }]
    case 'status':
      return [{ status: dir }, { target_end_date: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }]
    case 'due':
      return [{ target_end_date: { sort: dir, nulls: 'last' } }, { id: 'asc' }]
    case 'start':
      return [{ start_date: { sort: dir, nulls: 'last' } }, { id: 'asc' }]
    case 'progress':
      return [{ progress_percentage: dir }, { id: 'asc' }]
    case 'updated':
      return [{ updated_at: dir }, { id: 'asc' }]
  }
}

const projectRowSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  status: true,
  priority: true,
  start_date: true,
  target_end_date: true,
  progress_percentage: true,
  owner: { select: personSelect },
  manager: { select: personSelect },
  members: { take: 5, orderBy: { created_at: 'asc' }, select: { user: { select: personSelect } } },
  _count: { select: { members: true } },
} satisfies Prisma.ProjectSelect

export const projectRepository = {
  /** `scope` comes from src/server/repositories/scope.ts (it pins the organization). */
  findPage(
    scope: Prisma.ProjectWhereInput,
    options: { filter: ProjectFilter; sort: ProjectSort; dir: 'asc' | 'desc'; skip: number; take: number },
  ) {
    const where: Prisma.ProjectWhereInput = { AND: [scope, { deleted_at: null }, ...filterWhere(options.filter)] }
    return prisma.$transaction([
      prisma.project.findMany({
        where,
        orderBy: orderBy(options.sort, options.dir),
        skip: options.skip,
        take: options.take,
        select: projectRowSelect,
      }),
      prisma.project.count({ where }),
    ])
  },

  /** Backwards-compatible list used by the dashboard. */
  listPage(scope: Prisma.ProjectWhereInput, options: { skip: number; take: number; statuses?: ProjectStatus[] }) {
    return this.findPage(scope, {
      filter: { statuses: options.statuses },
      sort: 'status',
      dir: 'asc',
      skip: options.skip,
      take: options.take,
    })
  },

  async countByStatus(scope: Prisma.ProjectWhereInput) {
    const rows = await prisma.project.groupBy({
      by: ['status'],
      where: { AND: [scope, { deleted_at: null }] },
      _count: { _all: true },
    })
    return Object.fromEntries(rows.map((row) => [row.status, row._count._all])) as Partial<
      Record<ProjectStatus, number>
    >
  },

  /** Task totals per project (top-level, non-cancelled), for list rows. */
  async taskProgress(organizationId: string, projectIds: string[]) {
    if (projectIds.length === 0) return new Map<string, { total: number; completed: number }>()
    const rows = await prisma.task.groupBy({
      by: ['project_id', 'status'],
      where: {
        organization_id: organizationId,
        project_id: { in: projectIds },
        parent_task_id: null,
        deleted_at: null,
        status: { not: 'CANCELLED' },
      },
      _count: { _all: true },
    })
    const progress = new Map<string, { total: number; completed: number }>()
    for (const row of rows) {
      if (!row.project_id) continue
      const entry = progress.get(row.project_id) ?? { total: 0, completed: 0 }
      entry.total += row._count._all
      if (row.status === 'COMPLETED') entry.completed += row._count._all
      progress.set(row.project_id, entry)
    }
    return progress
  },

  findDetail(id: string) {
    return prisma.project.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        status: true,
        priority: true,
        start_date: true,
        target_end_date: true,
        completed_at: true,
        progress_percentage: true,
        created_at: true,
        updated_at: true,
        owner: { select: personSelect },
        manager: { select: personSelect },
        creator: { select: personSelect },
        members: {
          orderBy: [{ role: 'asc' }, { created_at: 'asc' }],
          select: {
            role: true,
            created_at: true,
            user: { select: { ...personSelect, email: true, status: true, intern: { select: { id: true } } } },
          },
        },
      },
    })
  },

  listMilestones(projectId: string) {
    return prisma.milestone.findMany({
      where: { project_id: projectId },
      orderBy: [{ position: 'asc' }, { due_date: { sort: 'asc', nulls: 'last' } }, { created_at: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        start_date: true,
        due_date: true,
        completed_at: true,
        position: true,
        tasks: { where: { deleted_at: null }, select: { status: true, parent_task_id: true } },
      },
    })
  },

  /** Task KPIs for one project in a single grouped query plus two counts. */
  async taskStats(projectId: string, today: Date) {
    const base = { project_id: projectId, deleted_at: null }
    const [byStatus, overdue, pendingReview] = await Promise.all([
      prisma.task.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      prisma.task.count({ where: { ...base, due_date: { lt: today }, status: { notIn: CLOSED_TASK_STATUSES } } }),
      prisma.task.count({
        where: { ...base, status: 'IN_REVIEW', submissions: { some: { status: { in: PENDING_REVIEW_STATUSES } } } },
      }),
    ])
    const count = (status: TaskStatus) => byStatus.find((row) => row.status === status)?._count._all ?? 0
    return {
      total: byStatus.reduce((sum, row) => sum + (row.status === 'CANCELLED' ? 0 : row._count._all), 0),
      completed: count('COMPLETED'),
      inProgress: count('IN_PROGRESS'),
      blocked: count('BLOCKED'),
      inReview: count('IN_REVIEW'),
      overdue,
      pendingReview,
    }
  },

  listFiles(projectId: string) {
    return prisma.projectAttachment.findMany({
      where: { project_id: projectId, deleted_at: null },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        file_name: true,
        mime_type: true,
        file_size: true,
        description: true,
        created_at: true,
        uploaded_by: true,
        uploader: { select: personSelect },
      },
    })
  },

  findFileWithStorage(organizationId: string, id: string) {
    return prisma.projectAttachment.findFirst({
      where: { id, organization_id: organizationId, deleted_at: null },
      select: { id: true, project_id: true, file_name: true, mime_type: true, storage_path: true, uploaded_by: true },
    })
  },

  /**
   * Project timeline: audit entries tagged with this project (metadata.projectId),
   * newest first. Uses the audit_logs_project_activity_idx expression index.
   */
  async activity(organizationId: string, projectId: string, take = 50) {
    const rows = await prisma.$queryRaw<
      {
        id: string
        action: string
        resource_type: string
        resource_id: string | null
        metadata: Record<string, unknown> | null
        created_at: Date
        actor_first: string | null
        actor_last: string | null
        actor_display: string | null
        actor_avatar: string | null
      }[]
    >`
      SELECT a.id, a.action, a.resource_type, a.resource_id, a.metadata, a.created_at,
             u.first_name AS actor_first, u.last_name AS actor_last, u.display_name AS actor_display, u.avatar_url AS actor_avatar
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.organization_id = ${organizationId}::uuid
        AND (a.metadata->>'projectId') = ${projectId}
        AND a.status = 'SUCCESS'
      ORDER BY a.created_at DESC
      LIMIT ${take}`
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      actor: row.actor_first
        ? {
            first_name: row.actor_first,
            last_name: row.actor_last ?? '',
            display_name: row.actor_display,
            avatar_url: row.actor_avatar,
          }
        : null,
    }))
  },

  search(scope: Prisma.ProjectWhereInput, term: string, take: number) {
    return prisma.project.findMany({
      where: {
        AND: [scope, { deleted_at: null }],
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { description: { contains: term, mode: 'insensitive' } },
        ],
      },
      take,
      select: { id: true, name: true, slug: true, status: true },
    })
  },

  searchMilestones(scope: Prisma.ProjectWhereInput, term: string, take: number) {
    return prisma.milestone.findMany({
      where: { name: { contains: term, mode: 'insensitive' }, project: { AND: [scope, { deleted_at: null }] } },
      take,
      select: { id: true, name: true, status: true, project: { select: { id: true, name: true } } },
    })
  },
}

export type ProjectActivityEntry = Awaited<ReturnType<typeof projectRepository.activity>>[number]
