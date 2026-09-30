import type { Metadata } from 'next'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { Pagination } from '@/components/tables/pagination'
import { HrNav, SubTabs } from '@/features/hr/components/hr-nav'
import { RequestTable } from '@/features/hr/components/request-table'
import { hrNavItems } from '@/features/hr/nav'
import { firstParam } from '@/lib/validation/list-params'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { hrRequestService } from '@/server/services/hr-request.service'

export const metadata: Metadata = { title: 'Requests · HR' }

/** The HR request queue (hr_request.manage, organization-wide). */
export default async function HrRequestsPage({ searchParams }: PageProps<'/hr/requests'>) {
  const ctx = await requirePageContext()
  if (authorizationService.scopeOf(ctx, 'hr_request.manage') !== 'ORGANIZATION') {
    return <AccessDenied what="the HR request queue" />
  }
  const params = await searchParams
  const status = firstParam(params, 'status')
  const assignee = firstParam(params, 'assignee')
  const { page, stats } = await hrRequestService.list(ctx, params)
  const linkParams = Object.fromEntries(
    Object.entries(params).flatMap(([k, v]) => (typeof v === 'string' && k !== 'page' ? [[k, v]] : [])),
  )
  return (
    <>
      <PageHeader
        title="HR requests"
        description="Letters, certificates, profile changes and questions from interns and staff."
      />
      <HrNav items={hrNavItems(ctx)} active="/hr/requests" />
      <SubTabs
        label="Request filters"
        active={assignee === 'me' ? 'me' : (status ?? 'all')}
        items={[
          { key: 'ACTIVE', href: '/hr/requests?status=ACTIVE', label: 'Active', count: stats.open + stats.inReview },
          { key: 'OPEN', href: '/hr/requests?status=OPEN', label: 'New', count: stats.open },
          {
            key: 'WAITING_FOR_USER',
            href: '/hr/requests?status=WAITING_FOR_USER',
            label: 'Waiting for requester',
            count: stats.waiting,
          },
          { key: 'me', href: '/hr/requests?assignee=me', label: 'Assigned to me' },
          { key: 'all', href: '/hr/requests', label: 'All' },
        ]}
      />
      <RequestTable rows={page.items} showRequester emptyText="Nothing in this view." />
      <Pagination
        pathname="/hr/requests"
        params={linkParams}
        page={page.page}
        totalPages={page.totalPages}
        total={page.total}
        pageSize={page.pageSize}
      />
    </>
  )
}
