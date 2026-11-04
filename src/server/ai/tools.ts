import 'server-only'
import { z } from 'zod'
import type { AiContextKind, ToolName } from '@/lib/ai/router'
import { personNames } from '@/lib/ai/router'
import { compact } from '@/lib/ai/safety'
import { AppError } from '@/lib/errors'
import { logger } from '@/lib/logging'
import type { RequestContext } from '../context'
import { announcementService } from '../services/announcement.service'
import { attendanceService } from '../services/attendance.service'
import { AUDIT_ACTIONS } from '../services/audit-actions'
import { auditService } from '../services/audit.service'
import { authorizationService } from '../services/authorization.service'
import { checkinService } from '../services/checkin.service'
import { feedbackService } from '../services/feedback.service'
import { goalService } from '../services/goal.service'
import { hrDashboardService } from '../services/hr-dashboard.service'
import { internService } from '../services/intern.service'
import { learningService } from '../services/learning.service'
import { leaveService } from '../services/leave.service'
import { onboardingService } from '../services/onboarding.service'
import { performanceReviewService } from '../services/performance-review.service'
import { projectService } from '../services/project.service'
import { taskService } from '../services/task.service'
import { workService } from '../services/work.service'
import { prisma } from '@/lib/db/client'
import { aiAuthorizationService, type ToolPolicy } from './authorization'
import { knowledgeService } from './knowledge.service'
import type { AiSettings } from './settings.service'

/**
 * AYAVA AI tool registry — the only way the AI reads application data.
 *
 * Every tool: (1) runs for the authenticated RequestContext, (2) is filtered by
 * aiAuthorizationService (permission + risk + feature flag), (3) validates its
 * input with Zod, (4) calls the SAME domain service the UI uses, which enforces
 * organization isolation, scope and record access, and (5) returns compacted,
 * minimal data. There is no SQL, filesystem or arbitrary-code tool.
 */

export interface ToolInput {
  question: string
  contextType: AiContextKind
  contextId: string | null
}

export interface ToolDefinition {
  name: ToolName
  description: string
  inputSchema: z.ZodType<ToolInput>
  policy: ToolPolicy
  handler: (ctx: RequestContext, input: ToolInput) => Promise<unknown>
}

export interface ToolResult {
  name: ToolName
  ok: boolean
  data?: unknown
  /** User-safe reason when the data couldn't be read (no internals). */
  unavailable?: string
  /** Records the tool touched, for the audit trail. */
  resource?: string | null
}

const inputSchema: z.ZodType<ToolInput> = z.object({
  question: z.string().max(4000),
  contextType: z.enum(['GLOBAL', 'TASK', 'PROJECT', 'LEARNING', 'HR', 'PERFORMANCE', 'ONBOARDING', 'DOCUMENT']),
  contextId: z.uuid().nullable(),
})

const isoDay = (value: Date | null | undefined) => value?.toISOString().slice(0, 10) ?? null

/** Compact task line: what the model needs to answer "what's due / blocked". */
function taskLine(task: {
  id: string
  title: string
  status: string
  priority: string
  due_date: Date | null
  project?: { name: string } | null
  deadline?: { state: string; days: number | null }
}) {
  return {
    title: task.title,
    link: `/tasks/${task.id}`,
    status: task.status,
    priority: task.priority,
    due: isoDay(task.due_date),
    deadline: task.deadline?.state,
    project: task.project?.name,
  }
}

async function ownIntern(ctx: RequestContext) {
  return prisma.intern.findFirst({
    where: { organization_id: ctx.organization.id, user_id: ctx.actor.userId, deleted_at: null },
    select: { id: true },
  })
}

/** Builds the context block for the page the user asked from; access is checked by the domain service. */
async function contextData(ctx: RequestContext, type: AiContextKind, id: string | null): Promise<{ label: string; data: unknown } | null> {
  switch (type) {
    case 'TASK': {
      if (!id) return null
      const detail = await taskService.getDetail(ctx, id)
      const t = detail.task as unknown as Record<string, unknown> & { id: string; title: string }
      return {
        label: `Task “${t.title}”`,
        data: compact({
          task: { ...taskLine(detail.task as never), description: t.description, checklist: t.checklist, subtasks: t.subtasks },
          deadline: detail.deadline,
          progress: detail.progress,
          submissions: (detail.submissions as unknown[]).slice(0, 3),
          recentComments: (detail.comments as unknown[]).slice(-5),
          youAreAssignee: detail.isAssignee,
        }, { maxString: 1500 }),
      }
    }
    case 'PROJECT': {
      if (!id) return null
      const [overview, milestones, activity] = await Promise.all([
        projectService.getOverview(ctx, id),
        projectService.listMilestones(ctx, id),
        projectService.listActivity(ctx, id),
      ])
      const name = (overview as unknown as { project?: { name?: string } }).project?.name ?? 'Project'
      return {
        label: `Project “${name}”`,
        data: compact({ overview, milestones, recentActivity: activity.activity.slice(0, 12) }, { maxArray: 20 }),
      }
    }
    case 'LEARNING': {
      if (!id) return null
      // A lesson id (lesson page) or a course id (course page). Quiz answers are never included.
      try {
        const lesson = await learningService.lessonView(ctx, id)
        return {
          label: `Lesson “${lesson.lesson.title}” (${lesson.lesson.course.title})`,
          data: compact(
            {
              lesson: { title: lesson.lesson.title, type: lesson.lesson.content_type, module: lesson.lesson.module?.title, course: lesson.lesson.course.title },
              content: lesson.locked ? 'This lesson is locked until earlier lessons are completed.' : lesson.content,
              completed: lesson.completed,
              position: lesson.position,
            },
            { maxString: 8000 },
          ),
        }
      } catch (error) {
        if (!(error instanceof AppError) || error.status !== 404) throw error
        const course = await learningService.courseView(ctx, id)
        const title = (course as unknown as { course?: { title?: string } }).course?.title ?? 'Course'
        return { label: `Course “${title}”`, data: compact(course, { maxString: 1500 }) }
      }
    }
    case 'PERFORMANCE': {
      if (!id) return null
      const review = await performanceReviewService.get(ctx, id)
      return { label: 'Performance review', data: compact(review, { maxString: 1200, maxArray: 25 }) }
    }
    case 'ONBOARDING': {
      if (!id) return null
      const checklist = await onboardingService.getChecklist(ctx, id)
      return { label: 'Onboarding checklist', data: compact(checklist, { maxArray: 40 }) }
    }
    case 'HR':
      return null // HR data comes from getHrOverview, which checks HR permissions itself.
    case 'DOCUMENT': {
      if (!id) return null
      const { document } = await knowledgeService.get(ctx, id)
      return {
        label: `Knowledge document “${document.title}” (version ${document.version})`,
        data: {
          title: document.title,
          version: document.version,
          category: document.category,
          effectiveDate: isoDay(document.effective_date),
          updated: isoDay(document.updated_at),
          link: `/knowledge/${document.id}`,
          // The document text is untrusted content: the prompt builder fences it.
          untrustedText: (document.content ?? '').slice(0, 24_000),
        },
      }
    }
    default:
      return null
  }
}

const READ = (permissions: ToolPolicy['permissions'], feature?: ToolPolicy['feature']): ToolPolicy => ({ permissions, risk: 'LOW', feature })

export const TOOLS: Record<ToolName, ToolDefinition> = {
  getContext: {
    name: 'getContext',
    description: 'The record the user is looking at (task, project, lesson, review, onboarding checklist or document).',
    inputSchema,
    policy: READ(['ai.use']),
    handler: async (ctx, input) => contextData(ctx, input.contextType, input.contextId),
  },
  getMyWork: {
    name: 'getMyWork',
    description: 'The user’s tasks: due today, overdue, in progress, in review, blocked, upcoming (7 days), recently completed, milestones.',
    inputSchema,
    policy: READ(['task.read']),
    handler: async (ctx) => {
      const work = await workService.myWork(ctx)
      if (!work) return null
      const lines = (rows: Parameters<typeof taskLine>[0][]) => rows.slice(0, 12).map(taskLine)
      return {
        dueToday: lines(work.dueToday),
        overdue: lines(work.overdue),
        inProgress: lines(work.inProgress),
        waitingToStart: lines(work.waitingForMe),
        inReview: lines(work.awaitingReview),
        blocked: lines(work.blocked),
        upcoming7Days: lines(work.upcoming),
        completedLast14Days: lines(work.recentlyCompleted),
        milestonesNext14Days: work.milestones.map((m) => ({ name: m.name, due: isoDay(m.due_date), project: m.project.name, link: `/projects/${m.project.id}` })),
      }
    },
  },
  getPendingReviews: {
    name: 'getPendingReviews',
    description: 'Submissions waiting for the user’s review (within their review scope).',
    inputSchema,
    policy: READ(['task.review']),
    handler: async (ctx) => {
      const work = await workService.myWork(ctx)
      return { toReview: (work?.toReview ?? []).slice(0, 15).map((t) => ({ ...taskLine(t), assignees: t.assignees.map((a) => a.user.display_name ?? `${a.user.first_name} ${a.user.last_name}`) })) }
    },
  },
  getMyProjects: {
    name: 'getMyProjects',
    description: 'Projects the user can see (status, progress, dates).',
    inputSchema,
    policy: READ(['project.read']),
    handler: async (ctx) => {
      const page = await projectService.list(ctx, { page: 1, pageSize: 12 }, { statuses: ['PLANNING', 'ACTIVE', 'ON_HOLD'] })
      return compact(page.items.map((p) => ({ ...(p as object), link: `/projects/${(p as { id: string }).id}` })))
    },
  },
  getMyLearning: {
    name: 'getMyLearning',
    description: 'The user’s learning: required, assigned and self-enrolled courses, progress, due dates, plans and recommendations.',
    inputSchema,
    policy: READ(['course.read']),
    handler: async (ctx) => compact(await learningService.hub(ctx), { maxArray: 12 }),
  },
  getMyGoals: {
    name: 'getMyGoals',
    description: 'Performance goals (the user’s own; for staff, goals of interns in their scope).',
    inputSchema,
    policy: READ(['goal.read']),
    handler: async (ctx) => {
      const own = await ownIntern(ctx)
      return compact(await goalService.list(ctx, own ? { internId: own.id } : {}), { maxArray: 15 })
    },
  },
  getMyFeedback: {
    name: 'getMyFeedback',
    description: 'Feedback the user can see (received, and given for staff) and open feedback requests.',
    inputSchema,
    policy: READ(['feedback.read']),
    handler: async (ctx) => {
      const page = await feedbackService.page(ctx, {})
      return compact({ view: page.view, feedback: page.feedback.slice(0, 15), requests: page.requests }, { maxString: 800 })
    },
  },
  getMyCheckins: {
    name: 'getMyCheckins',
    description: 'Weekly check-ins (the user’s own, or those of interns in scope).',
    inputSchema,
    policy: READ(['checkin.read']),
    handler: async (ctx) => {
      const own = await ownIntern(ctx)
      return compact(own ? await checkinService.mine(ctx) : await checkinService.list(ctx, {}), { maxArray: 10 })
    },
  },
  getMyLeave: {
    name: 'getMyLeave',
    description: 'The user’s leave requests, statuses and balances.',
    inputSchema,
    policy: READ(['leave.read']),
    handler: async (ctx) => compact(await leaveService.mine(ctx), { maxArray: 12 }),
  },
  getMyAttendance: {
    name: 'getMyAttendance',
    description: 'The user’s attendance today and this month.',
    inputSchema,
    policy: READ(['attendance.read']),
    handler: async (ctx) => {
      const [today, month] = await Promise.all([attendanceService.today(ctx), attendanceService.month(ctx, {})])
      return compact({ today, month }, { maxArray: 31 })
    },
  },
  getOnboardingStatus: {
    name: 'getOnboardingStatus',
    description: 'The user’s own onboarding checklist, or onboarding progress for staff who oversee it.',
    inputSchema,
    policy: READ(['onboarding.read']),
    handler: async (ctx) => {
      const own = await ownIntern(ctx)
      if (own) return compact(await onboardingService.getChecklist(ctx, own.id), { maxArray: 40 })
      return compact(await onboardingService.dashboard(ctx), { maxArray: 15 })
    },
  },
  getAnnouncements: {
    name: 'getAnnouncements',
    description: 'Current announcements addressed to the user.',
    inputSchema,
    policy: READ(['announcement.read']),
    handler: async (ctx) => compact(await announcementService.listActive(ctx, 5), { maxString: 500 }),
  },
  getTeamOverview: {
    name: 'getTeamOverview',
    description: 'Interns the user manages or mentors, with their status and work summary.',
    inputSchema,
    policy: READ(['intern.read']),
    handler: async (ctx) => {
      const [managed, mentored, team] = await Promise.all([
        internService.related(ctx, 'managed'),
        internService.related(ctx, 'mentored'),
        workService.dashboardSummary(ctx),
      ])
      return compact({ managed, mentored, teamWork: team?.team ?? null, workload: team?.workload ?? null }, { maxArray: 20 })
    },
  },
  findPeopleWork: {
    name: 'findPeopleWork',
    description: 'Work of interns the user names in the question — only interns within the user’s own access scope.',
    inputSchema,
    policy: READ(['intern.read']),
    handler: async (ctx, input) => {
      const names = personNames(input.question)
      if (!names.length) return null
      const found: unknown[] = []
      for (const name of names) {
        if (name.length < 2) continue
        const page = await internService.directory(ctx, { q: name, pageSize: '25' })
        for (const intern of page.page.items.slice(0, 2)) {
          const id = (intern as { id: string }).id
          const work = await internService.work(ctx, id).catch(() => null)
          found.push(compact({ intern, link: `/interns/${id}`, work }, { maxArray: 10 }))
        }
      }
      // No match means "not found or not accessible" — the tool never says which.
      return { requestedNames: names, interns: found }
    },
  },
  getHrOverview: {
    name: 'getHrOverview',
    description: 'HR operations: onboarding completion, documents to verify, attendance corrections, leave and HR requests awaiting action.',
    inputSchema,
    policy: READ(['hr_dashboard.read']),
    handler: async (ctx) => {
      const [overview, onboarding] = await Promise.all([
        hrDashboardService.overview(ctx),
        authorizationService.can(ctx, 'onboarding.read') ? onboardingService.dashboard(ctx).catch(() => null) : Promise.resolve(null),
      ])
      return compact({ overview, onboarding }, { maxArray: 15 })
    },
  },
  searchKnowledge: {
    name: 'searchKnowledge',
    description: 'Company knowledge base (policies, handbooks, SOPs) — only documents the user may read.',
    inputSchema,
    policy: READ(['knowledge.read'], 'knowledgeSearch'),
    // Retrieval runs in the chat pipeline (its chunks become numbered sources).
    handler: async () => null,
  },
}

export interface ToolRun {
  results: ToolResult[]
  /** Tools skipped because the user lacks permission (named so the model can say so). */
  denied: ToolName[]
}

/**
 * Runs the routed tools that this user may use. Errors become "unavailable"
 * (404/403 never reveal whether a record exists). Every call is audited.
 */
export async function runTools(ctx: RequestContext, names: ToolName[], input: ToolInput, settings: AiSettings): Promise<ToolRun> {
  const parsed = inputSchema.parse(input)
  const denied: ToolName[] = []
  const allowed = names.filter((name) => {
    const tool = TOOLS[name]
    if (!tool) return false
    const ok = aiAuthorizationService.allows(ctx, tool.policy, settings)
    if (!ok) denied.push(name)
    return ok && name !== 'searchKnowledge'
  })
  const results = await Promise.all(
    allowed.map(async (name): Promise<ToolResult> => {
      const tool = TOOLS[name]
      const resource = name === 'getContext' ? parsed.contextId : null
      try {
        const data = await tool.handler(ctx, tool.inputSchema.parse(parsed))
        return { name, ok: true, data, resource }
      } catch (error) {
        const status = error instanceof AppError ? error.status : 500
        if (status >= 500) logger.error('AI tool failed', { tool: name, error })
        return {
          name,
          ok: false,
          resource,
          unavailable: status === 403 || status === 404 ? 'not available with your access' : 'could not be loaded right now',
        }
      }
    }),
  )
  await Promise.all(
    results.map((r) =>
      auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.AI_TOOL_CALLED,
        resourceType: 'ai_tool',
        resourceId: r.resource ?? null,
        status: r.ok ? 'SUCCESS' : 'FAILURE',
        metadata: { tool: r.name, contextType: parsed.contextType },
      }),
    ),
  )
  return { results, denied }
}
