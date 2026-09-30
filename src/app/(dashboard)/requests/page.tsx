import type { Metadata } from 'next'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { Pagination } from '@/components/tables/pagination'
import { SubTabs } from '@/features/hr/components/hr-nav'
import { NewRequestButton } from '@/features/hr/components/hr-requests'
import { RequestTable } from '@/features/hr/components/request-table'
import { HR_REQUEST_CATEGORY_LABELS } from '@/lib/hr/requests'
import { firstParam } from '@/lib/validation/list-params'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { hrRequestService } from '@/server/services/hr-request.service'

export const metadata: Metadata = { title: 'My requests' }

/** Requests the signed-in person raised with HR. */
export default async function MyRequestsPage({ searchParams }: PageProps<'/requests'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'hr_request.read')) return <AccessDenied what="HR requests" />
  const params = await searchParams
  const status = firstParam(params, 'status')
  const { page, stats } = await hrRequestService.list(ctx, params, { mine: true })
  const linkParams = Object.fromEntries(
    Object.entries(params).flatMap(([k, v]) => (typeof v === 'string' && k !== 'page' ? [[k, v]] : [])),
  )
  return (
    <>
      <PageHeader
        title="My requests"
        description="Ask HR for letters, certificates, profile changes or anything else. You’ll be notified of every reply."
        actions={
          authorizationService.can(ctx, 'hr_request.create') && (
            <NewRequestButton categories={HR_REQUEST_CATEGORY_LABELS} />
          )
        }
      />
      <SubTabs
        label="Request filters"
        active={status ?? 'all'}
        items={[
          { key: 'all', href: '/requests', label: 'All' },
          {
            key: 'ACTIVE',
            href: '/requests?status=ACTIVE',
            label: 'Open',
            count: stats.open + stats.inReview + stats.waiting,
          },
          {
            key: 'WAITING_FOR_USER',
            href: '/requests?status=WAITING_FOR_USER',
            label: 'Waiting for you',
            count: stats.waiting,
          },
          { key: 'RESOLVED', href: '/requests?status=RESOLVED', label: 'Resolved' },
        ]}
      />
      <RequestTable rows={page.items} showRequester={false} emptyText="Requests you send to HR appear here." />
      <Pagination
        pathname="/requests"
        params={linkParams}
        page={page.page}
        totalPages={page.totalPages}
        total={page.total}
        pageSize={page.pageSize}
      />
    </>
  )
}
