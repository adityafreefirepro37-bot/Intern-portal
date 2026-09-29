import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import { workProgress } from '@/lib/work/tasks'

type Db = Prisma.TransactionClient | typeof prisma

/**
 * Project progress = completed ÷ non-cancelled top-level tasks × 100
 * (subtasks excluded to avoid double counting; see src/lib/work/tasks.ts).
 * The value is cached on projects.progress_percentage for sorting and
 * dashboards and recomputed whenever a task's status, parent or project changes.
 */
export const projectProgressService = {
  async recompute(projectId: string | null | undefined, db: Db = prisma): Promise<number | null> {
    if (!projectId) return null
    const tasks = await db.task.findMany({
      where: { project_id: projectId, deleted_at: null },
      select: { status: true, parent_task_id: true },
    })
    const { percent } = workProgress(tasks)
    await db.project.update({ where: { id: projectId }, data: { progress_percentage: percent } })
    return percent
  },
}
