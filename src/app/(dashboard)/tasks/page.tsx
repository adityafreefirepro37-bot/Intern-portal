import type { Metadata } from 'next'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { NewTaskButton } from '@/features/work/components/task-form'
import { TaskWorkspace } from '@/features/work/components/task-workspace'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { taskService } from '@/server/services/task.service'

export const metadata: Metadata = { title: 'Tasks' }

/** All tasks the viewer can see (scope + project membership), as a list or board. */
export default async function TasksPage({ searchParams }: PageProps<'/tasks'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'task.read')) return <AccessDenied what="tasks" />
  const orgWide = ctx.actor.permissions.get('task.read') === 'ORGANIZATION'
  const createOptions = authorizationService.can(ctx, 'task.create') ? await taskService.createOptions(ctx) : null

  return (
    <>
      <PageHeader
        title="Tasks"
        description={
          orgWide ? 'Work across every project.' : 'Tasks assigned to you, created by you, or in your projects.'
        }
        actions={
          createOptions && <NewTaskButton projects={createOptions.projects} canAssign={createOptions.canAssign} />
        }
      />
      <TaskWorkspace ctx={ctx} searchParams={await searchParams} pathname="/tasks" />
    </>
  )
}
