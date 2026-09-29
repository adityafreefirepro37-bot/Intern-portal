import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import { addDays, todayIn } from '@/lib/interns/dates'
import { milestoneDisplayStatus } from '@/lib/work/projects'
import { ACTIVE_WORK_STATUSES, CLOSED_STATUSES, deadlineFor, taskProgress } from '@/lib/work/tasks'
import type { RequestContext } from '../context'
import { projectScope, taskScope } from '../repositories/scope'
import { PENDING_REVIEW_STATUSES, taskRepository, type TaskRow } from '../repositories/task.repository'
import { authorizationService } from './authorization.service'
import { workloadService } from './workload.service'

/**
 * Personal and role-level work summaries: My Work and dashboard sections.
 * Counts are aggregate queries; lists are small, selective and scoped.
 */

const OPEN: Prisma.TaskWhereInput = { status: { notIn: [...CLOSED_STATUSES] } }

function view(ctx: RequestContext, row: TaskRow) {
  return {
    ...row,
    deadline: deadlineFor(row, ctx.organization.timezone),
    progress: taskProgress(row),
    submissionStatus: row.submissions[0]?.status ?? null,
    commentCount: row._count.comments,
    attachmentCount: row._count.attachments,
    checklistDone: row.checklist.filter((i) => i.is_completed).length,
    checklistTotal: row.checklist.length,
  }
}
export type WorkItem = ReturnType<typeof view>

/** Tasks the viewer may review: in their review scope, waiting for review, not their own. */
function reviewable(ctx: RequestContext): Prisma.TaskWhereInput | null {
  const scope = ctx.actor.permissions.get('task.review')
  if (!scope) return null
  return {
    AND: [
      taskScope(ctx.actor, scope),
      { status: 'IN_REVIEW', submissions: { some: { status: { in: PENDING_REVIEW_STATUSES } } } },
      { assignees: { none: { user_id: ctx.actor.userId } } },
    ],
  }
}

export const workService = {
  /** /my-work: the personal command centre. */
  async myWork(ctx: RequestContext) {
    const readScope = ctx.actor.permissions.get('task.read')
    if (!readScope) return null
    const scope = taskScope(ctx.actor, readScope)
    const me = ctx.actor.userId
    const mine: Prisma.TaskWhereInput = { assignees: { some: { user_id: me } } }
    const today = todayIn(ctx.organization.timezone)
    const in7 = addDays(today, 7)
    const recentSince = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    const reviewWhere = reviewable(ctx)
    const list = (
      where: Prisma.TaskWhereInput[],
      take = 25,
      sort: 'due' | 'updated' | 'priority' = 'due',
      dir: 'asc' | 'desc' = 'asc',
    ) => taskRepository.findRows(scope, where, take, sort, dir).then((rows) => rows.map((row) => view(ctx, row)))

    const [
      dueToday,
      overdue,
      inProgress,
      awaitingReview,
      waitingForMe,
      blocked,
      upcoming,
      recentlyCompleted,
      toReview,
      milestones,
      workload,
    ] = await Promise.all([
      list([mine, OPEN, { due_date: today }]),
      list([mine, OPEN, { due_date: { lt: today } }]),
      list([mine, { status: 'IN_PROGRESS' }]),
      list([mine, { status: 'IN_REVIEW' }], 25, 'updated', 'desc'),
      list([mine, { status: { in: ['ASSIGNED', 'CHANGES_REQUESTED'] } }], 25, 'priority'),
      list([mine, { status: 'BLOCKED' }]),
      list([mine, OPEN, { due_date: { gt: today, lte: in7 } }]),
      list([mine, { status: 'COMPLETED', completed_at: { gte: recentSince } }], 10, 'updated', 'desc'),
      reviewWhere ? list([reviewWhere], 25, 'updated', 'asc') : Promise.resolve([]),
      prisma.milestone.findMany({
        where: {
          status: { in: ['UPCOMING', 'ACTIVE'] },
          due_date: { gte: today, lte: addDays(today, 14) },
          project: {
            organization_id: ctx.organization.id,
            deleted_at: null,
            OR: [{ owner_id: me }, { manager_id: me }, { members: { some: { user_id: me } } }],
          },
        },
        orderBy: { due_date: 'asc' },
        take: 8,
        select: { id: true, name: true, status: true, due_date: true, project: { select: { id: true, name: true } } },
      }),
      workloadService.forUsers(ctx, [me]),
    ])
    return {
      dueToday,
      overdue,
      inProgress,
      awaitingReview,
      waitingForMe,
      blocked,
      upcoming,
      recentlyCompleted,
      toReview,
      milestones: milestones.map((m) => ({
        ...m,
        displayStatus: milestoneDisplayStatus(m, ctx.organization.timezone),
      })),
      workload: workload[0] ?? null,
    }
  },

  /**
   * Dashboard work section, shaped by role (via permissions and relationships,
   * never role names). Returns null for viewers without task access.
   */
  async dashboardSummary(ctx: RequestContext) {
    const readScope = ctx.actor.permissions.get('task.read')
    if (!readScope) return null
    const scope = taskScope(ctx.actor, readScope)
    const me = ctx.actor.userId
    const today = todayIn(ctx.organization.timezone)
    const in7 = addDays(today, 7)
    const count = (...where: Prisma.TaskWhereInput[]) => taskRepository.count(scope, ...where)
    const mine: Prisma.TaskWhereInput = { assignees: { some: { user_id: me } } }
    const reviewWhere = reviewable(ctx)
    const orgWide = readScope === 'ORGANIZATION'

    const [myOpen, myDueToday, myOverdue, myInReview, myBlocked, myUpcoming, myProjects, pendingReviews] =
      await Promise.all([
        count(mine, OPEN),
        count(mine, OPEN, { due_date: today }),
        count(mine, OPEN, { due_date: { lt: today } }),
        count(mine, { status: 'IN_REVIEW' }),
        count(mine, { status: 'BLOCKED' }),
        count(mine, OPEN, { due_date: { gt: today, lte: in7 } }),
        prisma.project.count({
          where: {
            organization_id: ctx.organization.id,
            deleted_at: null,
            status: 'ACTIVE',
            OR: [{ owner_id: me }, { manager_id: me }, { members: { some: { user_id: me } } }],
          },
        }),
        reviewWhere
          ? prisma.task.count({ where: { AND: [reviewWhere, { deleted_at: null }] } })
          : Promise.resolve(null),
      ])

    // Team view: tasks of interns the viewer manages/mentors, or in projects they lead.
    const interns = await prisma.intern.findMany({
      where: { organization_id: ctx.organization.id, deleted_at: null, OR: [{ manager_id: me }, { mentor_id: me }] },
      select: { user_id: true },
    })
    const team: Prisma.TaskWhereInput | null =
      interns.length > 0 || !orgWide
        ? {
            OR: [
              { assignees: { some: { user_id: { in: interns.map((i) => i.user_id) } } } },
              {
                project: {
                  OR: [
                    { owner_id: me },
                    { manager_id: me },
                    { members: { some: { user_id: me, role: { in: ['OWNER', 'MANAGER', 'MENTOR'] } } } },
                  ],
                },
              },
            ],
          }
        : null
    const [teamOpen, teamOverdue, teamBlocked] = team
      ? await Promise.all([
          count(team, OPEN),
          count(team, OPEN, { due_date: { lt: today } }),
          count(team, { status: 'BLOCKED' }),
        ])
      : [null, null, null]

    const organization = orgWide
      ? await Promise.all([
          prisma.project.count({ where: { organization_id: ctx.organization.id, deleted_at: null, status: 'ACTIVE' } }),
          count(OPEN),
          count(OPEN, { due_date: { lt: today } }),
          count({ status: 'BLOCKED' }),
          count({ status: 'IN_REVIEW', submissions: { some: { status: { in: PENDING_REVIEW_STATUSES } } } }),
        ]).then(([activeProjects, openTasks, overdue, blocked, pendingReviews]) => ({
          activeProjects,
          openTasks,
          overdue,
          blocked,
          pendingReviews,
        }))
      : null

    const projectScopeGrant = ctx.actor.permissions.get('project.read')
    const projects = projectScopeGrant
      ? await prisma.project.findMany({
          where: {
            AND: [
              projectScope(ctx.actor, projectScopeGrant),
              { deleted_at: null, status: { in: ['PLANNING', 'ACTIVE', 'ON_HOLD'] } },
              orgWide ? {} : { OR: [{ owner_id: me }, { manager_id: me }, { members: { some: { user_id: me } } }] },
            ],
          },
          orderBy: [{ status: 'asc' }, { target_end_date: { sort: 'asc', nulls: 'last' } }],
          take: 5,
          select: { id: true, name: true, status: true, target_end_date: true, progress_percentage: true },
        })
      : []

    const workload = interns.length > 0 ? await workloadService.forMyInterns(ctx) : null

    return {
      mine: {
        open: myOpen,
        dueToday: myDueToday,
        overdue: myOverdue,
        inReview: myInReview,
        blocked: myBlocked,
        upcoming: myUpcoming,
        activeProjects: myProjects,
      },
      pendingReviews,
      team: team ? { open: teamOpen, overdue: teamOverdue, blocked: teamBlocked, interns: interns.length } : null,
      organization,
      projects,
      workload,
      canReview: authorizationService.can(ctx, 'task.review'),
    }
  },

  /**
   * Factual operational metrics (analytics foundation — no judgments).
   * Scoped to what the viewer can read.
   */
  async metrics(ctx: RequestContext) {
    const readScope = authorizationService.require(ctx, 'task.read')
    const scope = taskScope(ctx.actor, readScope)
    const today = todayIn(ctx.organization.timezone)
    const completed = await prisma.task.findMany({
      where: { AND: [scope, { deleted_at: null, status: 'COMPLETED', completed_at: { not: null } }] },
      select: { created_at: true, completed_at: true, due_date: true },
      take: 5000,
    })
    const durations = completed.map((t) => (t.completed_at!.getTime() - t.created_at.getTime()) / 36e5)
    const withDue = completed.filter((t) => t.due_date)
    const onTime = withDue.filter(
      (t) => deadlineFor({ ...t, status: 'COMPLETED' }, ctx.organization.timezone).state === 'COMPLETED_ON_TIME',
    )
    const [total, overdue, blocked, pending] = await Promise.all([
      taskRepository.count(scope, { status: { not: 'CANCELLED' } }),
      taskRepository.count(scope, OPEN, { due_date: { lt: today } }),
      taskRepository.count(scope, { status: 'BLOCKED' }),
      taskRepository.count(scope, { status: 'IN_REVIEW' }),
    ])
    return {
      total_tasks: total,
      completed_tasks: completed.length,
      overdue_tasks: overdue,
      blocked_tasks: blocked,
      pending_reviews: pending,
      average_completion_hours: durations.length
        ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
        : null,
      on_time_completion_rate: withDue.length ? Math.round((onTime.length / withDue.length) * 100) : null,
      active_statuses: ACTIVE_WORK_STATUSES,
    }
  },
}

export type MyWork = NonNullable<Awaited<ReturnType<typeof workService.myWork>>>
export type WorkDashboard = NonNullable<Awaited<ReturnType<typeof workService.dashboardSummary>>>
