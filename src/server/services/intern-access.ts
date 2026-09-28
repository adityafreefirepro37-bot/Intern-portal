import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { scopeRank, type PermissionKey, type PermissionScope } from '@/lib/permissions'
import type { RequestContext } from '../context'
import { internRepository, type InternRecord } from '../repositories/intern.repository'
import { internScope } from '../repositories/scope'

/**
 * How the current viewer relates to one intern, and what they may see or do.
 *
 * Access to an intern record comes from `intern.read` (staff) or, for the
 * intern themself, `intern_profile.read` with OWN scope. Everything else —
 * contact details, personal data, editing — is derived here, once, so pages
 * and services apply identical rules.
 */
export interface InternAccess {
  record: InternRecord
  isSelf: boolean
  isManager: boolean
  isMentor: boolean
  /** Organization-wide people access (HR/Admin). */
  orgWide: boolean
  can: {
    seeContact: boolean
    seePersonal: boolean
    seeSensitive: boolean
    editDetails: boolean
    editSelfProfile: boolean
    assignPeople: boolean
    transition: boolean
    close: boolean
    manageOnboarding: boolean
    viewOnboarding: boolean
    viewDocuments: boolean
    uploadDocuments: boolean
    deleteDocuments: boolean
    viewActivity: boolean
  }
}

function wider(a: PermissionScope | null, b: PermissionScope | null): PermissionScope | null {
  if (!a) return b
  if (!b) return a
  return scopeRank(a) >= scopeRank(b) ? a : b
}

/** Does `permission`'s scope cover this intern? (Pure, from placement facts.) */
export function scopeCovers(
  ctx: RequestContext,
  permission: PermissionKey,
  record: Pick<InternRecord, 'user_id' | 'manager_id' | 'mentor_id' | 'team_id' | 'department_id' | 'organization_id'>,
): boolean {
  const scope = ctx.actor.permissions.get(permission)
  if (!scope || record.organization_id !== ctx.organization.id) return false
  const rank = scopeRank(scope)
  if (rank >= scopeRank('ORGANIZATION')) return true
  if (rank >= scopeRank('DEPARTMENT') && record.department_id && ctx.actor.headedDepartmentIds.includes(record.department_id)) return true
  if (rank >= scopeRank('TEAM') && record.team_id && ctx.actor.ledTeamIds.includes(record.team_id)) return true
  if (rank >= scopeRank('ASSIGNED') && (record.manager_id === ctx.actor.userId || record.mentor_id === ctx.actor.userId)) return true
  return record.user_id === ctx.actor.userId
}

export async function resolveInternAccess(ctx: RequestContext, internId: string): Promise<InternAccess> {
  const readScope = wider(ctx.actor.permissions.get('intern.read') ?? null, ctx.actor.permissions.get('intern_profile.read') ?? null)
  if (!readScope) throw new ForbiddenError()
  const record = await internRepository.findInScope(internScope(ctx.actor, readScope), internId)
  // Out of scope or another organization: indistinguishable from missing.
  if (!record) throw new NotFoundError('Intern')

  const covers = (permission: PermissionKey) => scopeCovers(ctx, permission, record)
  const isSelf = record.user_id === ctx.actor.userId
  const orgWide = ctx.actor.permissions.get('intern.read') === 'ORGANIZATION'
  const profileOrgWide = ctx.actor.permissions.get('intern_profile.read') === 'ORGANIZATION'

  return {
    record,
    isSelf,
    isManager: record.manager_id === ctx.actor.userId,
    isMentor: record.mentor_id === ctx.actor.userId,
    orgWide,
    can: {
      seeContact: isSelf || profileOrgWide,
      seePersonal: isSelf || covers('intern_profile.read'),
      seeSensitive: isSelf || profileOrgWide,
      editDetails: !isSelf && covers('intern.update'),
      editSelfProfile: isSelf && covers('intern_profile.update'),
      assignPeople: !isSelf && covers('intern.update'),
      transition: !isSelf && covers('internship.update'),
      close: !isSelf && covers('internship.complete'),
      manageOnboarding: !isSelf && covers('onboarding.manage'),
      viewOnboarding: covers('onboarding.read'),
      viewDocuments: covers('document.read'),
      uploadDocuments: covers('document.upload'),
      deleteDocuments: !isSelf && covers('document.delete'),
      viewActivity: !isSelf && covers('intern.read'),
    },
  }
}
