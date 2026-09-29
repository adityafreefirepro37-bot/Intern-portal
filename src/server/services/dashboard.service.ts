import type { RequestContext } from '../context'
import { auditRepository } from '../repositories/audit.repository'
import { announcementService } from './content.service'
import { authorizationService } from './authorization.service'
import { internService } from './intern.service'
import { projectService } from './project.service'
import { taskService } from './task.service'
import { workService } from './work.service'

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
      when(allow('task.read'), () => taskService.countDueWithin(ctx, UPCOMING_WINDOW_DAYS)),
      when(allow('task.read'), () => taskService.listUpcoming(ctx, UPCOMING_WINDOW_DAYS, 6)),
      when(allow('task.read'), () => taskService.statusBreakdown(ctx)),
      when(allow('project.read'), () =>
        projectService.list(ctx, { page: 1, pageSize: 4 }, { statuses: ['ACTIVE', 'PLANNING', 'ON_HOLD'] }),
      ),
      when(allow('announcement.read'), () => announcementService.listActive(ctx, 3, now)),
      when(allow('audit_log.read'), () => auditRepository.listRecent(ctx.organization.id, 6)),
    ])
    const work = await workService.dashboardSummary(ctx)

    return {
      stats: { activeInterns, openTasks, pendingReviews, upcomingDeadlines: upcomingDeadlineCount },
      upcomingTasks,
      taskStatus,
      projects: projects?.items ?? null,
      announcements,
      activity,
      work,
    }
  },
}

export type DashboardOverview = Awaited<ReturnType<typeof dashboardService.getOverview>>
