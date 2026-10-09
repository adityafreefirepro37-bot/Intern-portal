import type { Metadata } from 'next'
import Link from 'next/link'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { Card } from '@/components/ui/card'
import { ReviewSubmissionForm } from '@/features/learning/components/learner-actions'
import { LessonText } from '@/features/learning/components/learning-ui'
import { SubmissionHistory } from '@/features/learning/components/submission-history'
import { SUBMISSION_STATUS_LABELS } from '@/lib/work/submissions'
import { fullName } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { learningAssignmentService } from '@/server/services/learning-assignment.service'

export const metadata: Metadata = { title: 'Assignment submission' }

export default async function SubmissionPage({ params }: PageProps<'/learning/reviews/[id]'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  const { submission, own, can } = await learningAssignmentService.submission(ctx, id)
  const { assignment } = submission

  return (
    <>
      <PageHeader
        title={assignment.title}
        breadcrumbs={[
          { label: 'Learning Hub', href: '/learning' },
          ...(own ? [] : [{ label: 'Reviews', href: '/learning/reviews' }]),
          { label: own ? 'Your submission' : fullName(submission.user) },
        ]}
        description={
          <>
            {own ? 'Your submission' : `Submitted by ${fullName(submission.user)}`} for{' '}
            <Link href={`/learning/courses/${assignment.course.id}`} className="underline">
              {assignment.course.title}
            </Link>
          </>
        }
        actions={<StatusBadge status={submission.status} label={SUBMISSION_STATUS_LABELS[submission.status]} />}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <SubmissionHistory versions={submission.versions} maxPoints={assignment.max_points} />
          {submission.versions.length === 0 && <p className="text-small text-muted-foreground">Nothing has been submitted yet.</p>}
        </div>
        <aside className="space-y-4">
          {can.review && (
            <Card className="p-5">
              <h2 className="mb-3 text-h3">Review version {submission.current_version}</h2>
              <ReviewSubmissionForm submissionId={submission.id} maxPoints={assignment.max_points} rubric={assignment.rubric} />
            </Card>
          )}
          <Card className="space-y-2 p-5">
            <h2 className="text-h3">Instructions</h2>
            <LessonText text={assignment.instructions} />
          </Card>
        </aside>
      </div>
    </>
  )
}
