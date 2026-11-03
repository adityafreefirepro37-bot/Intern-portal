import { z } from 'zod'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import type { PermissionKey } from '@/lib/permissions'
import { slugify } from '@/lib/utils/format'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { organizationStructureRepository as structure } from '../repositories/content.repository'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { optionalText, optionalUuid } from './hr-shared'

/**
 * Departments, teams and positions: the organization's structure.
 *
 * Nothing is deleted — interns, internships, onboarding templates, learning
 * paths and review cycles refer to these records — so "delete" archives
 * (is_active = false) and can be undone. Archived records drop out of every
 * picker. Archiving is refused while current interns (or, for a department,
 * active teams) still depend on the record.
 *
 * Department heads and team leads gain DEPARTMENT / TEAM-scoped access
 * (src/server/repositories/scope.ts), so they must be active members of the
 * organization and every change is audited with before/after values.
 */

type Kind = 'department' | 'team' | 'position'

const name = (label: string) => z.string().trim().min(2, `Enter a ${label}`).max(120)

const departmentSchema = z.strictObject({
  departmentId: optionalUuid,
  name: name('name'),
  description: optionalText(500),
  headUserId: optionalUuid,
})

const teamSchema = z.strictObject({
  teamId: optionalUuid,
  name: name('name'),
  description: optionalText(500),
  departmentId: optionalUuid,
  leadUserId: optionalUuid,
})

const positionSchema = z.strictObject({
  positionId: optionalUuid,
  title: name('title'),
  description: optionalText(500),
  departmentId: optionalUuid,
})

const activeSchema = z.strictObject({
  id: z.uuid(),
  active: z.enum(['true', 'false']).transform((value) => value === 'true'),
})

const PERMISSIONS: Record<Kind, { create: PermissionKey; update: PermissionKey; archive: PermissionKey }> = {
  department: { create: 'department.create', update: 'department.update', archive: 'department.delete' },
  team: { create: 'team.create', update: 'team.update', archive: 'team.delete' },
  position: { create: 'position.manage', update: 'position.manage', archive: 'position.manage' },
}

const LABEL: Record<Kind, string> = { department: 'Department', team: 'Team', position: 'Position' }

/** A slug for a new record: from the name, made unique within the organization. */
async function uniqueSlug(kind: Kind, organizationId: string, value: string) {
  const base = slugify(value) || kind
  const taken = await structure.slugsLike(kind, organizationId, base)
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`
}

async function assertNameFree(kind: Kind, ctx: RequestContext, value: string, excludeId?: string) {
  const clash = await structure.nameTaken(kind, ctx.organization.id, value, excludeId)
  if (!clash) return
  const field = kind === 'position' ? 'title' : 'name'
  const message = clash.archived
    ? `An archived ${kind} is already called “${value}”. Restore it instead.`
    : `A ${kind} called “${value}” already exists.`
  throw new ValidationError(message, { [field]: message })
}

async function assertMember(ctx: RequestContext, userId: string | undefined, field: string) {
  if (userId && !(await structure.isActiveMember(ctx.organization.id, userId))) {
    throw new ValidationError('Choose an active member of the organization', { [field]: 'Choose an active member' })
  }
}

async function assertDepartment(ctx: RequestContext, departmentId: string | undefined) {
  if (!departmentId) return
  const department = await structure.findDepartment(ctx.organization.id, departmentId)
  if (!department || !department.is_active) {
    throw new ValidationError('Choose an active department', { departmentId: 'Choose an active department' })
  }
}

export const organizationStructureService = {
  /** The structure editor: every department, team and position (archived too) and the people to choose from. */
  async manage(ctx: RequestContext) {
    authorizationService.require(ctx, 'team.read')
    const can = {
      department: {
        create: authorizationService.can(ctx, 'department.create'),
        update: authorizationService.can(ctx, 'department.update'),
        archive: authorizationService.can(ctx, 'department.delete'),
      },
      team: {
        create: authorizationService.can(ctx, 'team.create'),
        update: authorizationService.can(ctx, 'team.update'),
        archive: authorizationService.can(ctx, 'team.delete'),
      },
      position: { manage: authorizationService.can(ctx, 'position.manage') },
    }
    const editsLeaders = can.department.create || can.department.update || can.team.create || can.team.update
    const [[departments, unassignedTeams, unassignedPositions], members] = await Promise.all([
      structure.managementView(ctx.organization.id),
      editsLeaders ? structure.activeMembers(ctx.organization.id) : Promise.resolve([]),
    ])
    return { departments, unassignedTeams, unassignedPositions, members, can }
  },

  async saveDepartment(ctx: RequestContext, input: unknown) {
    const data = parseInput(departmentSchema, input)
    authorizationService.require(ctx, data.departmentId ? PERMISSIONS.department.update : PERMISSIONS.department.create)
    const org = ctx.organization.id
    const existing = data.departmentId ? await structure.findDepartment(org, data.departmentId) : null
    if (data.departmentId && !existing) throw new NotFoundError('Department')
    await assertNameFree('department', ctx, data.name, existing?.id)
    await assertMember(ctx, data.headUserId, 'headUserId')

    const values = { name: data.name, description: data.description ?? null, head_user_id: data.headUserId ?? null }
    const { id } = existing
      ? await structure.updateDepartment(existing.id, values)
      : await structure.createDepartment({ ...values, organization_id: org, slug: await uniqueSlug('department', org, data.name) })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.DEPARTMENT_SAVED,
      resourceType: 'department',
      resourceId: id,
      metadata: {
        before: existing && { name: existing.name, headUserId: existing.head_user_id },
        after: { name: values.name, headUserId: values.head_user_id },
      },
    })
    return { id }
  },

  async saveTeam(ctx: RequestContext, input: unknown) {
    const data = parseInput(teamSchema, input)
    authorizationService.require(ctx, data.teamId ? PERMISSIONS.team.update : PERMISSIONS.team.create)
    const org = ctx.organization.id
    const existing = data.teamId ? await structure.findTeam(org, data.teamId) : null
    if (data.teamId && !existing) throw new NotFoundError('Team')
    await assertNameFree('team', ctx, data.name, existing?.id)
    // Keeping a team in its (now archived) department is allowed; moving it there is not.
    if (data.departmentId !== existing?.department_id) await assertDepartment(ctx, data.departmentId)
    await assertMember(ctx, data.leadUserId, 'leadUserId')

    const values = {
      name: data.name,
      description: data.description ?? null,
      department_id: data.departmentId ?? null,
      team_lead_id: data.leadUserId ?? null,
    }
    const { id } = existing
      ? await structure.updateTeam(existing.id, values)
      : await structure.createTeam({ ...values, organization_id: org, slug: await uniqueSlug('team', org, data.name) })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.TEAM_SAVED,
      resourceType: 'team',
      resourceId: id,
      metadata: {
        before: existing && {
          name: existing.name,
          departmentId: existing.department_id,
          leadUserId: existing.team_lead_id,
        },
        after: { name: values.name, departmentId: values.department_id, leadUserId: values.team_lead_id },
      },
    })
    return { id }
  },

  async savePosition(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, PERMISSIONS.position.update)
    const data = parseInput(positionSchema, input)
    const org = ctx.organization.id
    const existing = data.positionId ? await structure.findPosition(org, data.positionId) : null
    if (data.positionId && !existing) throw new NotFoundError('Position')
    await assertNameFree('position', ctx, data.title, existing?.id)
    if (data.departmentId !== existing?.department_id) await assertDepartment(ctx, data.departmentId)

    const values = { title: data.title, description: data.description ?? null, department_id: data.departmentId ?? null }
    const { id } = existing
      ? await structure.updatePosition(existing.id, values)
      : await structure.createPosition({ ...values, organization_id: org, slug: await uniqueSlug('position', org, data.title) })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.POSITION_SAVED,
      resourceType: 'position',
      resourceId: id,
      metadata: {
        before: existing && { title: existing.title, departmentId: existing.department_id },
        after: { title: values.title, departmentId: values.department_id },
      },
    })
    return { id }
  },

  /** Archives (active = false) or restores a department, team or position. */
  async setActive(ctx: RequestContext, kind: Kind, input: unknown) {
    authorizationService.require(ctx, PERMISSIONS[kind].archive)
    const { id, active } = parseInput(activeSchema, input)
    const org = ctx.organization.id
    const record =
      kind === 'department'
        ? await structure.findDepartment(org, id)
        : kind === 'team'
          ? await structure.findTeam(org, id)
          : await structure.findPosition(org, id)
    if (!record) throw new NotFoundError(LABEL[kind])
    if (record.is_active === active) return { id, active }

    if (!active) {
      const { interns, teams } = await structure.dependents(kind, id)
      if (interns || teams) {
        const blockers = [
          interns && `${interns} current intern${interns === 1 ? '' : 's'}`,
          teams && `${teams} active team${teams === 1 ? '' : 's'}`,
        ].filter(Boolean)
        throw new ConflictError(`Move its ${blockers.join(' and ')} elsewhere before archiving this ${kind}.`)
      }
    } else if (kind !== 'department' && 'department_id' in record && record.department_id) {
      // A team or position comes back only into an active department.
      const department = await structure.findDepartment(org, record.department_id)
      if (!department?.is_active) {
        throw new ConflictError(`Restore its department first, or move this ${kind} to another department.`)
      }
    }

    if (kind === 'department') await structure.updateDepartment(id, { is_active: active })
    else if (kind === 'team') await structure.updateTeam(id, { is_active: active })
    else await structure.updatePosition(id, { is_active: active })

    const actions = {
      department: [AUDIT_ACTIONS.DEPARTMENT_ARCHIVED, AUDIT_ACTIONS.DEPARTMENT_RESTORED],
      team: [AUDIT_ACTIONS.TEAM_ARCHIVED, AUDIT_ACTIONS.TEAM_RESTORED],
      position: [AUDIT_ACTIONS.POSITION_ARCHIVED, AUDIT_ACTIONS.POSITION_RESTORED],
    } as const
    await auditService.logForContext(ctx, {
      action: actions[kind][active ? 1 : 0],
      resourceType: kind,
      resourceId: id,
      metadata: { name: 'title' in record ? record.title : record.name },
    })
    return { id, active }
  },
}

export type StructureView = Awaited<ReturnType<typeof organizationStructureService.manage>>
