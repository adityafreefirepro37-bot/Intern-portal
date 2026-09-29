import type { Metadata } from 'next'
import { AccessDenied } from '@/components/common/states'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EditProjectForm, ProjectStatusControl } from '@/features/work/components/project-controls'
import { formatDateOnly } from '@/lib/interns/dates'
import { PROJECT_STATUS_LABELS } from '@/lib/work/projects'
import { requirePageContext } from '@/server/context'
import { projectService } from '@/server/services/project.service'

export const metadata: Metadata = { title: 'Project settings' }

export default async function ProjectSettingsPage({ params }: PageProps<'/projects/[id]/settings'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  const { access, project } = await projectService.listMembers(ctx, id)
  if (!access.can.edit && !access.can.archive) return <AccessDenied what="this project’s settings" />
  const managers = await projectService.managerOptions(ctx)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardDescription>
            Currently <strong>{PROJECT_STATUS_LABELS[project.status]}</strong>. Status changes are recorded and members
            are notified.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectStatusControl projectId={project.id} status={project.status} />
        </CardContent>
      </Card>
      {access.can.edit && (
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <EditProjectForm
              project={{
                id: project.id,
                name: project.name,
                description: project.description,
                priority: project.priority,
                managerId: project.manager?.id ?? null,
                startDate: project.start_date ? formatDateOnly(project.start_date) : '',
                targetEndDate: project.target_end_date ? formatDateOnly(project.target_end_date) : '',
              }}
              managers={managers}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
