import type { Metadata } from 'next'
import { NewTaskButton } from '@/features/work/components/task-form'
import { TaskWorkspace } from '@/features/work/components/task-workspace'
import { requirePageContext } from '@/server/context'
import { projectService } from '@/server/services/project.service'
import { taskService } from '@/server/services/task.service'

export const metadata: Metadata = { title: 'Project tasks' }

export default async function ProjectTasksPage({ params, searchParams }: PageProps<'/projects/[id]/tasks'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  const { access, milestones } = await projectService.listMilestones(ctx, id)
  const createOptions = access.can.createTasks ? await taskService.createOptions(ctx) : null
  const project = createOptions?.projects.find((p) => p.id === access.project.id)

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h3">Tasks</h2>
        {createOptions && project && (
          <NewTaskButton projects={[project]} canAssign={access.can.assignTasks} projectId={access.project.id} />
        )}
      </div>
      <TaskWorkspace
        ctx={ctx}
        searchParams={await searchParams}
        pathname={`/projects/${access.project.id}/tasks`}
        projectId={access.project.id}
        milestones={milestones.map((m) => ({ value: m.id, label: m.name }))}
      />
    </>
  )
}
