import type { Metadata } from 'next'
import { ProjectFiles } from '@/features/work/components/project-controls'
import { requirePageContext } from '@/server/context'
import { projectService } from '@/server/services/project.service'

export const metadata: Metadata = { title: 'Project files' }

export default async function ProjectFilesPage({ params }: PageProps<'/projects/[id]/files'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  const { access, files } = await projectService.listFiles(ctx, id)
  return (
    <>
      <div className="mb-4">
        <h2 className="text-h3">Files</h2>
        <p className="text-small text-muted-foreground">
          Private to project members — downloads are checked on every request.
        </p>
      </div>
      <ProjectFiles
        projectId={access.project.id}
        files={files}
        canUpload={access.can.uploadFiles}
        timeZone={ctx.organization.timezone}
      />
    </>
  )
}
