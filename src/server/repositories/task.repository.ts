import 'server-only'
import type { Prisma, SubmissionStatus, TaskPriority, TaskStatus } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import { addDays } from '@/lib/interns/dates'

export const CLOSED_TASK_STATUSES: TaskStatus[] = ['COMPLETED', 'CANCELLED']
export const PENDING_REVIEW_STATUSES: SubmissionStatus[] = ['SUBMITTED', 'RESUBMITTED', 'UNDER_REVIEW']

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

/** Row shape for lists, boards and My Work (selective columns, counts instead of rows). */
export const taskRowSelect = {
  id: true,
  title: true,
  status: true,
  priority: true,
  start_date: true,
  due_date: true,
  completed_at: true,
  updated_at: true,
  created_at: true,
  position: true,
  parent_task_id: true,
  estimated_minutes: true,
  created_by: true,
  project: { select: { id: true, name: true } },
  milestone: { select: { id: true, name: true } },
  assignees: { select: { user: { select: personSelect } } },
  checklist: { select: { is_completed: true } },
  subtasks: { where: { deleted_at: null }, select: { status: true } },
  submissions: { orderBy: { created_at: 'desc' }, take: 1, select: { status: true } },
  _count: {
    select: {
      comments: { where: { deleted_at: null } },
      attachments: { where: { deleted_at: null } },
    },
  },
} satisfies Prisma.TaskSelect

export type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskRowSelect }>

export const TASK_SORTS = ['due', 'priority', 'updated', 'created', 'title', 'status'] as const
export type TaskSort = (typeof TASK_SORTS)[number]

export interface TaskFilter {
  q?: string
  statuses?: TaskStatus[]
  priorities?: TaskPriority[]
  assigneeId?: string
  /** Tasks with no assignee. */
  unassigned?: boolean
  projectId?: string
  milestoneId?: string
  createdBy?: string
  submission?: 'PENDING' | 'CHANGES_REQUESTED' | 'APPROVED' | 'NONE'
  due?: 'overdue' | 'today' | 'week' | 'none'
  dueFrom?: Date
  dueTo?: Date
  includeClosed?: boolean
  topLevelOnly?: boolean
}

/** `today` is the organization's calendar date (UTC midnight). */
export function taskFilterWhere(filter: TaskFilter, today: Date): Prisma.TaskWhereInput[] {
  const where: Prisma.TaskWhereInput[] = []
  const q = filter.q?.trim()
  if (q) {
    where.push({
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { project: { name: { contains: q, mode: 'insensitive' } } },
      ],
    })
  }
  if (filter.statuses?.length) where.push({ status: { in: filter.statuses } })
  else if (!filter.includeClosed) where.push({ status: { notIn: CLOSED_TASK_STATUSES } })
  if (filter.priorities?.length) where.push({ priority: { in: filter.priorities } })
  if (filter.assigneeId) where.push({ assignees: { some: { user_id: filter.assigneeId } } })
  if (filter.unassigned) where.push({ assignees: { none: {} } })
  if (filter.projectId) where.push({ project_id: filter.projectId })
  if (filter.milestoneId) where.push({ milestone_id: filter.milestoneId })
  if (filter.createdBy) where.push({ created_by: filter.createdBy })
  if (filter.topLevelOnly) where.push({ parent_task_id: null })
  switch (filter.submission) {
    case 'PENDING':
      where.push({ submissions: { some: { status: { in: PENDING_REVIEW_STATUSES } } } })
      break
    case 'CHANGES_REQUESTED':
      where.push({ submissions: { some: { status: 'CHANGES_REQUESTED' } }, status: 'CHANGES_REQUESTED' })
      break
    case 'APPROVED':
      where.push({ submissions: { some: { status: 'APPROVED' } } })
      break
    case 'NONE':
      where.push({ submissions: { none: {} } })
      break
  }
  switch (filter.due) {
    case 'overdue':
      where.push({ due_date: { lt: today }, status: { notIn: CLOSED_TASK_STATUSES } })
      break
    case 'today':
      where.push({ due_date: today })
      break
    case 'week':
      where.push({ due_date: { gte: today, lte: addDays(today, 6) } })
      break
    case 'none':
      where.push({ due_date: null })
      break
  }
  if (filter.dueFrom || filter.dueTo) {
    where.push({
      due_date: { ...(filter.dueFrom ? { gte: filter.dueFrom } : {}), ...(filter.dueTo ? { lte: filter.dueTo } : {}) },
    })
  }
  return where
}

function orderBy(sort: TaskSort, dir: 'asc' | 'desc'): Prisma.TaskOrderByWithRelationInput[] {
  switch (sort) {
    case 'due':
      return [{ due_date: { sort: dir, nulls: 'last' } }, { priority: 'desc' }, { id: 'asc' }]
    case 'priority':
      // Enum order is LOW < MEDIUM < HIGH < URGENT.
      return [{ priority: dir === 'asc' ? 'desc' : 'asc' }, { due_date: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }]
    case 'updated':
      return [{ updated_at: dir }, { id: 'asc' }]
    case 'created':
      return [{ created_at: dir }, { id: 'asc' }]
    case 'title':
      return [{ title: dir }, { id: 'asc' }]
    case 'status':
      return [{ status: dir }, { position: 'asc' }, { id: 'asc' }]
  }
}

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

  async countByStatus(scope: Prisma.TaskWhereInput, ...extra: Prisma.TaskWhereInput[]) {
    const rows = await prisma.task.groupBy({ by: ['status'], where: live(scope, ...extra), _count: { _all: true } })
    return rows.map((row) => ({ status: row.status, count: row._count._all }))
  },

  countPendingSubmissions(scope: Prisma.TaskWhereInput) {
    return prisma.task.count({
      where: live(scope, { status: 'IN_REVIEW', submissions: { some: { status: { in: PENDING_REVIEW_STATUSES } } } }),
    })
  },

  count(scope: Prisma.TaskWhereInput, ...extra: Prisma.TaskWhereInput[]) {
    return prisma.task.count({ where: live(scope, ...extra) })
  },

  /** Backwards-compatible simple list (used by existing callers). */
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

  /** Filtered, sorted, paginated rows (server-side). */
  findPage(
    scope: Prisma.TaskWhereInput,
    options: { where: Prisma.TaskWhereInput[]; sort: TaskSort; dir: 'asc' | 'desc'; skip: number; take: number },
  ) {
    const where = live(scope, ...options.where)
    return prisma.$transaction([
      prisma.task.findMany({
        where,
        orderBy: orderBy(options.sort, options.dir),
        skip: options.skip,
        take: options.take,
        select: taskRowSelect,
      }),
      prisma.task.count({ where }),
    ])
  },

  /** Rows for a list of explicit conditions (My Work sections, board columns). */
  findRows(
    scope: Prisma.TaskWhereInput,
    where: Prisma.TaskWhereInput[],
    take: number,
    sort: TaskSort = 'due',
    dir: 'asc' | 'desc' = 'asc',
  ) {
    return prisma.task.findMany({
      where: live(scope, ...where),
      orderBy: orderBy(sort, dir),
      take,
      select: taskRowSelect,
    })
  },

  search(scope: Prisma.TaskWhereInput, term: string, take: number) {
    return prisma.task.findMany({
      where: live(scope, {
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { description: { contains: term, mode: 'insensitive' } },
        ],
      }),
      take,
      select: { id: true, title: true, status: true, project: { select: { name: true } } },
    })
  },

  /** Everything the task detail page shows (after access has been resolved). */
  findDetail(id: string) {
    return prisma.task.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        organization_id: true,
        title: true,
        description: true,
        status: true,
        previous_status: true,
        blocked_reason: true,
        priority: true,
        start_date: true,
        due_date: true,
        started_at: true,
        completed_at: true,
        estimated_minutes: true,
        actual_minutes: true,
        created_at: true,
        updated_at: true,
        parent_task_id: true,
        project: { select: { id: true, name: true, status: true } },
        milestone: { select: { id: true, name: true } },
        parent_task: { select: { id: true, title: true } },
        creator: { select: personSelect },
        updater: { select: personSelect },
        assignees: { orderBy: { assigned_at: 'asc' }, select: { assigned_at: true, user: { select: personSelect } } },
        checklist: {
          orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
          select: {
            id: true,
            title: true,
            is_completed: true,
            completed_at: true,
            completer: { select: personSelect },
          },
        },
        subtasks: {
          where: { deleted_at: null },
          orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
          select: {
            id: true,
            title: true,
            status: true,
            due_date: true,
            assignees: { select: { user: { select: personSelect } } },
          },
        },
        dependencies: {
          select: { id: true, depends_on: { select: { id: true, title: true, status: true, deleted_at: true } } },
        },
        dependents: {
          select: { id: true, task: { select: { id: true, title: true, status: true, deleted_at: true } } },
        },
        attachments: {
          where: { deleted_at: null },
          orderBy: { created_at: 'desc' },
          select: {
            id: true,
            file_name: true,
            mime_type: true,
            file_size: true,
            created_at: true,
            submission_version_id: true,
            uploader: { select: personSelect },
          },
        },
        time_entries: {
          orderBy: { created_at: 'desc' },
          take: 20,
          select: {
            id: true,
            duration_minutes: true,
            description: true,
            created_at: true,
            user: { select: personSelect },
          },
        },
      },
    })
  },

  /** Submissions with every version (newest first) and the files attached to each. */
  listSubmissions(taskId: string) {
    return prisma.taskSubmission.findMany({
      where: { task_id: taskId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        status: true,
        submitted_at: true,
        author: { select: personSelect },
        versions: {
          orderBy: { version_number: 'desc' },
          select: {
            id: true,
            version_number: true,
            description: true,
            status: true,
            submitted_at: true,
            reviewed_at: true,
            review_comment: true,
            creator: { select: personSelect },
            reviewer: { select: personSelect },
            attachments: {
              where: { deleted_at: null },
              select: { id: true, file_name: true, mime_type: true, file_size: true },
            },
          },
        },
      },
    })
  },

  listComments(taskId: string) {
    return prisma.taskComment.findMany({
      where: { task_id: taskId },
      orderBy: { created_at: 'asc' },
      take: 500,
      select: {
        id: true,
        parent_id: true,
        body: true,
        created_at: true,
        edited_at: true,
        deleted_at: true,
        user: { select: personSelect },
        mentions: { select: { user: { select: personSelect } } },
      },
    })
  },
}
