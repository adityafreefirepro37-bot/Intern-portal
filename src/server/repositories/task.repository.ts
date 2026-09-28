import 'server-only'
import type { Prisma, SubmissionStatus, TaskStatus } from '@prisma/client'
import { prisma } from '@/lib/db/client'

export const CLOSED_TASK_STATUSES: TaskStatus[] = ['COMPLETED', 'CANCELLED']
export const PENDING_REVIEW_STATUSES: SubmissionStatus[] = ['SUBMITTED', 'UNDER_REVIEW']

const personSelect = { id: true, first_name: true, last_name: true, display_name: true, avatar_url: true } as const

const taskListSelect = {
  id: true,
  title: true,
  status: true,
  priority: true,
  due_date: true,
  project: { select: { id: true, name: true } },
  assignees: { select: { user: { select: personSelect } } },
} as const

/** `scope` comes from src/server/repositories/scope.ts (it pins the organization). */
function live(scope: Prisma.TaskWhereInput, ...extra: Prisma.TaskWhereInput[]): Prisma.TaskWhereInput {
  return { AND: [scope, { deleted_at: null }, ...extra] }
}

const open: Prisma.TaskWhereInput = { status: { notIn: CLOSED_TASK_STATUSES } }

export const taskRepository = {
  countOpen(scope: Prisma.TaskWhereInput) {
    return prisma.task.count({ where: live(scope, open) })
  },

  countDueBetween(scope: Prisma.TaskWhereInput, from: Date, to: Date) {
    return prisma.task.count({ where: live(scope, open, { due_date: { gte: from, lte: to } }) })
  },

  listDueBefore(scope: Prisma.TaskWhereInput, before: Date, take: number) {
    return prisma.task.findMany({
      where: live(scope, open, { due_date: { not: null, lte: before } }),
      orderBy: [{ due_date: 'asc' }, { priority: 'desc' }],
      take,
      select: taskListSelect,
    })
  },

  async countByStatus(scope: Prisma.TaskWhereInput) {
    const rows = await prisma.task.groupBy({ by: ['status'], where: live(scope), _count: { _all: true } })
    return rows.map((row) => ({ status: row.status, count: row._count._all }))
  },

  countPendingSubmissions(scope: Prisma.TaskWhereInput) {
    return prisma.taskSubmission.count({
      where: { status: { in: PENDING_REVIEW_STATUSES }, task: live(scope) },
    })
  },

  listPage(scope: Prisma.TaskWhereInput, options: { skip: number; take: number; status?: TaskStatus }) {
    const where = live(scope, ...(options.status ? [{ status: options.status }] : []))
    return prisma.$transaction([
      prisma.task.findMany({
        where,
        orderBy: [{ due_date: { sort: 'asc', nulls: 'last' } }, { created_at: 'desc' }],
        skip: options.skip,
        take: options.take,
        select: taskListSelect,
      }),
      prisma.task.count({ where }),
    ])
  },

  search(scope: Prisma.TaskWhereInput, term: string, take: number) {
    return prisma.task.findMany({
      where: live(scope, { title: { contains: term, mode: 'insensitive' } }),
      take,
      select: { id: true, title: true, status: true, project: { select: { name: true } } },
    })
  },
}
