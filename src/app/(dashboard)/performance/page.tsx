import type { Metadata } from 'next'
import { Gauge } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { PhasePlaceholder } from '@/components/common/phase-placeholder'
import { AccessDenied } from '@/components/common/states'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'

export const metadata: Metadata = { title: 'Performance' }

export default async function Page() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'performance.read')) return <AccessDenied what="performance records" />

  return (
    <>
      <PageHeader title="Performance" />
      <PhasePlaceholder
        icon={Gauge}
        phase="06"
        title="Performance"
        description="Weekly check-ins, feedback and structured performance reviews."
        planned={[
          'Weekly check-ins with reviewer comments',
          'Feedback between mentors, managers and interns',
          'Performance reviews across eight dimensions',
          'Review sign-off',
        ]}
        foundation={[
          'weekly_checkins, feedback and performance_reviews tables',
          'Scores constrained to 1–5 in the database',
          'Scoped access: managers see only assigned interns',
        ]}
      />
    </>
  )
}
