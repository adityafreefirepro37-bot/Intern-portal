import type { RequestContext } from '../context'
import { auditRepository } from '../repositories/audit.repository'
import { announcementService } from './content.service'
import { authorizationService } from './authorization.service'
import { internService } from './intern.service'
import { onboardingService } from './onboarding.service'
import { projectService } from './project.service'
import { taskService } from './task.service'

export const UPCOMING_WINDOW_DAYS = 7

/**
 * Overview dashboard. Every figure comes from the database. A section is
 * `null` when the viewer lacks the permission for it, so the page renders only
 * what that person may see.
 */
export const dashboardService = {
  async getOverview(ctx: RequestContext, now = new Date()) {
    const allow = (permission: Parameters<typeof authorizationService.can>[1]) =>
      authorizationService.can(ctx, permission)
    const when = <T>(permitted: boolean, load: () => Promise<T>): Promise<T | null> =>
      permitted ? load() : Promise.resolve(null)

    const [
      activeInterns,
      openTasks,
      pendingReviews,
      upcomingDeadlineCount,
      upcomingTasks,
      taskStatus,
      projects,
      announcements,
      activity,
    ] = await Promise.all([
      when(allow('intern.read'), () => internService.countActive(ctx)),
      when(allow('task.read'), () => taskService.countOpen(ctx)),
      when(allow('task.review'), () => taskService.countPendingReviews(ctx)),
      when(allow('task.read'), () => taskService.countDueWithin(ctx, UPCOMING_WINDOW_DAYS, now)),
      when(allow('task.read'), () => taskService.listUpcoming(ctx, UPCOMING_WINDOW_DAYS, 6, now)),
      when(allow('task.read'), () => taskService.statusBreakdown(ctx)),
      when(allow('project.read'), () =>
        projectService.list(ctx, { page: 1, pageSize: 4 }, { statuses: ['ACTIVE', 'PLANNED', 'ON_HOLD'] }),
      ),
      when(allow('announcement.read'), () => announcementService.listActive(ctx, 3, now)),
      when(allow('audit_log.read'), () => auditRepository.listRecent(ctx.organization.id, 6)),
    ])

    const internship = await this.getInternship(ctx)

    return {
      // The programme section shows intern figures in more detail; don't repeat them.
      stats: { activeInterns: internship.programme ? null : activeInterns, openTasks, pendingReviews, upcomingDeadlines: upcomingDeadlineCount },
      internship,
      upcomingTasks,
      taskStatus,
      projects: projects?.items ?? null,
      announcements,
      activity,
    }
  },

  /**
   * Role-aware internship sections, decided by permissions and relationships
   * rather than role names:
   *  - programme: HR/Admin (can create interns) — organization figures
   *  - managed / mentored: anyone who is some intern's manager / mentor
   *  - self: the signed-in intern's own internship and onboarding
   */
  async getInternship(ctx: RequestContext) {
    const canProgramme = authorizationService.can(ctx, 'intern.create') && authorizationService.can(ctx, 'intern.read')
    const canOnboarding = authorizationService.can(ctx, 'onboarding.manage')
    const [programme, onboarding, relations, ownId] = await Promise.all([
      canProgramme ? internService.programmeTotals(ctx) : null,
      canProgramme && canOnboarding ? onboardingService.dashboard(ctx).then((d) => d.stats) : null,
      internService.relationCounts(ctx),
      internService.myInternId(ctx),
    ])
    const canReadInterns = authorizationService.can(ctx, 'intern.read')
    const [managed, mentored, self] = await Promise.all([
      canReadInterns && relations.managed > 0 ? internService.related(ctx, 'managed') : null,
      canReadInterns && relations.mentored > 0 ? internService.related(ctx, 'mentored') : null,
      ownId ? this.getOwnInternship(ctx, ownId) : null,
    ])
    return {
      programme: programme ? { ...programme, onboardingOverdue: onboarding?.overdue ?? null, onboardingCompletion: onboarding?.completionRate ?? null } : null,
      managed,
      mentored,
      self,
    }
  },

  async getOwnInternship(ctx: RequestContext, internId: string) {
    const profile = await internService.getProfile(ctx, internId)
    const checklist = profile.can.viewOnboarding && profile.internship?.onboarding ? await onboardingService.getChecklist(ctx, internId) : null
    return {
      id: profile.id,
      status: profile.status,
      employeeCode: profile.employeeCode,
      position: profile.position?.title ?? null,
      department: profile.department?.name ?? null,
      manager: profile.manager?.name ?? null,
      mentor: profile.mentor?.name ?? null,
      joiningDate: profile.joiningDate,
      expectedEndDate: profile.expectedEndDate,
      progress: profile.progress,
      onboarding: checklist
        ? { progress: checklist.progress, completedAt: checklist.onboarding?.completed_at ?? null }
        : null,
    }
  },
}

export type DashboardOverview = Awaited<ReturnType<typeof dashboardService.getOverview>>
