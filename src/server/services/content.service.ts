import type { RequestContext } from '../context'
import { courseRepository, organizationStructureRepository } from '../repositories/content.repository'
import { authorizationService } from './authorization.service'

/** Learning catalog (course authoring and progress tracking arrive in Prompt 05). */
export const learningService = {
  async listCourses(ctx: RequestContext) {
    authorizationService.require(ctx, 'course.read')
    const courses = await courseRepository.list(ctx.organization.id)
    return courses.map(({ lessons, ...course }) => ({
      ...course,
      lessonCount: lessons.length,
      estimatedMinutes: lessons.reduce((sum, lesson) => sum + (lesson.estimated_minutes ?? 0), 0),
    }))
  },
}

/** Announcements moved to announcement.service.ts (targeting, scheduling, publishing). */
export { announcementService } from './announcement.service'

/** Department options for filters. Managing departments, teams and positions: organization-structure.service.ts. */
export const organizationService = {
  async listDepartments(ctx: RequestContext) {
    authorizationService.require(ctx, 'department.read')
    return organizationStructureRepository.listDepartments(ctx.organization.id)
  },
}
