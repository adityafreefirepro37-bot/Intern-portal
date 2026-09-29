import type { Metadata } from 'next'
import Link from 'next/link'
import { Flag } from 'lucide-react'
import { EmptyState } from '@/components/common/states'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/misc'
import { MilestoneDialogButton, MilestoneMenu } from '@/features/work/components/project-controls'
import { MilestoneBadge } from '@/features/work/components/work-badges'
import { formatDateOnly } from '@/lib/interns/dates'
import { formatDay } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { projectService } from '@/server/services/project.service'

export const metadata: Metadata = { title: 'Milestones' }

export default async function MilestonesPage({ params }: PageProps<'/projects/[id]/milestones'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  const { access, milestones } = await projectService.listMilestones(ctx, id)
  const canManage = access.can.manageMilestones

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-h3">Milestones</h2>
          <p className="text-small text-muted-foreground">
            Progress counts completed top-level tasks in each milestone.
          </p>
        </div>
        {canManage && <MilestoneDialogButton projectId={access.project.id} />}
      </div>
      {milestones.length === 0 ? (
        <EmptyState
          icon={Flag}
          title="No milestones yet"
          description="Create milestones to break this project into measurable stages."
        />
      ) : (
        <ol className="grid grid-cols-1 gap-3">
          {milestones.map((milestone, index) => (
            <li key={milestone.id}>
              <Card className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium">{milestone.name}</h3>
                      <MilestoneBadge status={milestone.displayStatus} />
                    </div>
                    <p className="text-caption text-muted-foreground">
                      {milestone.start_date ? `${formatDay(milestone.start_date)} → ` : ''}
                      {milestone.due_date ? `due ${formatDay(milestone.due_date)}` : 'No due date'}
                      {milestone.completed_at && ` · completed ${formatDay(milestone.completed_at)}`}
                    </p>
                    {milestone.description && (
                      <p className="text-small text-muted-foreground">{milestone.description}</p>
                    )}
                    <div className="flex items-center gap-3 pt-1">
                      <Progress
                        value={milestone.progress.percent}
                        label={`${milestone.name}: ${milestone.progress.percent}%`}
                      />
                      <Link
                        href={`/projects/${access.project.id}/tasks?milestone=${milestone.id}&closed=1`}
                        className="tabular shrink-0 text-caption text-primary hover:underline"
                      >
                        {milestone.progress.completed}/{milestone.progress.total} tasks
                      </Link>
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap items-center gap-1">
                      <MilestoneDialogButton
                        projectId={access.project.id}
                        milestone={{
                          id: milestone.id,
                          name: milestone.name,
                          description: milestone.description,
                          startDate: milestone.start_date ? formatDateOnly(milestone.start_date) : '',
                          dueDate: milestone.due_date ? formatDateOnly(milestone.due_date) : '',
                        }}
                      />
                      <MilestoneMenu
                        milestoneId={milestone.id}
                        name={milestone.name}
                        status={milestone.status}
                        first={index === 0}
                        last={index === milestones.length - 1}
                      />
                    </div>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}
