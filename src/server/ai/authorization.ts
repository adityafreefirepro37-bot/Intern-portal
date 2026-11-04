import 'server-only'
import type { PermissionKey } from '@/lib/permissions'
import type { Persona } from '@/lib/ai/prompts'
import type { RequestContext } from '../context'
import { authorizationService } from '../services/authorization.service'
import type { AiSettings } from './settings.service'

/**
 * AYAVA AI authorization: user permission + tool permission + risk level +
 * feature flags. Resource access (a task, a project, an intern) is checked by
 * the domain service each tool calls — the same checks the UI relies on — so
 * the AI can never see more than the user could open themselves.
 */

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'

export interface ToolPolicy {
  /** The user needs at least one of these permissions. */
  permissions: readonly PermissionKey[]
  risk: RiskLevel
  /** Organization feature flag that must be on. */
  feature?: keyof Pick<AiSettings, 'knowledgeSearch' | 'actions' | 'documentSummary'>
}

export const aiAuthorizationService = {
  /** Throws 403 unless the user may use AYAVA AI at all. */
  requireUse(ctx: RequestContext) {
    authorizationService.require(ctx, 'ai.use')
  },

  /**
   * May this user run a tool? HIGH-risk tools never run from the AI (they
   * don't exist in the registry — this is the backstop). MEDIUM tools are
   * proposals that need confirmation and the actions feature.
   */
  allows(ctx: RequestContext, policy: ToolPolicy, settings: AiSettings): boolean {
    if (policy.risk === 'HIGH') return false
    if (policy.feature && !settings[policy.feature]) return false
    return authorizationService.canAny(ctx, policy.permissions)
  },

  /**
   * Response focus for the system prompt, derived from permissions (never role
   * names). Only changes tone and emphasis — never what data is available.
   */
  persona(ctx: RequestContext): Persona {
    const can = (key: PermissionKey) => authorizationService.can(ctx, key)
    const orgWide = (key: PermissionKey) => authorizationService.scopeOf(ctx, key) === 'ORGANIZATION'
    if (can('user.assign_role') || can('settings.update')) return 'ADMIN'
    if (orgWide('leave.approve') || can('document.verify') || orgWide('attendance.update')) return 'HR'
    if (can('project.create') || (can('intern.read') && orgWide('task.read'))) return 'MANAGER'
    if (can('task.review') || can('feedback.create')) return 'MENTOR'
    return 'INTERN'
  },
}
