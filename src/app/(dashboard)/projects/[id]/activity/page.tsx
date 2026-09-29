import type { Metadata } from 'next'
import { Card, CardContent } from '@/components/ui/card'
import { ActivityList } from '@/features/work/components/activity-list'
import { requirePageContext } from '@/server/context'
import { projectService } from '@/server/services/project.service'

export const metadata: Metadata = { title: 'Project activity' }

/** Everything that happened in the project, from the audit log (newest first). */
export default async function ProjectActivityPage({ params }: PageProps<'/projects/[id]/activity'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  const { activity } = await projectService.listActivity(ctx, id)
  return (
    <>
      <h2 className="mb-4 text-h3">Activity</h2>
      <Card>
        <CardContent className="pt-6">
          <ActivityList entries={activity} />
        </CardContent>
      </Card>
    </>
  )
}
