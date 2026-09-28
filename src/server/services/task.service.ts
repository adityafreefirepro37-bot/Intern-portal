import type { TaskStatus } from '@prisma/client'
import type { Pagination } from '@/lib/validation'
import type { RequestContext } from '../context'
import { taskScope } from '../repositories/scope'
import { taskRepository } from '../repositories/task.repository'
import { authorizationService } from './authorization.service'
import { skipTake, toPage } from './pagination'

/**
 * Tasks. Reads are limited to the scope of the `task.read` grant (an intern
 * sees tasks assigned to them; a mentor sees their mentees' tasks). The task
 * workflow (assign → submit → review) arrives in Prompt 04.
 */
function readScope(ctx: RequestContext) {
  return taskScope(ctx.actor, authorizationService.require(ctx, 'task.read'))
}

export const taskService = {
  async list(ctx: RequestContext, pagination: Pagination, filter: { status?: TaskStatus } = {}) {
    const [items, total] = await taskRepository.listPage(readScope(ctx), {
      ...skipTake(pagination),
      status: filter.status,
    })
    return toPage(items, total, pagination)
  },

  async countOpen(ctx: RequestContext) {
    return taskRepository.countOpen(readScope(ctx))
  },

  async countDueWithin(ctx: RequestContext, days: number, now = new Date()) {
    const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
    return taskRepository.countDueBetween(readScope(ctx), now, until)
  },

  /** Open tasks due within `days` — including overdue ones — soonest first. */
  async listUpcoming(ctx: RequestContext, days: number, take: number, now = new Date()) {
    const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
    return taskRepository.listDueBefore(readScope(ctx), until, take)
  },

  async statusBreakdown(ctx: RequestContext) {
    return taskRepository.countByStatus(readScope(ctx))
  },

  /** Submissions awaiting review within the scope of the `task.review` grant. */
  async countPendingReviews(ctx: RequestContext) {
    const scope = authorizationService.require(ctx, 'task.review')
    return taskRepository.countPendingSubmissions(taskScope(ctx.actor, scope))
  },
}

export type TaskListItem = Awaited<ReturnType<typeof taskService.list>>['items'][number]
