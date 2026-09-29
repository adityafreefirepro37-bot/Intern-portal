import { prisma } from '@/lib/db/client'
import { addDays, todayIn } from '@/lib/interns/dates'
import { ACTIVE_WORK_STATUSES } from '@/lib/work/tasks'
import { workloadLevel, type WorkloadLevel } from '@/lib/work/workload'
import type { RequestContext } from '../context'

export interface WorkloadRow {
  user: { id: string; first_name: string; last_name: string; display_name: string | null; avatar_url: string | null }
  active: number
  overdue: number
  dueThisWeek: number
  inReview: number
  hoursThisWeek: number
  level: WorkloadLevel
}

/**
 * Workload per person using the transparent rules in src/lib/work/workload.ts.
 * Callers pass the people to include (already authorized: project members,
 * or the viewer's own interns). One query loads the open assignments; the
 * figures are computed in memory — no per-person queries.
 */
export const workloadService = {
  async forUsers(ctx: RequestContext, userIds: string[], options: { projectId?: string } = {}): Promise<WorkloadRow[]> {
    const ids = [...new Set(userIds)]
    if (ids.length === 0) return []
    const today = todayIn(ctx.organization.timezone)
    const weekEnd = addDays(today, 6)
    const [users, assignments] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: ids }, organization_id: ctx.organization.id, deleted_at: null },
        select: { id: true, first_name: true, last_name: true, display_name: true, avatar_url: true },
      }),
      prisma.taskAssignee.findMany({
        where: {
          user_id: { in: ids },
          task: {
            organization_id: ctx.organization.id,
            deleted_at: null,
            status: { in: [...ACTIVE_WORK_STATUSES, 'IN_REVIEW'] },
            ...(options.projectId ? { project_id: options.projectId } : {}),
          },
        },
        select: {
          user_id: true,
          task: {
            select: { status: true, due_date: true, estimated_minutes: true, _count: { select: { assignees: true } } },
          },
        },
      }),
    ])
    const rows = new Map<string, Omit<WorkloadRow, 'level' | 'user'>>()
    for (const id of ids) rows.set(id, { active: 0, overdue: 0, dueThisWeek: 0, inReview: 0, hoursThisWeek: 0 })
    for (const { user_id, task } of assignments) {
      const row = rows.get(user_id)!
      const due = task.due_date
      const overdue = due !== null && due < today
      if (overdue) row.overdue += 1
      if (task.status === 'IN_REVIEW') {
        row.inReview += 1
        continue
      }
      row.active += 1
      const dueSoon = due !== null && due <= weekEnd
      if (due && due >= today && due <= weekEnd) row.dueThisWeek += 1
      if (dueSoon && task.estimated_minutes) {
        row.hoursThisWeek += task.estimated_minutes / 60 / Math.max(1, task._count.assignees)
      }
    }
    return users
      .map((user) => {
        const row = rows.get(user.id)!
        const hoursThisWeek = Math.round(row.hoursThisWeek * 10) / 10
        return { user, ...row, hoursThisWeek, level: workloadLevel({ ...row, hoursThisWeek }) }
      })
      .sort((a, b) => b.active + b.overdue * 2 - (a.active + a.overdue * 2))
  },

  /** Interns the viewer manages or mentors (the "team" for workload views). */
  async forMyInterns(ctx: RequestContext) {
    const interns = await prisma.intern.findMany({
      where: {
        organization_id: ctx.organization.id,
        deleted_at: null,
        status: { in: ['ONBOARDING', 'ACTIVE', 'ENDING_SOON'] },
        OR: [{ manager_id: ctx.actor.userId }, { mentor_id: ctx.actor.userId }],
      },
      select: { user_id: true },
    })
    return this.forUsers(
      ctx,
      interns.map((i) => i.user_id),
    )
  },

  /** Organization-wide (HR/Admin): every current intern. */
  async forAllInterns(ctx: RequestContext) {
    const interns = await prisma.intern.findMany({
      where: {
        organization_id: ctx.organization.id,
        deleted_at: null,
        status: { in: ['ONBOARDING', 'ACTIVE', 'ENDING_SOON'] },
      },
      select: { user_id: true },
    })
    return this.forUsers(
      ctx,
      interns.map((i) => i.user_id),
    )
  },
}
