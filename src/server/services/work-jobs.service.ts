import { prisma } from '@/lib/db/client'
import { addDays, formatDateOnly, todayIn } from '@/lib/interns/dates'
import { domainEvents } from '../events/domain-events'
import { milestoneService } from './milestone.service'

/**
 * Daily deadline events (run from /api/jobs/daily or `npm run jobs:daily`):
 *   task.due_soon       open tasks due tomorrow
 *   task.overdue        open tasks that became overdue today (due yesterday)
 *   project.milestone_due  milestones due tomorrow
 * Each date window matches exactly one day, so a daily run notifies once.
 */
export const workJobsService = {
  async emitTaskDeadlines(options: { organizationId?: string; now?: Date } = {}) {
    const organizations = await prisma.organization.findMany({
      where: options.organizationId ? { id: options.organizationId } : {},
      select: { id: true, timezone: true },
    })
    let dueSoon = 0
    let overdue = 0
    for (const org of organizations) {
      const today = todayIn(org.timezone, options.now)
      const open = {
        organization_id: org.id,
        deleted_at: null,
        status: { notIn: ['COMPLETED' as const, 'CANCELLED' as const] },
      }
      const [soon, late] = await Promise.all([
        prisma.task.findMany({ where: { ...open, due_date: addDays(today, 1) }, select: { id: true, due_date: true } }),
        prisma.task.findMany({
          where: { ...open, due_date: addDays(today, -1) },
          select: { id: true, due_date: true },
        }),
      ])
      for (const task of soon) {
        dueSoon += 1
        await domainEvents.emit('task.due_soon', {
          organizationId: org.id,
          actorUserId: null,
          payload: { taskId: task.id, dueDate: formatDateOnly(task.due_date!) },
        })
      }
      for (const task of late) {
        overdue += 1
        await domainEvents.emit('task.overdue', {
          organizationId: org.id,
          actorUserId: null,
          payload: { taskId: task.id, dueDate: formatDateOnly(task.due_date!) },
        })
      }
    }
    const milestones = await milestoneService.emitDueSoon(options)
    return { dueSoon, overdue, milestonesDue: milestones.emitted }
  },
}
