import type { Metadata } from 'next'
import { BarChart3 } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { PhasePlaceholder } from '@/components/common/phase-placeholder'
import { AccessDenied } from '@/components/common/states'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'

export const metadata: Metadata = { title: 'Analytics' }

export default async function Page() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'analytics.read')) return <AccessDenied what="analytics" />

  return (
    <>
      <PageHeader title="Analytics" />
      <PhasePlaceholder
        icon={BarChart3}
        phase="08"
        title="Analytics"
        description="Programme-wide insight into interns, work and learning."
        planned={[
          'Intern pipeline and completion trends',
          'Task throughput and review turnaround',
          'Attendance and learning completion',
          'Exportable reports',
        ]}
        foundation={[
          'Indexed status and date columns for reporting queries',
          'Live task breakdown on the overview',
          'analytics.read permission',
        ]}
      />
    </>
  )
}
