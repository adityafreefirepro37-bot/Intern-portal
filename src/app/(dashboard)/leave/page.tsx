import type { Metadata } from 'next'
import { Palmtree } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { PhasePlaceholder } from '@/components/common/phase-placeholder'
import { AccessDenied } from '@/components/common/states'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'

export const metadata: Metadata = { title: 'Leave' }

export default async function Page() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'leave.read')) return <AccessDenied what="leave" />

  return (
    <>
      <PageHeader title="Leave" />
      <PhasePlaceholder
        icon={Palmtree}
        phase="05"
        title="Leave"
        description="Requesting, approving and tracking time off."
        planned={[
          'Leave requests with dates and reason',
          'Approval workflow for managers and HR',
          'Balances and leave calendar',
          'Cancellation of pending requests',
        ]}
        foundation={[
          'leave_types and leave_requests tables',
          'Casual, sick, academic and unpaid leave types seeded',
          'leave.request / leave.approve permissions',
        ]}
      />
    </>
  )
}
