import 'server-only'
import type { Prisma, ProjectStatus } from '@prisma/client'
import { prisma } from '@/lib/db/client'

const personSelect = { id: true, first_name: true, last_name: true, display_name: true, avatar_url: true } as const

export const projectRepository = {
  /** `scope` comes from src/server/repositories/scope.ts (it pins the organization). */
  listPage(scope: Prisma.ProjectWhereInput, options: { skip: number; take: number; statuses?: ProjectStatus[] }) {
    const where: Prisma.ProjectWhereInput = {
      AND: [scope, { deleted_at: null }, ...(options.statuses ? [{ status: { in: options.statuses } }] : [])],
    }
    return prisma.$transaction([
      prisma.project.findMany({
        where,
        orderBy: [{ status: 'asc' }, { target_end_date: 'asc' }],
        skip: options.skip,
        take: options.take,
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          status: true,
          start_date: true,
          target_end_date: true,
          owner: { select: personSelect },
          members: { take: 5, select: { user: { select: personSelect } } },
          _count: { select: { members: true } },
        },
      }),
      prisma.project.count({ where }),
    ])
  },

  /** Task totals per project (open vs completed), ignoring cancelled/deleted tasks. */
  async taskProgress(organizationId: string, projectIds: string[]) {
    if (projectIds.length === 0) return new Map<string, { total: number; completed: number }>()
    const rows = await prisma.task.groupBy({
      by: ['project_id', 'status'],
      where: {
        organization_id: organizationId,
        project_id: { in: projectIds },
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
}
