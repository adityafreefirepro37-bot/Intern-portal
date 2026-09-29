import type { ProjectMemberRole, ProjectStatus, TaskStatus } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import type { PermissionKey } from '@/lib/permissions'
import { OPEN_PROJECT_STATUSES } from '@/lib/work/projects'
import type { TransitionActor } from '@/lib/work/tasks'
import type { RequestContext } from '../context'
import { projectScope, taskScope } from '../repositories/scope'

/**
 * Authorization for projects and tasks, combining global RBAC with project
 * membership. Records are loaded through the scope filters, so anything out
 * of scope (or in another organization) is a 404. Capabilities are computed
 * once here and used by services and pages alike.
 *
 * Roles inside a project:
 *   lead    = project owner/manager (owner_id, manager_id, or OWNER/MANAGER member)
 *   mentor  = MENTOR member
 *   member  = any member (VIEWER is read-only)
 * Organization-wide grants (HR/Admin) act as lead everywhere.
 */

function orgWide(ctx: RequestContext, permission: PermissionKey) {
  return ctx.actor.permissions.get(permission) === 'ORGANIZATION'
}
function has(ctx: RequestContext, permission: PermissionKey) {
  return ctx.actor.permissions.has(permission)
}

export interface ProjectRelation {
  role: ProjectMemberRole | null
  isOwner: boolean
  isLead: boolean
  isMentor: boolean
  isMember: boolean
}

function relationTo(
  ctx: RequestContext,
  project: { owner_id: string | null; manager_id: string | null; members: { role: ProjectMemberRole }[] },
): ProjectRelation {
  const me = ctx.actor.userId
  const role = project.members[0]?.role ?? null
  const isOwner = project.owner_id === me || role === 'OWNER'
  const isLead = isOwner || project.manager_id === me || role === 'MANAGER'
  const isMentor = role === 'MENTOR'
  return { role, isOwner, isLead, isMentor, isMember: role !== null || isLead }
}

export function projectCapabilities(
  ctx: RequestContext,
  project: { status: ProjectStatus },
  relation: ProjectRelation,
) {
  const open = OPEN_PROJECT_STATUSES.includes(project.status)
  const edit = has(ctx, 'project.update') && (orgWide(ctx, 'project.update') || relation.isLead)
  return {
    edit,
    changeStatus: edit,
    archive: has(ctx, 'project.delete') && (orgWide(ctx, 'project.delete') || relation.isOwner),
    manageMembers: has(ctx, 'project.manage_members') && (orgWide(ctx, 'project.manage_members') || relation.isLead),
    manageMilestones: edit && open,
    createTasks:
      open && has(ctx, 'task.create') && (orgWide(ctx, 'task.create') || relation.isLead || relation.isMentor),
    assignTasks: has(ctx, 'task.assign') && (orgWide(ctx, 'task.assign') || relation.isLead || relation.isMentor),
    uploadFiles: open && (edit || (relation.isMember && relation.role !== 'VIEWER')),
    viewWorkload: relation.isLead || relation.isMentor || orgWide(ctx, 'project.update'),
  }
}

export type ProjectCapabilities = ReturnType<typeof projectCapabilities>

export async function resolveProjectAccess(ctx: RequestContext, projectId: string) {
  const readScope = ctx.actor.permissions.get('project.read')
  if (!readScope) throw new ForbiddenError()
  const project = await prisma.project.findFirst({
    where: { AND: [projectScope(ctx.actor, readScope), { id: projectId, deleted_at: null }] },
    select: {
      id: true,
      organization_id: true,
      name: true,
      slug: true,
      status: true,
      owner_id: true,
      manager_id: true,
      members: { where: { user_id: ctx.actor.userId }, select: { role: true } },
    },
  })
  if (!project) throw new NotFoundError('Project')
  const relation = relationTo(ctx, project)
  return { project, relation, can: projectCapabilities(ctx, project, relation) }
}

export type ProjectAccess = Awaited<ReturnType<typeof resolveProjectAccess>>

const taskAccessSelect = (userId: string) =>
  ({
    id: true,
    organization_id: true,
    project_id: true,
    milestone_id: true,
    parent_task_id: true,
    title: true,
    status: true,
    previous_status: true,
    created_by: true,
    due_date: true,
    start_date: true,
    assignees: { select: { user_id: true } },
    project: {
      select: {
        id: true,
        status: true,
        owner_id: true,
        manager_id: true,
        members: { where: { user_id: userId }, select: { role: true } },
      },
    },
  }) as const

export interface TaskCapabilities {
  view: true
  edit: boolean
  assign: boolean
  delete: boolean
  comment: boolean
  work: boolean
  submit: boolean
  review: boolean
  manageDependencies: boolean
  createSubtasks: boolean
  logTime: boolean
}

export async function resolveTaskAccess(ctx: RequestContext, taskId: string) {
  const readScope = ctx.actor.permissions.get('task.read')
  if (!readScope) throw new ForbiddenError()
  const task = await prisma.task.findFirst({
    where: { AND: [taskScope(ctx.actor, readScope), { id: taskId, deleted_at: null }] },
    select: taskAccessSelect(ctx.actor.userId),
  })
  if (!task) throw new NotFoundError('Task')

  const me = ctx.actor.userId
  const assigneeIds = task.assignees.map((a) => a.user_id)
  const isAssignee = assigneeIds.includes(me)
  const isCreator = task.created_by === me
  const relation = task.project ? relationTo(ctx, task.project) : null
  const projectLead = relation?.isLead ?? false
  const projectMentor = relation?.isMentor ?? false
  // Managers/mentors of an assignee may review that intern's work.
  const guidesAssignee =
    assigneeIds.length > 0 &&
    (await prisma.intern.count({
      where: {
        organization_id: ctx.organization.id,
        user_id: { in: assigneeIds },
        OR: [{ manager_id: me }, { mentor_id: me }],
      },
    })) > 0

  const leadByRelation = isCreator || projectLead || projectMentor
  const lead = has(ctx, 'task.update') && (orgWide(ctx, 'task.update') || leadByRelation)
  const worker = isAssignee && (has(ctx, 'task.submit') || has(ctx, 'task.update'))

  const can: TaskCapabilities = {
    view: true,
    edit: lead,
    assign: has(ctx, 'task.assign') && (orgWide(ctx, 'task.assign') || leadByRelation),
    delete: has(ctx, 'task.delete') && (orgWide(ctx, 'task.delete') || isCreator || projectLead),
    comment: has(ctx, 'task.comment'),
    work: worker || lead,
    submit: isAssignee && has(ctx, 'task.submit'),
    review: has(ctx, 'task.review') && !isAssignee && (orgWide(ctx, 'task.review') || leadByRelation || guidesAssignee),
    manageDependencies: lead,
    createSubtasks: lead && has(ctx, 'task.create') && !task.parent_task_id,
    logTime: isAssignee,
  }
  const actors: TransitionActor[] = [...(worker ? (['worker'] as const) : []), ...(lead ? (['lead'] as const) : [])]
  return { task, isAssignee, isCreator, relation, can, actors }
}

export type TaskAccess = Awaited<ReturnType<typeof resolveTaskAccess>>

/** Statuses counted as "open" work. */
export const OPEN_TASK: { status: { notIn: TaskStatus[] } } = { status: { notIn: ['COMPLETED', 'CANCELLED'] } }
