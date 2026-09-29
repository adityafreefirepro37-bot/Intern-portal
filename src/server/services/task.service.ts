import type { TaskPriority, TaskStatus } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { AppError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { addDays, parseDateOnly, todayIn } from '@/lib/interns/dates'
import { OPEN_PROJECT_STATUSES } from '@/lib/work/projects'
import {
  allowedTargets,
  BOARD_COLUMNS,
  canNestUnder,
  deadlineFor,
  findTransition,
  TASK_PRIORITIES,
  TASK_STATUSES,
  taskProgress,
  type TransitionActor,
} from '@/lib/work/tasks'
import { fullName } from '@/lib/utils/format'
import { isoDateSchema, parseInput, type Pagination } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { projectScope, taskScope, userScope } from '../repositories/scope'
import {
  TASK_SORTS,
  taskFilterWhere,
  taskRepository,
  type TaskFilter,
  type TaskRow,
} from '../repositories/task.repository'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { skipTake, toPage } from './pagination'
import { projectProgressService } from './project-progress.service'
import { taskLifecycleService, writeTransition } from './task-lifecycle.service'
import { resolveProjectAccess, resolveTaskAccess } from './work-access'

/**
 * Tasks: lists and board (server-side filtering/sorting/pagination), detail,
 * create/edit, assignment and bulk actions. Reads are limited by the
 * `task.read` scope plus project membership (scope.ts); every write goes
 * through resolveTaskAccess / resolveProjectAccess.
 */

function readScope(ctx: RequestContext) {
  return taskScope(ctx.actor, authorizationService.require(ctx, 'task.read'))
}

const csv = <T extends string>(values: readonly T[]) =>
  z
    .string()
    .optional()
    .transform((value) =>
      (value ?? '')
        .split(',')
        .map((v) => v.trim())
        .filter((v): v is T => (values as readonly string[]).includes(v)),
    )
const uuidOrUndefined = z.uuid().optional().catch(undefined)
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || undefined)
const optionalDate = z
  .string()
  .optional()
  .transform((value) => value || undefined)
  .pipe(isoDateSchema.optional())
const optionalId = z
  .string()
  .optional()
  .transform((value) => value || undefined)
  .pipe(z.uuid().optional())
const hoursSchema = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value === '' ? undefined : Number(value)))
  .pipe(z.number().min(0).max(1000).optional())
const idList = z
  .union([z.array(z.string()), z.string()])
  .optional()
  .transform((value) =>
    (Array.isArray(value) ? value : value ? value.split(',') : []).map((v) => v.trim()).filter(Boolean),
  )
  .pipe(z.array(z.uuid()).max(20))

export const taskQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: csv(TASK_STATUSES),
  priority: csv(TASK_PRIORITIES),
  assignee: z
    .union([z.literal('me'), z.literal('none'), z.uuid()])
    .optional()
    .catch(undefined),
  project: uuidOrUndefined,
  milestone: uuidOrUndefined,
  createdBy: z
    .union([z.literal('me'), z.uuid()])
    .optional()
    .catch(undefined),
  submission: z.enum(['PENDING', 'CHANGES_REQUESTED', 'APPROVED', 'NONE']).optional().catch(undefined),
  due: z.enum(['overdue', 'today', 'week', 'none']).optional().catch(undefined),
  closed: z.enum(['1']).optional().catch(undefined),
  sort: z.enum(TASK_SORTS).default('due').catch('due'),
  dir: z.enum(['asc', 'desc']).default('asc').catch('asc'),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
  pageSize: z.coerce
    .number()
    .pipe(z.union([z.literal(25), z.literal(50), z.literal(100)]))
    .default(25)
    .catch(25),
})
export type TaskQuery = z.infer<typeof taskQuerySchema>

function toFilter(ctx: RequestContext, query: TaskQuery): TaskFilter {
  return {
    q: query.q,
    statuses: query.status.length ? query.status : undefined,
    priorities: query.priority.length ? query.priority : undefined,
    assigneeId: query.assignee === 'me' ? ctx.actor.userId : query.assignee === 'none' ? undefined : query.assignee,
    unassigned: query.assignee === 'none',
    projectId: query.project,
    milestoneId: query.milestone,
    createdBy: query.createdBy === 'me' ? ctx.actor.userId : query.createdBy,
    submission: query.submission,
    due: query.due,
    includeClosed: query.closed === '1',
  }
}

/** Project relations of the viewer, loaded once per request for row-level action hints. */
async function relationFacts(ctx: RequestContext) {
  const me = ctx.actor.userId
  const [memberships, led] = await Promise.all([
    prisma.projectMember.findMany({ where: { user_id: me }, select: { project_id: true, role: true } }),
    prisma.project.findMany({
      where: { organization_id: ctx.organization.id, OR: [{ owner_id: me }, { manager_id: me }] },
      select: { id: true },
    }),
  ])
  const lead = new Set([
    ...led.map((p) => p.id),
    ...memberships.filter((m) => m.role === 'OWNER' || m.role === 'MANAGER').map((m) => m.project_id),
  ])
  const mentor = new Set(memberships.filter((m) => m.role === 'MENTOR').map((m) => m.project_id))
  return { lead, mentor }
}

/**
 * The statuses a row can be moved to by this viewer (a UI hint for menus and
 * drag targets; taskLifecycleService re-checks everything on the server).
 */
function rowTargets(
  ctx: RequestContext,
  facts: Awaited<ReturnType<typeof relationFacts>>,
  row: Pick<TaskRow, 'status' | 'created_by' | 'assignees' | 'project'>,
): TaskStatus[] {
  const perms = ctx.actor.permissions
  const me = ctx.actor.userId
  const isAssignee = row.assignees.some((a) => a.user.id === me)
  const projectId = row.project?.id
  const leadByRelation =
    row.created_by === me || (projectId ? facts.lead.has(projectId) || facts.mentor.has(projectId) : false)
  const actors: TransitionActor[] = []
  if (isAssignee && (perms.has('task.submit') || perms.has('task.update'))) actors.push('worker')
  if (perms.has('task.update') && (perms.get('task.update') === 'ORGANIZATION' || leadByRelation)) actors.push('lead')
  return allowedTargets(row.status, actors)
}

function toRowView(ctx: RequestContext, row: TaskRow, targets: TaskStatus[]) {
  return {
    ...row,
    deadline: deadlineFor(row, ctx.organization.timezone),
    progress: taskProgress(row),
    checklistDone: row.checklist.filter((i) => i.is_completed).length,
    checklistTotal: row.checklist.length,
    submissionStatus: row.submissions[0]?.status ?? null,
    commentCount: row._count.comments,
    attachmentCount: row._count.attachments,
    targets,
  }
}
export type TaskRowView = ReturnType<typeof toRowView>

// ── Write schemas ──────────────────────────────────────────────────────────

const datesInOrder = (value: { startDate?: string; dueDate?: string }) =>
  !value.startDate || !value.dueDate || value.dueDate >= value.startDate
const datesMessage = { message: 'The due date must be on or after the start date', path: ['dueDate'] }

export const createTaskSchema = z
  .strictObject({
    title: z.string().trim().min(2, 'Enter a title').max(200),
    description: optionalText(10_000),
    projectId: optionalId,
    milestoneId: optionalId,
    parentTaskId: optionalId,
    priority: z.enum(TASK_PRIORITIES as [TaskPriority, ...TaskPriority[]]).default('MEDIUM'),
    startDate: optionalDate,
    dueDate: optionalDate,
    estimatedHours: hoursSchema,
    assigneeIds: idList,
  })
  .refine(datesInOrder, datesMessage)

export const updateTaskSchema = z
  .strictObject({
    title: z.string().trim().min(2, 'Enter a title').max(200),
    description: optionalText(10_000),
    milestoneId: optionalId,
    priority: z.enum(TASK_PRIORITIES as [TaskPriority, ...TaskPriority[]]),
    startDate: optionalDate,
    dueDate: optionalDate,
    estimatedHours: hoursSchema,
  })
  .refine(datesInOrder, datesMessage)

const hoursToMinutes = (hours: number | undefined) => (hours === undefined ? null : Math.round(hours * 60))

/**
 * Assignees must be active people in the organization. Inside a project they
 * must be project members (not viewers); outside one they must be within the
 * assigner's `task.assign` scope (their own interns, their team…).
 */
async function validateAssignees(ctx: RequestContext, projectId: string | null, userIds: string[]) {
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return []
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, organization_id: ctx.organization.id, status: 'ACTIVE', deleted_at: null },
    select: { id: true },
  })
  if (users.length !== ids.length)
    throw new ValidationError('Choose active people from your organization', { assigneeIds: 'Invalid' })
  if (projectId) {
    const members = await prisma.projectMember.findMany({
      where: { project_id: projectId, user_id: { in: ids }, role: { not: 'VIEWER' } },
      select: { user_id: true },
    })
    if (members.length !== ids.length) {
      throw new ValidationError('Only project members can be assigned. Add them to the project first.', {
        assigneeIds: 'Not a member',
      })
    }
  } else {
    const scope = ctx.actor.permissions.get('task.assign')
    if (!scope) throw new ForbiddenError('You can’t assign tasks')
    const inScope = await prisma.user.count({ where: { AND: [userScope(ctx.actor, scope), { id: { in: ids } }] } })
    if (inScope !== ids.length)
      throw new ValidationError('You can only assign people you work with', { assigneeIds: 'Out of scope' })
  }
  return ids
}

async function audit(
  ctx: RequestContext,
  action: string,
  task: { id: string; project_id: string | null; title?: string },
  metadata: Record<string, unknown> = {},
) {
  await auditService.logForContext(ctx, {
    action,
    resourceType: 'task',
    resourceId: task.id,
    metadata: { projectId: task.project_id, title: task.title, ...metadata },
  })
}

export const taskService = {
  // ── Reads ────────────────────────────────────────────────────────────────

  async list(ctx: RequestContext, pagination: Pagination, filter: { status?: TaskStatus } = {}) {
    const [items, total] = await taskRepository.listPage(readScope(ctx), {
      ...skipTake(pagination),
      status: filter.status,
    })
    return toPage(items, total, pagination)
  },

  /** Filtered, sorted, paginated task list for /tasks and project task tabs. */
  async directory(ctx: RequestContext, rawQuery: unknown, fixed: Partial<TaskFilter> = {}) {
    const scope = readScope(ctx)
    const query = taskQuerySchema.parse(rawQuery ?? {})
    const filter = { ...toFilter(ctx, query), ...fixed }
    const today = todayIn(ctx.organization.timezone)
    const pagination = { page: query.page, pageSize: query.pageSize }
    const [[rows, total], facts] = await Promise.all([
      taskRepository.findPage(scope, {
        where: taskFilterWhere(filter, today),
        sort: query.sort,
        dir: query.dir,
        ...skipTake(pagination),
      }),
      relationFacts(ctx),
    ])
    return {
      query,
      page: toPage(
        rows.map((row) => toRowView(ctx, row, rowTargets(ctx, facts, row))),
        total,
        pagination,
      ),
    }
  },

  /** Board columns (up to `perColumn` cards each, plus the true column counts). */
  async board(ctx: RequestContext, rawQuery: unknown, fixed: Partial<TaskFilter> = {}, perColumn = 50) {
    const scope = readScope(ctx)
    const query = taskQuerySchema.parse(rawQuery ?? {})
    const filter = { ...toFilter(ctx, query), ...fixed, statuses: undefined, includeClosed: true }
    const today = todayIn(ctx.organization.timezone)
    const base = taskFilterWhere(filter, today).filter((w) => !('status' in w && Object.keys(w).length === 1))
    const facts = await relationFacts(ctx)
    const columns = await Promise.all(
      BOARD_COLUMNS.map(async (status) => {
        const where = [...base, { status }]
        const [rows, count] = await Promise.all([
          taskRepository.findRows(scope, where, perColumn, 'priority', 'asc'),
          taskRepository.count(scope, ...where),
        ])
        return { status, count, tasks: rows.map((row) => toRowView(ctx, row, rowTargets(ctx, facts, row))) }
      }),
    )
    return { query, columns }
  },

  async countOpen(ctx: RequestContext) {
    return taskRepository.countOpen(readScope(ctx))
  },

  async countDueWithin(ctx: RequestContext, days: number) {
    const today = todayIn(ctx.organization.timezone)
    return taskRepository.countDueBetween(readScope(ctx), today, addDays(today, days))
  },

  async listUpcoming(ctx: RequestContext, days: number, take: number) {
    const today = todayIn(ctx.organization.timezone)
    return taskRepository.listDueBefore(readScope(ctx), addDays(today, days), take)
  },

  async statusBreakdown(ctx: RequestContext) {
    return taskRepository.countByStatus(readScope(ctx))
  },

  async countPendingReviews(ctx: RequestContext) {
    const scope = authorizationService.require(ctx, 'task.review')
    return taskRepository.countPendingSubmissions(taskScope(ctx.actor, scope))
  },

  /** Everything the task page needs, shaped for this viewer. */
  async getDetail(ctx: RequestContext, taskId: string) {
    const id = parseInput(z.uuid(), taskId)
    const access = await resolveTaskAccess(ctx, id)
    const [task, submissions, comments, activity] = await Promise.all([
      taskRepository.findDetail(id),
      taskRepository.listSubmissions(id),
      taskRepository.listComments(id),
      prisma.auditLog.findMany({
        where: { organization_id: ctx.organization.id, resource_type: 'task', resource_id: id, status: 'SUCCESS' },
        orderBy: { created_at: 'desc' },
        take: 30,
        select: {
          id: true,
          action: true,
          metadata: true,
          created_at: true,
          actor: { select: { first_name: true, last_name: true, display_name: true, avatar_url: true } },
        },
      }),
    ])
    const projectId = task.project?.id ?? null
    const [members, milestones, candidates] = await Promise.all([
      projectId
        ? prisma.projectMember.findMany({
            where: { project_id: projectId, role: { not: 'VIEWER' }, user: { status: 'ACTIVE', deleted_at: null } },
            select: {
              user: { select: { id: true, first_name: true, last_name: true, display_name: true, avatar_url: true } },
            },
          })
        : Promise.resolve([]),
      projectId
        ? prisma.milestone.findMany({
            where: { project_id: projectId },
            orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      access.can.manageDependencies && projectId
        ? prisma.task.findMany({
            where: { project_id: projectId, deleted_at: null, id: { not: id }, status: { not: 'CANCELLED' } },
            orderBy: { title: 'asc' },
            take: 200,
            select: { id: true, title: true },
          })
        : Promise.resolve([]),
    ])
    const targets = allowedTargets(task.status, access.actors).filter((to) => {
      const rule = findTransition(task.status, to)
      return rule && !(rule.by.length === 1 && rule.by[0] === 'review')
    })
    return {
      task,
      deadline: deadlineFor(task, ctx.organization.timezone),
      progress: taskProgress(task),
      submissions,
      comments,
      activity: activity.map((entry) => ({ ...entry, metadata: (entry.metadata ?? {}) as Record<string, unknown> })),
      can: access.can,
      isAssignee: access.isAssignee,
      targets,
      participants: [
        ...new Map(
          [...members.map((m) => m.user), ...task.assignees.map((a) => a.user), task.creator].map((p) => [p.id, p]),
        ).values(),
      ],
      options: {
        assignees: members.map((m) => m.user),
        milestones,
        dependencyCandidates: candidates.filter((c) => !task.dependencies.some((d) => d.depends_on.id === c.id)),
      },
    }
  },

  // ── Writes ───────────────────────────────────────────────────────────────

  async create(ctx: RequestContext, input: unknown) {
    const data = parseInput(createTaskSchema, input)
    let projectId: string | null = data.projectId ?? null
    let parent: { id: string; parent_task_id: string | null; project_id: string | null } | null = null

    if (data.parentTaskId) {
      const parentAccess = await resolveTaskAccess(ctx, data.parentTaskId)
      if (!parentAccess.can.createSubtasks) throw new ForbiddenError('You can’t add subtasks to this task')
      parent = parentAccess.task
      const problem = canNestUnder(parent, { id: null, hasSubtasks: false })
      if (problem) throw new ValidationError(problem)
      projectId = parent.project_id
    }
    if (projectId) {
      const projectAccess = await resolveProjectAccess(ctx, projectId)
      if (!projectAccess.can.createTasks) throw new ForbiddenError('You can’t create tasks in this project')
      if (data.assigneeIds.length && !projectAccess.can.assignTasks) throw new ForbiddenError('You can’t assign tasks')
    } else {
      authorizationService.require(ctx, 'task.create')
      if (data.assigneeIds.length) authorizationService.require(ctx, 'task.assign')
    }
    const milestoneId = projectId ? (data.milestoneId ?? null) : null
    if (milestoneId) {
      const milestone = await prisma.milestone.findFirst({
        where: { id: milestoneId, project_id: projectId! },
        select: { id: true },
      })
      if (!milestone) throw new ValidationError('Choose a milestone from this project', { milestoneId: 'Not found' })
    }
    const assigneeIds = await validateAssignees(ctx, projectId, data.assigneeIds)
    const status: TaskStatus = assigneeIds.length ? 'ASSIGNED' : 'BACKLOG'

    const task = await prisma.$transaction(async (tx) => {
      const last = await tx.task.aggregate({
        where: { project_id: projectId, parent_task_id: parent?.id ?? null, deleted_at: null },
        _max: { position: true },
      })
      const created = await tx.task.create({
        data: {
          organization_id: ctx.organization.id,
          project_id: projectId,
          milestone_id: milestoneId,
          parent_task_id: parent?.id ?? null,
          title: data.title,
          description: data.description ?? null,
          priority: data.priority,
          status,
          start_date: data.startDate ? parseDateOnly(data.startDate) : null,
          due_date: data.dueDate ? parseDateOnly(data.dueDate) : null,
          estimated_minutes: hoursToMinutes(data.estimatedHours),
          position: (last._max.position ?? -1) + 1,
          created_by: ctx.actor.userId,
          updated_by: ctx.actor.userId,
          assignees: { create: assigneeIds.map((user_id) => ({ user_id, assigned_by: ctx.actor.userId })) },
        },
        select: { id: true, project_id: true, title: true },
      })
      return created
    })

    await projectProgressService.recompute(projectId)
    await audit(ctx, AUDIT_ACTIONS.TASK_CREATED, task, { parentTaskId: parent?.id, priority: data.priority })
    await domainEvents.emit('task.created', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { taskId: task.id, projectId },
    })
    if (assigneeIds.length) {
      await audit(ctx, AUDIT_ACTIONS.TASK_ASSIGNED, task, { assigneeIds })
      await domainEvents.emit('task.assigned', {
        organizationId: ctx.organization.id,
        actorUserId: ctx.actor.userId,
        payload: { taskId: task.id, projectId, assigneeIds },
      })
    }
    return { id: task.id }
  },

  async update(ctx: RequestContext, taskId: string, input: unknown) {
    const access = await resolveTaskAccess(ctx, parseInput(z.uuid(), taskId))
    if (!access.can.edit) throw new ForbiddenError('You can’t edit this task')
    const data = parseInput(updateTaskSchema, input)
    const { task } = access
    const current = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { priority: true, due_date: true, start_date: true, title: true },
    })
    if (data.milestoneId) {
      if (!task.project_id) throw new ValidationError('Only project tasks can have a milestone')
      const milestone = await prisma.milestone.findFirst({
        where: { id: data.milestoneId, project_id: task.project_id },
        select: { id: true },
      })
      if (!milestone) throw new ValidationError('Choose a milestone from this project', { milestoneId: 'Not found' })
    }
    const due = data.dueDate ? parseDateOnly(data.dueDate) : null
    const start = data.startDate ? parseDateOnly(data.startDate) : null
    await prisma.task.update({
      where: { id: task.id },
      data: {
        title: data.title,
        description: data.description ?? null,
        priority: data.priority,
        milestone_id: data.milestoneId ?? null,
        start_date: start,
        due_date: due,
        estimated_minutes: hoursToMinutes(data.estimatedHours),
        updated_by: ctx.actor.userId,
      },
    })
    const ref = { id: task.id, project_id: task.project_id, title: data.title }
    await audit(ctx, AUDIT_ACTIONS.TASK_UPDATED, ref, { fields: Object.keys(data) })
    if (current.priority !== data.priority) {
      await audit(ctx, AUDIT_ACTIONS.TASK_PRIORITY_CHANGED, ref, { from: current.priority, to: data.priority })
    }
    if ((current.due_date?.getTime() ?? null) !== (due?.getTime() ?? null)) {
      await audit(ctx, AUDIT_ACTIONS.TASK_DEADLINE_CHANGED, ref, {
        from: current.due_date?.toISOString().slice(0, 10) ?? null,
        to: data.dueDate ?? null,
      })
    }
  },

  /** Replaces the assignee list. A backlog task with assignees moves to Assigned. */
  async setAssignees(ctx: RequestContext, input: unknown) {
    const data = parseInput(z.strictObject({ taskId: z.uuid(), assigneeIds: idList }), input)
    const access = await resolveTaskAccess(ctx, data.taskId)
    if (!access.can.assign) throw new ForbiddenError('You can’t assign this task')
    const { task } = access
    const ids = await validateAssignees(ctx, task.project_id, data.assigneeIds)
    const current = task.assignees.map((a) => a.user_id)
    const added = ids.filter((id) => !current.includes(id))
    const removed = current.filter((id) => !ids.includes(id))
    if (added.length === 0 && removed.length === 0) return { changed: false }

    const autoAssign = task.status === 'BACKLOG' && ids.length > 0
    await prisma.$transaction(async (tx) => {
      if (removed.length) await tx.taskAssignee.deleteMany({ where: { task_id: task.id, user_id: { in: removed } } })
      if (added.length) {
        await tx.taskAssignee.createMany({
          data: added.map((user_id) => ({ task_id: task.id, user_id, assigned_by: ctx.actor.userId })),
          skipDuplicates: true,
        })
      }
      await tx.task.update({ where: { id: task.id }, data: { updated_by: ctx.actor.userId } })
      if (autoAssign) await writeTransition(tx, task, 'ASSIGNED', ctx.actor.userId)
    })
    if (added.length) {
      await audit(ctx, AUDIT_ACTIONS.TASK_ASSIGNED, task, { assigneeIds: added })
      await domainEvents.emit('task.assigned', {
        organizationId: ctx.organization.id,
        actorUserId: ctx.actor.userId,
        payload: { taskId: task.id, projectId: task.project_id, assigneeIds: added },
      })
    }
    if (removed.length) await audit(ctx, AUDIT_ACTIONS.TASK_UNASSIGNED, task, { assigneeIds: removed })
    if (autoAssign) {
      await audit(ctx, AUDIT_ACTIONS.TASK_STATUS_CHANGED, task, { from: 'BACKLOG', to: 'ASSIGNED', via: 'assignment' })
    }
    return { changed: true }
  },

  /** Soft delete (with subtasks). History stays in the audit log. */
  async remove(ctx: RequestContext, taskId: string) {
    const access = await resolveTaskAccess(ctx, parseInput(z.uuid(), taskId))
    if (!access.can.delete) throw new ForbiddenError('You can’t delete this task')
    const { task } = access
    const now = new Date()
    await prisma.task.updateMany({
      where: { OR: [{ id: task.id }, { parent_task_id: task.id }], deleted_at: null },
      data: { deleted_at: now, updated_by: ctx.actor.userId },
    })
    await projectProgressService.recompute(task.project_id)
    await audit(ctx, AUDIT_ACTIONS.TASK_DELETED, task)
  },

  /** Moves a task (and its subtasks) to another project the actor can create tasks in. */
  async moveToProject(ctx: RequestContext, taskId: string, targetProjectId: string) {
    const access = await resolveTaskAccess(ctx, taskId)
    if (!access.can.edit) throw new ForbiddenError('You can’t move this task')
    const { task } = access
    if (task.parent_task_id) throw new ValidationError('Move the parent task instead')
    if (task.project_id === targetProjectId) return
    const target = await resolveProjectAccess(ctx, targetProjectId)
    if (!target.can.createTasks) throw new ForbiddenError('You can’t add tasks to that project')
    const assignees = task.assignees.map((a) => a.user_id)
    if (assignees.length) await validateAssignees(ctx, targetProjectId, assignees)
    await prisma.$transaction([
      prisma.task.updateMany({
        where: { OR: [{ id: task.id }, { parent_task_id: task.id }] },
        data: { project_id: targetProjectId, milestone_id: null, updated_by: ctx.actor.userId },
      }),
      // Dependencies never cross projects.
      prisma.taskDependency.deleteMany({ where: { OR: [{ task_id: task.id }, { depends_on_task_id: task.id }] } }),
    ])
    await projectProgressService.recompute(task.project_id)
    await projectProgressService.recompute(targetProjectId)
    await audit(
      ctx,
      AUDIT_ACTIONS.TASK_UPDATED,
      { ...task, project_id: targetProjectId },
      { movedFrom: task.project_id },
    )
  },

  /**
   * Bulk actions. Each task is checked and changed on its own (so one task the
   * viewer can't change never blocks the rest), audited individually, and the
   * result lists what failed and why.
   */
  async bulk(ctx: RequestContext, input: unknown) {
    const data = parseInput(
      z.strictObject({
        taskIds: z.array(z.uuid()).min(1).max(100),
        action: z.enum(['assign', 'priority', 'status', 'move', 'archive']),
        value: z.string().max(2000).optional(),
        reason: z.string().trim().max(500).optional(),
      }),
      input,
    )
    const ids = [...new Set(data.taskIds)]
    const results: { id: string; ok: boolean; error?: string }[] = []
    for (const id of ids) {
      try {
        switch (data.action) {
          case 'assign': {
            const assigneeIds = (data.value ?? '').split(',').filter(Boolean)
            const access = await resolveTaskAccess(ctx, id)
            const merged = [...new Set([...access.task.assignees.map((a) => a.user_id), ...assigneeIds])]
            await this.setAssignees(ctx, { taskId: id, assigneeIds: merged })
            break
          }
          case 'priority': {
            const priority = z.enum(TASK_PRIORITIES as [TaskPriority, ...TaskPriority[]]).parse(data.value)
            const access = await resolveTaskAccess(ctx, id)
            if (!access.can.edit) throw new ForbiddenError()
            const before = await prisma.task.findUniqueOrThrow({ where: { id }, select: { priority: true } })
            if (before.priority !== priority) {
              await prisma.task.update({ where: { id }, data: { priority, updated_by: ctx.actor.userId } })
              await audit(ctx, AUDIT_ACTIONS.TASK_PRIORITY_CHANGED, access.task, {
                from: before.priority,
                to: priority,
                bulk: true,
              })
            }
            break
          }
          case 'status':
            await taskLifecycleService.transitionStatus(ctx, { taskId: id, to: data.value, reason: data.reason })
            break
          case 'move':
            await this.moveToProject(ctx, id, parseInput(z.uuid(), data.value))
            break
          case 'archive':
            await this.remove(ctx, id)
            break
        }
        results.push({ id, ok: true })
      } catch (error) {
        const message =
          error instanceof NotFoundError
            ? 'Not found'
            : error instanceof AppError && error.expose
              ? error.message
              : 'Failed'
        results.push({ id, ok: false, error: message })
      }
    }
    return { succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) }
  },

  /** Filter options within the viewer's scope: people they can see and projects they can read. */
  async filterOptions(ctx: RequestContext) {
    const taskGrant = authorizationService.require(ctx, 'task.read')
    const projectGrant = ctx.actor.permissions.get('project.read')
    const [people, projects] = await Promise.all([
      prisma.user.findMany({
        where: { AND: [userScope(ctx.actor, taskGrant), { status: 'ACTIVE', deleted_at: null }] },
        orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
        take: 300,
        select: { id: true, first_name: true, last_name: true, display_name: true },
      }),
      projectGrant
        ? prisma.project.findMany({
            where: { AND: [projectScope(ctx.actor, projectGrant), { deleted_at: null }] },
            orderBy: { name: 'asc' },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ])
    return {
      people: people.map((p) => ({ value: p.id, label: fullName(p) })),
      projects: projects.map((p) => ({ value: p.id, label: p.name })),
    }
  },

  /** Options for create forms: projects the viewer can add tasks to, with their members and milestones. */
  async createOptions(ctx: RequestContext) {
    authorizationService.require(ctx, 'task.create')
    const scope = ctx.actor.permissions.get('project.read')
    const projects = scope
      ? await prisma.project.findMany({
          where: {
            organization_id: ctx.organization.id,
            deleted_at: null,
            status: { in: [...OPEN_PROJECT_STATUSES] },
          },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            status: true,
            owner_id: true,
            manager_id: true,
            members: {
              where: { role: { not: 'VIEWER' } },
              select: {
                role: true,
                user: { select: { id: true, first_name: true, last_name: true, display_name: true } },
              },
            },
            milestones: { orderBy: { position: 'asc' }, select: { id: true, name: true } },
          },
        })
      : []
    const me = ctx.actor.userId
    const orgWideCreate = ctx.actor.permissions.get('task.create') === 'ORGANIZATION'
    const usable = projects.filter((p) => {
      const role = p.members.find((m) => m.user.id === me)?.role
      return (
        orgWideCreate ||
        p.owner_id === me ||
        p.manager_id === me ||
        role === 'OWNER' ||
        role === 'MANAGER' ||
        role === 'MENTOR'
      )
    })
    return {
      projects: usable.map((p) => ({
        id: p.id,
        name: p.name,
        members: p.members.map((m) => m.user),
        milestones: p.milestones,
      })),
      canAssign: ctx.actor.permissions.has('task.assign'),
    }
  },
}

export type TaskDetail = Awaited<ReturnType<typeof taskService.getDetail>>
export type TaskDirectory = Awaited<ReturnType<typeof taskService.directory>>
export type TaskBoard = Awaited<ReturnType<typeof taskService.board>>
