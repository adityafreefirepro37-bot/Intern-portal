import type { Metadata } from 'next'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { AssignmentWork, EnrollButton } from '@/features/learning/components/learner-actions'
import { DeadlineBadge, LessonText } from '@/features/learning/components/learning-ui'
import { SubmissionHistory } from '@/features/learning/components/submission-history'
import { SUBMISSION_STATUS_LABELS } from '@/lib/work/submissions'
import { requirePageContext } from '@/server/context'
import { learningAssignmentService } from '@/server/services/learning-assignment.service'

export const metadata: Metadata = { title: 'Assignment' }

export default async function AssignmentPage({ params }: PageProps<'/learning/assignments/[id]'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  const view = await learningAssignmentService.view(ctx, id)
  const { assignment, submission } = view
  const status = submission?.status ?? null

  return (
    <>
      <PageHeader
        title={assignment.title}
        breadcrumbs={[
          { label: 'Learning Hub', href: '/learning' },
          { label: assignment.course.title, href: `/learning/courses/${assignment.course.id}` },
          { label: 'Assignment' },
        ]}
        description={assignment.description ?? undefined}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card className="space-y-4 p-5">
            <h2 className="text-h3">Instructions</h2>
            <LessonText text={assignment.instructions} />
          </Card>
          {!view.enrolled && assignment.course.status === 'PUBLISHED' && (
            <Card className="flex flex-wrap items-center gap-3 p-5 text-small">
              <p className="flex-1">Enroll in the course to submit this assignment.</p>
              <EnrollButton courseId={assignment.course.id} />
            </Card>
          )}
          {(view.can.draft || view.can.submit) && (
            <AssignmentWork
              assignmentId={assignment.id}
              draft={submission?.draft_text ?? null}
              canDraft={view.can.draft}
              canSubmit={view.can.submit}
              resubmit={Boolean(submission && submission.current_version > 0)}
            />
          )}
          {submission && submission.versions.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-h2">Your submissions</h2>
              <SubmissionHistory versions={submission.versions} maxPoints={assignment.max_points} />
            </section>
          )}
        </div>
        <aside>
          <Card className="space-y-3 p-5">
            <h2 className="text-h3">Details</h2>
            <div className="flex flex-wrap gap-1.5">
              {status && status !== 'DRAFT' && <StatusBadge status={status} label={SUBMISSION_STATUS_LABELS[status]} />}
              {!assignment.is_required && <Badge variant="outline">Optional</Badge>}
              <DeadlineBadge deadline={view.deadline} due={view.dueDate} />
            </div>
            {assignment.max_points !== null && (
              <p className="text-small">
                Scored out of <span className="font-medium">{assignment.max_points}</span> points
                {submission?.points_awarded !== null && submission?.points_awarded !== undefined
                  ? ` — you received ${submission.points_awarded}`
                  : ''}
              </p>
            )}
            {assignment.rubric && (
              <div className="text-small">
                <p className="font-medium">Rubric</p>
                <p className="whitespace-pre-line text-muted-foreground">{assignment.rubric}</p>
              </div>
            )}
          </Card>
        </aside>
      </div>
    </>
  )
}
