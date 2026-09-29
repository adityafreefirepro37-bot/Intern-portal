import type { ProjectMemberRole, ProjectStatus, TaskPriority } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { parseDateOnly, todayIn } from '@/lib/interns/dates'
import { getStorageService } from '@/lib/storage'
import { fullName } from '@/lib/utils/format'
import { MEMBER_ROLES, milestoneDisplayStatus, PROJECT_STATUSES } from '@/lib/work/projects'
import { TASK_PRIORITIES, workProgress } from '@/lib/work/tasks'
import { isoDateSchema, parseInput, type Pagination } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { PROJECT_SORTS, projectRepository, type ProjectFilter } from '../repositories/project.repository'
import { projectScope } from '../repositories/scope'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { skipTake, toPage } from './pagination'
import type { UploadFile } from './task-submission.service'
import { projectCapabilities, resolveProjectAccess, type ProjectAccess } from './work-access'
import { workloadService } from './workload.service'

/**
 * Projects: list (scope + filters), overview dashboard, create/edit,
 * membership and shared files. Status changes live in
 * projectLifecycleService; milestones in milestoneService.
 */

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

export const projectQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: csv(PROJECT_STATUSES),
  manager: z.uuid().optional().catch(undefined),
  member: z
    .union([z.literal('me'), z.uuid()])
    .optional()
    .catch(undefined),
  startFrom: isoDateSchema.optional().catch(undefined),
  startTo: isoDateSchema.optional().catch(undefined),
  dueFrom: isoDateSchema.optional().catch(undefined),
  dueTo: isoDateSchema.optional().catch(undefined),
  sort: z.enum(PROJECT_SORTS).default('status').catch('status'),
  dir: z.enum(['asc', 'desc']).default('asc').catch('asc'),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
  pageSize: z.coerce
    .number()
    .pipe(z.union([z.literal(24), z.literal(48), z.literal(96)]))
    .default(24)
    .catch(24),
})

const datesInOrder = (value: { startDate?: string; targetEndDate?: string }) =>
  !value.startDate || !value.targetEndDate || value.targetEndDate >= value.startDate
const datesMessage = { message: 'The target end date must be on or after the start date', path: ['targetEndDate'] }

const projectFields = {
  name: z.string().trim().min(3, 'Enter a project name').max(120),
  description: z
    .string()
    .trim()
    .max(5000)
    .optional()
    .transform((value) => value || undefined),
  priority: z.enum(TASK_PRIORITIES as [TaskPriority, ...TaskPriority[]]).default('MEDIUM'),
  managerId: optionalId,
  startDate: optionalDate,
  targetEndDate: optionalDate,
}
export const createProjectSchema = z.strictObject(projectFields).refine(datesInOrder, datesMessage)
export const updateProjectSchema = z.strictObject(projectFields).refine(datesInOrder, datesMessage)

const memberSchema = z.strictObject({
  projectId: z.uuid(),
  userId: z.uuid(),
  role: z.enum(MEMBER_ROLES as [ProjectMemberRole, ...ProjectMemberRole[]]),
})

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'project'
  )
}

async function uniqueSlug(organizationId: string, name: string, excludeId?: string) {
  const base = slugify(name)
  for (let attempt = 0; attempt < 50; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`
    const clash = await prisma.project.findFirst({
      where: { organization_id: organizationId, slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    })
    if (!clash) return slug
  }
  throw new ConflictError('Choose a more distinctive project name')
}

/** Managers/owners must be active staff (not interns). */
async function assertStaff(ctx: RequestContext, userId: string | undefined, field: string) {
  if (!userId) return
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      organization_id: ctx.organization.id,
      status: 'ACTIVE',
      deleted_at: null,
      intern: { is: null },
    },
    select: { id: true },
  })
  if (!user) throw new ValidationError('Choose an active staff member', { [field]: 'Not an active staff member' })
}

export async function auditProject(
  ctx: RequestContext,
  action: string,
  projectId: string,
  metadata: Record<string, unknown> = {},
  resource: { type: string; id: string } = { type: 'project', id: projectId },
) {
  await auditService.logForContext(ctx, {
    action,
    resourceType: resource.type,
    resourceId: resource.id,
    metadata: { projectId, ...metadata },
  })
}

function requireCan(access: ProjectAccess, capability: keyof ProjectAccess['can'], message: string) {
  if (!access.can[capability]) throw new ForbiddenError(message)
}

export const projectService = {
  async list(ctx: RequestContext, pagination: Pagination, filter: { statuses?: ProjectStatus[] } = {}) {
    const scope = authorizationService.require(ctx, 'project.read')
    const [projects, total] = await projectRepository.listPage(projectScope(ctx.actor, scope), {
      ...skipTake(pagination),
      statuses: filter.statuses,
    })
    const counts = await projectRepository.taskProgress(
      ctx.organization.id,
      projects.map((project) => project.id),
    )
    return toPage(
      projects.map((project) => {
        const count = counts.get(project.id) ?? { total: 0, completed: 0 }
        return {
          ...project,
          taskCount: count.total,
          completedTaskCount: count.completed,
          progressPercent: project.progress_percentage,
        }
      }),
      total,
      pagination,
    )
  },

  /** /projects: filters, sort, pagination and status totals within the viewer's scope. */
  async directory(ctx: RequestContext, rawQuery: unknown) {
    const scope = authorizationService.require(ctx, 'project.read')
    const query = projectQuerySchema.parse(rawQuery ?? {})
    const where = projectScope(ctx.actor, scope)
    const filter: ProjectFilter = {
      q: query.q,
      statuses: query.status.length ? query.status : undefined,
      managerId: query.manager,
      memberId: query.member === 'me' ? ctx.actor.userId : query.member,
      startFrom: query.startFrom ? parseDateOnly(query.startFrom) : undefined,
      startTo: query.startTo ? parseDateOnly(query.startTo) : undefined,
      dueFrom: query.dueFrom ? parseDateOnly(query.dueFrom) : undefined,
      dueTo: query.dueTo ? parseDateOnly(query.dueTo) : undefined,
    }
    // Archived projects are hidden unless explicitly requested.
    if (!filter.statuses) filter.statuses = PROJECT_STATUSES.filter((s) => s !== 'ARCHIVED')
    const pagination = { page: query.page, pageSize: query.pageSize }
    const [[rows, total], byStatus] = await Promise.all([
      projectRepository.findPage(where, { filter, sort: query.sort, dir: query.dir, ...skipTake(pagination) }),
      projectRepository.countByStatus(where),
    ])
    return { query, page: toPage(rows, total, pagination), byStatus }
  },

  /** Project dashboard data (header, KPIs, milestones timeline, workload, recent activity). */
  async getOverview(ctx: RequestContext, projectId: string) {
    const access = await resolveProjectAccess(ctx, parseInput(z.uuid(), projectId))
    const id = access.project.id
    const today = todayIn(ctx.organization.timezone)
    const [project, stats, milestones, activity] = await Promise.all([
      projectRepository.findDetail(id),
      projectRepository.taskStats(id, today),
      projectRepository.listMilestones(id),
      projectRepository.activity(ctx.organization.id, id, 12),
    ])
    const workload = access.can.viewWorkload
      ? await workloadService.forUsers(
          ctx,
          project.members.filter((m) => m.role === 'CONTRIBUTOR').map((m) => m.user.id),
          { projectId: id },
        )
      : null
    return {
      access,
      project,
      stats,
      milestones: milestones.map(({ tasks, ...milestone }) => ({
        ...milestone,
        displayStatus: milestoneDisplayStatus(milestone, ctx.organization.timezone),
        progress: workProgress(tasks),
      })),
      activity,
      workload,
    }
  },

  /** Header data shared by every project sub-page. */
  async getHeader(ctx: RequestContext, projectId: string) {
    const access = await resolveProjectAccess(ctx, parseInput(z.uuid(), projectId))
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: access.project.id },
      select: {
        id: true,
        name: true,
        status: true,
        priority: true,
        start_date: true,
        target_end_date: true,
        progress_percentage: true,
        manager: { select: { id: true, first_name: true, last_name: true, display_name: true, avatar_url: true } },
        _count: { select: { members: true } },
      },
    })
    return { access, project }
  },

  async listMilestones(ctx: RequestContext, projectId: string) {
    const access = await resolveProjectAccess(ctx, parseInput(z.uuid(), projectId))
    const milestones = await projectRepository.listMilestones(access.project.id)
    return {
      access,
      milestones: milestones.map(({ tasks, ...milestone }) => ({
        ...milestone,
        displayStatus: milestoneDisplayStatus(milestone, ctx.organization.timezone),
        progress: workProgress(tasks),
      })),
    }
  },

  async listActivity(ctx: RequestContext, projectId: string) {
    const access = await resolveProjectAccess(ctx, parseInput(z.uuid(), projectId))
    return { access, activity: await projectRepository.activity(ctx.organization.id, access.project.id, 100) }
  },

  async listMembers(ctx: RequestContext, projectId: string) {
    const access = await resolveProjectAccess(ctx, parseInput(z.uuid(), projectId))
    const project = await projectRepository.findDetail(access.project.id)
    const candidates = access.can.manageMembers
      ? await prisma.user.findMany({
          where: {
            organization_id: ctx.organization.id,
            status: 'ACTIVE',
            deleted_at: null,
            project_memberships: { none: { project_id: access.project.id } },
          },
          orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
          select: {
            id: true,
            first_name: true,
            last_name: true,
            display_name: true,
            intern: { select: { id: true } },
            user_roles: { select: { role: { select: { name: true } } } },
          },
        })
      : []
    return {
      access,
      project,
      candidates: candidates.map((user) => ({
        id: user.id,
        name: fullName(user),
        isIntern: Boolean(user.intern),
        roles: user.user_roles.map((r) => r.role.name).join(', '),
      })),
    }
  },

  async create(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'project.create')
    const data = parseInput(createProjectSchema, input)
    await assertStaff(ctx, data.managerId, 'managerId')
    const slug = await uniqueSlug(ctx.organization.id, data.name)
    const managerId = data.managerId ?? ctx.actor.userId
    const project = await prisma.project.create({
      data: {
        organization_id: ctx.organization.id,
        name: data.name,
        slug,
        description: data.description ?? null,
        priority: data.priority,
        status: 'PLANNING',
        start_date: data.startDate ? parseDateOnly(data.startDate) : null,
        target_end_date: data.targetEndDate ? parseDateOnly(data.targetEndDate) : null,
        owner_id: ctx.actor.userId,
        manager_id: managerId,
        created_by: ctx.actor.userId,
        members: {
          create: [
            { user_id: ctx.actor.userId, role: 'OWNER', added_by: ctx.actor.userId },
            ...(managerId !== ctx.actor.userId
              ? [{ user_id: managerId, role: 'MANAGER' as const, added_by: ctx.actor.userId }]
              : []),
          ],
        },
      },
      select: { id: true, slug: true },
    })
    await auditProject(ctx, AUDIT_ACTIONS.PROJECT_CREATED, project.id, { name: data.name })
    await domainEvents.emit('project.created', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { projectId: project.id },
    })
    if (managerId !== ctx.actor.userId) {
      await domainEvents.emit('project.member_added', {
        organizationId: ctx.organization.id,
        actorUserId: ctx.actor.userId,
        payload: { projectId: project.id, userId: managerId, role: 'MANAGER' },
      })
    }
    return project
  },

  async update(ctx: RequestContext, projectId: string, input: unknown) {
    const access = await resolveProjectAccess(ctx, parseInput(z.uuid(), projectId))
    requireCan(access, 'edit', 'You can’t edit this project')
    const data = parseInput(updateProjectSchema, input)
    await assertStaff(ctx, data.managerId, 'managerId')
    const slug = await uniqueSlug(ctx.organization.id, data.name, access.project.id)
    const managerChanged = data.managerId !== undefined && data.managerId !== access.project.manager_id
    await prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: access.project.id },
        data: {
          name: data.name,
          slug,
          description: data.description ?? null,
          priority: data.priority,
          start_date: data.startDate ? parseDateOnly(data.startDate) : null,
          target_end_date: data.targetEndDate ? parseDateOnly(data.targetEndDate) : null,
          ...(managerChanged ? { manager_id: data.managerId } : {}),
        },
      })
      // The project manager is always a member with the MANAGER role (unless they're the owner).
      if (managerChanged && data.managerId) {
        await tx.projectMember.upsert({
          where: { project_id_user_id: { project_id: access.project.id, user_id: data.managerId } },
          update: { role: 'MANAGER' },
          create: {
            project_id: access.project.id,
            user_id: data.managerId,
            role: 'MANAGER',
            added_by: ctx.actor.userId,
          },
        })
      }
    })
    await auditProject(ctx, AUDIT_ACTIONS.PROJECT_UPDATED, access.project.id, {
      fields: Object.keys(data),
      ...(managerChanged ? { managerFrom: access.project.manager_id, managerTo: data.managerId } : {}),
    })
  },

  /** Adds a member or changes their role. */
  async setMember(ctx: RequestContext, input: unknown) {
    const data = parseInput(memberSchema, input)
    const access = await resolveProjectAccess(ctx, data.projectId)
    requireCan(access, 'manageMembers', 'You can’t manage this project’s members')
    const user = await prisma.user.findFirst({
      where: { id: data.userId, organization_id: ctx.organization.id, status: 'ACTIVE', deleted_at: null },
      select: { id: true, intern: { select: { id: true } } },
    })
    if (!user) throw new ValidationError('Choose an active person from your organization', { userId: 'Not found' })
    if (user.intern && ['OWNER', 'MANAGER', 'MENTOR'].includes(data.role)) {
      throw new ValidationError('Interns can be contributors or viewers', { role: 'Not allowed for interns' })
    }
    if (
      data.role === 'OWNER' &&
      !access.relation.isOwner &&
      ctx.actor.permissions.get('project.update') !== 'ORGANIZATION'
    ) {
      throw new ForbiddenError('Only the owner can add another owner')
    }
    const existing = await prisma.projectMember.findUnique({
      where: { project_id_user_id: { project_id: access.project.id, user_id: data.userId } },
      select: { role: true },
    })
    if (existing?.role === data.role) return { changed: false }
    if (existing && data.userId === access.project.owner_id && data.role !== 'OWNER') {
      throw new ValidationError('Transfer ownership before changing the owner’s role')
    }
    await prisma.projectMember.upsert({
      where: { project_id_user_id: { project_id: access.project.id, user_id: data.userId } },
      update: { role: data.role },
      create: { project_id: access.project.id, user_id: data.userId, role: data.role, added_by: ctx.actor.userId },
    })
    await auditProject(ctx, AUDIT_ACTIONS.PROJECT_MEMBER_ADDED, access.project.id, {
      userId: data.userId,
      role: data.role,
      ...(existing ? { previousRole: existing.role } : {}),
    })
    if (!existing) {
      await domainEvents.emit('project.member_added', {
        organizationId: ctx.organization.id,
        actorUserId: ctx.actor.userId,
        payload: { projectId: access.project.id, userId: data.userId, role: data.role },
      })
    }
    return { changed: true }
  },

  /** Removes a member. Their open task assignments in this project are released. */
  async removeMember(ctx: RequestContext, input: unknown) {
    const data = parseInput(z.strictObject({ projectId: z.uuid(), userId: z.uuid() }), input)
    const access = await resolveProjectAccess(ctx, data.projectId)
    requireCan(access, 'manageMembers', 'You can’t manage this project’s members')
    if (data.userId === access.project.owner_id) throw new ValidationError('The project owner can’t be removed')
    const member = await prisma.projectMember.findUnique({
      where: { project_id_user_id: { project_id: access.project.id, user_id: data.userId } },
    })
    if (!member) throw new NotFoundError('Member')
    const released = await prisma.$transaction(async (tx) => {
      await tx.projectMember.delete({
        where: { project_id_user_id: { project_id: access.project.id, user_id: data.userId } },
      })
      if (access.project.manager_id === data.userId) {
        await tx.project.update({ where: { id: access.project.id }, data: { manager_id: null } })
      }
      const { count } = await tx.taskAssignee.deleteMany({
        where: {
          user_id: data.userId,
          task: { project_id: access.project.id, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        },
      })
      return count
    })
    await auditProject(ctx, AUDIT_ACTIONS.PROJECT_MEMBER_REMOVED, access.project.id, {
      userId: data.userId,
      role: member.role,
      releasedAssignments: released,
    })
  },

  // ── Files ────────────────────────────────────────────────────────────────

  async listFiles(ctx: RequestContext, projectId: string) {
    const access = await resolveProjectAccess(ctx, parseInput(z.uuid(), projectId))
    const files = await projectRepository.listFiles(access.project.id)
    return {
      access,
      files: files.map((file) => ({
        ...file,
        canDelete: access.can.edit || file.uploaded_by === ctx.actor.userId,
      })),
    }
  },

  async uploadFile(ctx: RequestContext, projectId: string, file: UploadFile, description?: string) {
    const access = await resolveProjectAccess(ctx, parseInput(z.uuid(), projectId))
    requireCan(access, 'uploadFiles', 'You can’t upload files to this project')
    if (!file.bytes.byteLength) throw new ValidationError('Choose a file to upload', { file: 'Required' })
    const note = description?.trim().slice(0, 300) || null
    const storage = getStorageService()
    const stored = await storage.upload({
      organizationId: ctx.organization.id,
      category: 'attachment',
      fileName: file.name,
      mimeType: file.type,
      data: file.bytes,
    })
    try {
      const row = await prisma.projectAttachment.create({
        data: {
          organization_id: ctx.organization.id,
          project_id: access.project.id,
          uploaded_by: ctx.actor.userId,
          file_name: stored.fileName,
          storage_path: stored.storagePath,
          mime_type: stored.mimeType,
          file_size: stored.fileSize,
          description: note,
        },
        select: { id: true },
      })
      await auditProject(
        ctx,
        AUDIT_ACTIONS.PROJECT_FILE_UPLOADED,
        access.project.id,
        { fileName: stored.fileName },
        {
          type: 'project_file',
          id: row.id,
        },
      )
      return row
    } catch (error) {
      await storage.delete(stored.storagePath).catch(() => undefined)
      throw error
    }
  },

  /** Authorized download: project must be visible to the viewer; otherwise 404. */
  async downloadFile(ctx: RequestContext, fileId: string) {
    const id = parseInput(z.uuid(), fileId)
    const file = await projectRepository.findFileWithStorage(ctx.organization.id, id)
    if (!file) throw new NotFoundError('File')
    await resolveProjectAccess(ctx, file.project_id).catch(() => {
      throw new NotFoundError('File')
    })
    const bytes = await getStorageService().download(file.storage_path)
    return { bytes, fileName: file.file_name, mimeType: file.mime_type }
  },

  async removeFile(ctx: RequestContext, fileId: string) {
    const id = parseInput(z.uuid(), fileId)
    const file = await projectRepository.findFileWithStorage(ctx.organization.id, id)
    if (!file) throw new NotFoundError('File')
    const access = await resolveProjectAccess(ctx, file.project_id)
    if (!access.can.edit && file.uploaded_by !== ctx.actor.userId)
      throw new ForbiddenError('You can’t delete this file')
    await prisma.projectAttachment.update({ where: { id: file.id }, data: { deleted_at: new Date() } })
    await auditProject(
      ctx,
      AUDIT_ACTIONS.PROJECT_FILE_DELETED,
      file.project_id,
      { fileName: file.file_name },
      {
        type: 'project_file',
        id: file.id,
      },
    )
  },

  /** Staff who can manage a project (for the manager picker). */
  async managerOptions(ctx: RequestContext) {
    authorizationService.require(ctx, 'project.read')
    const staff = await prisma.user.findMany({
      where: { organization_id: ctx.organization.id, status: 'ACTIVE', deleted_at: null, intern: { is: null } },
      orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
      select: { id: true, first_name: true, last_name: true, display_name: true },
    })
    return staff.map((user) => ({ id: user.id, name: fullName(user) }))
  },

  capabilitiesFor: projectCapabilities,
}

export type ProjectListItem = Awaited<ReturnType<typeof projectService.list>>['items'][number]
export type ProjectOverview = Awaited<ReturnType<typeof projectService.getOverview>>
export type ProjectDirectory = Awaited<ReturnType<typeof projectService.directory>>
