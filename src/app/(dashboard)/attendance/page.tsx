import type { Metadata } from 'next'
import { Clock } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { PhasePlaceholder } from '@/components/common/phase-placeholder'
import { AccessDenied } from '@/components/common/states'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'

export const metadata: Metadata = { title: 'Attendance' }

export default async function Page() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'attendance.read')) return <AccessDenied what="attendance" />

  return (
    <>
      <PageHeader title="Attendance" />
      <PhasePlaceholder
        icon={Clock}
        phase="05"
        title="Attendance"
        description="Daily check-in and check-out with attendance history."
        planned={[
          'Check in and check out',
          'Late, half-day and absence tracking',
          'Correction requests with review',
          'Monthly attendance reports',
        ]}
        foundation={[
          'attendance and attendance_corrections tables',
          'One record per person per day (enforced)',
          'Late-after time in organization settings',
        ]}
      />
    </>
  )
}
