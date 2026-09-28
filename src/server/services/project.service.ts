import type { ProjectStatus } from '@prisma/client'
import { percent } from '@/lib/utils/format'
import type { Pagination } from '@/lib/validation'
import type { RequestContext } from '../context'
import { projectRepository } from '../repositories/project.repository'
import { projectScope } from '../repositories/scope'
import { authorizationService } from './authorization.service'
import { skipTake, toPage } from './pagination'

/**
 * Projects, limited to the scope of the `project.read` grant (interns and
 * mentors see projects they or their interns belong to). Creation,
 * membership and milestones arrive in Prompt 04.
 */
export const projectService = {
  async list(ctx: RequestContext, pagination: Pagination, filter: { statuses?: ProjectStatus[] } = {}) {
    const scope = authorizationService.require(ctx, 'project.read')
    const [projects, total] = await projectRepository.listPage(projectScope(ctx.actor, scope), {
      ...skipTake(pagination),
      statuses: filter.statuses,
    })
    const progress = await projectRepository.taskProgress(
      ctx.organization.id,
      projects.map((project) => project.id),
    )
    const items = projects.map((project) => {
      const counts = progress.get(project.id) ?? { total: 0, completed: 0 }
      return {
        ...project,
        taskCount: counts.total,
        completedTaskCount: counts.completed,
        progressPercent: percent(counts.completed, counts.total),
      }
    })
    return toPage(items, total, pagination)
  },
}

export type ProjectListItem = Awaited<ReturnType<typeof projectService.list>>['items'][number]
