import type { PermissionKey } from '@/lib/permissions'
import { fullName, humanizeEnum } from '@/lib/utils/format'
import type { RequestContext } from '../context'
import { announcementRepository, courseRepository } from '../repositories/content.repository'
import { internRepository } from '../repositories/intern.repository'
import { projectRepository } from '../repositories/project.repository'
import { taskRepository } from '../repositories/task.repository'
import { internScope, projectScope, taskScope } from '../repositories/scope'
import { authorizationService } from './authorization.service'
import { feedbackService } from './feedback.service'
import { goalService } from './goal.service'
import { learningService } from './learning.service'
import { performanceReviewService } from './performance-review.service'

/**
 * Global search.
 *
 * Search is assembled from providers, one per entity type. Each provider
 * declares the permission it needs and only runs for users who hold it, and
 * every provider queries within the caller's organization. Phase 01 providers
 * do simple case-insensitive matching; ranking, full-text search and document
 * content search can replace a provider without touching callers or the UI.
 */
export type SearchEntityType =
  | 'intern'
  | 'task'
  | 'project'
  | 'milestone'
  | 'course'
  | 'learning_path'
  | 'goal'
  | 'review'
  | 'feedback'
  | 'announcement'
  | 'document'

export interface SearchResult {
  id: string
  type: SearchEntityType
  title: string
  subtitle?: string
  href: string
}

export interface SearchProvider {
  type: SearchEntityType
  label: string
  permission: PermissionKey
  search(ctx: RequestContext, term: string, limit: number): Promise<SearchResult[]>
}

export interface SearchGroup {
  type: SearchEntityType
  label: string
  results: SearchResult[]
}

const providers: SearchProvider[] = [
  {
    type: 'intern',
    label: 'Interns',
    permission: 'intern.read',
    async search(ctx, term, limit) {
      const scope = authorizationService.require(ctx, 'intern.read')
      const rows = await internRepository.search(internScope(ctx.actor, scope), term, limit)
      return rows.map((row) => ({
        id: row.id,
        type: 'intern',
        title: fullName(row.user),
        subtitle: [row.employee_code, row.position?.title].filter(Boolean).join(' · '),
        href: `/interns/${row.id}`,
      }))
    },
  },
  {
    type: 'task',
    label: 'Tasks',
    permission: 'task.read',
    async search(ctx, term, limit) {
      const scope = authorizationService.require(ctx, 'task.read')
      const rows = await taskRepository.search(taskScope(ctx.actor, scope), term, limit)
      return rows.map((row) => ({
        id: row.id,
        type: 'task',
        title: row.title,
        subtitle: [row.project?.name, humanizeEnum(row.status)].filter(Boolean).join(' · '),
        href: `/tasks/${row.id}`,
      }))
    },
  },
  {
    type: 'project',
    label: 'Projects',
    permission: 'project.read',
    async search(ctx, term, limit) {
      const scope = authorizationService.require(ctx, 'project.read')
      const rows = await projectRepository.search(projectScope(ctx.actor, scope), term, limit)
      return rows.map((row) => ({
        id: row.id,
        type: 'project',
        title: row.name,
        subtitle: humanizeEnum(row.status),
        href: `/projects/${row.id}`,
      }))
    },
  },
  {
    type: 'milestone',
    label: 'Milestones',
    permission: 'project.read',
    async search(ctx, term, limit) {
      const scope = authorizationService.require(ctx, 'project.read')
      const rows = await projectRepository.searchMilestones(projectScope(ctx.actor, scope), term, limit)
      return rows.map((row) => ({
        id: row.id,
        type: 'milestone',
        title: row.name,
        subtitle: [row.project.name, humanizeEnum(row.status)].join(' · '),
        href: `/projects/${row.project.id}/milestones`,
      }))
    },
  },
  {
    type: 'course',
    label: 'Courses',
    permission: 'course.read',
    async search(ctx, term, limit) {
      const rows = await courseRepository.search(ctx.organization.id, term, limit)
      return rows.map((row) => ({
        id: row.id,
        type: 'course',
        title: row.title,
        href: `/learning/courses/${row.id}`,
      }))
    },
  },
  {
    type: 'learning_path',
    label: 'Learning paths',
    permission: 'learning_path.read',
    async search(ctx, term, limit) {
      const rows = await learningService.searchPaths(ctx, term, limit)
      return rows.map((row) => ({
        id: row.id,
        type: 'learning_path',
        title: row.name,
        subtitle: row.status === 'PUBLISHED' ? undefined : humanizeEnum(row.status),
        href: `/learning/paths/${row.id}`,
      }))
    },
  },
  {
    type: 'goal',
    label: 'Goals',
    permission: 'goal.read',
    async search(ctx, term, limit) {
      const rows = await goalService.search(ctx, term, limit)
      return rows.map((row) => ({
        id: row.id,
        type: 'goal',
        title: row.title,
        subtitle: [fullName(row.intern.user), humanizeEnum(row.status)].join(' · '),
        href: `/performance/goals/${row.id}`,
      }))
    },
  },
  {
    type: 'review',
    label: 'Performance reviews',
    permission: 'performance.read',
    async search(ctx, term, limit) {
      const rows = await performanceReviewService.search(ctx, term, limit)
      return rows.map((row) => ({
        id: row.id,
        type: 'review',
        title: `${fullName(row.intern.user)} — ${row.cycle?.name ?? 'Review'}`,
        subtitle: humanizeEnum(row.status),
        href: `/performance/reviews/${row.id}`,
      }))
    },
  },
  {
    type: 'feedback',
    label: 'Feedback',
    permission: 'feedback.read',
    async search(ctx, term, limit) {
      const rows = await feedbackService.search(ctx, term, limit)
      return rows.map((row) => ({
        id: row.id,
        type: 'feedback',
        title: row.body.length > 80 ? `${row.body.slice(0, 80)}…` : row.body,
        subtitle: `${fullName(row.from_user)} → ${fullName(row.to_user)}`,
        href: `/performance/feedback?view=${row.to_user_id === ctx.actor.userId ? 'received' : row.from_user_id === ctx.actor.userId ? 'given' : 'interns'}&highlight=${row.id}`,
      }))
    },
  },
  {
    type: 'announcement',
    label: 'Announcements',
    permission: 'announcement.read',
    async search(ctx, term, limit) {
      const rows = await announcementRepository.search(ctx.organization.id, term, new Date(), limit)
      return rows.map((row) => ({
        id: row.id,
        type: 'announcement',
        title: row.title,
        href: `/announcements?highlight=${row.id}`,
      }))
    },
  },
  // Documents join in Prompt 05 once document storage and visibility rules exist.
]

export const searchService = {
  async search(ctx: RequestContext, term: string, limitPerType = 5): Promise<SearchGroup[]> {
    const allowed = providers.filter((provider) => authorizationService.can(ctx, provider.permission))
    const groups = await Promise.all(
      allowed.map(async (provider) => ({
        type: provider.type,
        label: provider.label,
        results: await provider.search(ctx, term, limitPerType),
      })),
    )
    return groups.filter((group) => group.results.length > 0)
  },
}
