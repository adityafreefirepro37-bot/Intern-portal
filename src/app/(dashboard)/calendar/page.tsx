import type { Metadata } from 'next'
import { CalendarDays } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { PhasePlaceholder } from '@/components/common/phase-placeholder'
import { AccessDenied } from '@/components/common/states'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'

export const metadata: Metadata = { title: 'Calendar' }

export default async function Page() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'calendar.read')) return <AccessDenied what="the calendar" />

  return (
    <>
      <PageHeader title="Calendar" />
      <PhasePlaceholder
        icon={CalendarDays}
        phase="06"
        title="Calendar"
        description="Meetings, deadlines, trainings and reviews in one schedule."
        planned={[
          'Month, week and agenda views',
          'Task deadlines and milestones on the calendar',
          'Scheduling meetings with attendees and links',
          'Leave and holidays alongside work',
        ]}
        foundation={[
          'meetings and calendar_events tables',
          'calendar.read / calendar.manage permissions',
          'Task due dates already tracked',
        ]}
      />
    </>
  )
}
