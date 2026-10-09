import type { Metadata } from 'next'
import Link from 'next/link'
import { ClipboardCheck } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { DataTable } from '@/components/tables/data-table'
import { SubTabs } from '@/features/hr/components/hr-nav'
import { SUBMISSION_STATUS_LABELS } from '@/lib/work/submissions'
import { formatDay, fullName } from '@/lib/utils'
import { firstParam } from '@/lib/validation/list-params'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { learningAssignmentService } from '@/server/services/learning-assignment.service'

export const metadata: Metadata = { title: 'Learning reviews' }

export default async function LearningReviewsPage({ searchParams }: PageProps<'/learning/reviews'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'learning_assignment.review')) return <AccessDenied what="learning reviews" />
  const all = firstParam(await searchParams, 'view') === 'all'
  const rows = await learningAssignmentService.queue(ctx, { includeReviewed: all })

  return (
    <>
      <PageHeader
        title="Learning reviews"
        breadcrumbs={[{ label: 'Learning Hub', href: '/learning' }, { label: 'Reviews' }]}
        description="Assignment submissions from interns you support. You can’t review your own work."
      />
      <SubTabs
        label="Review views"
        active={all ? 'all' : 'waiting'}
        items={[
          { key: 'waiting', href: '/learning/reviews', label: 'Waiting for review', count: all ? undefined : rows.length },
          { key: 'all', href: '/learning/reviews?view=all', label: 'All submissions' },
        ]}
      />
      <DataTable
        caption="Assignment submissions"
        rows={rows}
        getRowId={(r) => r.id}
        empty={
          <EmptyState
            icon={ClipboardCheck}
            title={all ? 'No submissions yet' : 'Nothing waiting for review'}
            description="Submitted assignments from your interns appear here."
          />
        }
        columns={[
          {
            key: 'assignment',
            header: 'Assignment',
            cell: (r) => (
              <Link href={`/learning/reviews/${r.id}`} className="font-medium hover:underline">
                {r.assignment.title}
              </Link>
            ),
          },
          { key: 'person', header: 'Intern', cell: (r) => fullName(r.user) },
          { key: 'course', header: 'Course', cell: (r) => r.assignment.course.title, hideBelow: 'md' },
          { key: 'version', header: 'Version', cell: (r) => r.current_version, hideBelow: 'sm' },
          { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} label={SUBMISSION_STATUS_LABELS[r.status]} /> },
          { key: 'updated', header: 'Updated', cell: (r) => formatDay(r.updated_at), hideBelow: 'sm' },
        ]}
      />
    </>
  )
}
