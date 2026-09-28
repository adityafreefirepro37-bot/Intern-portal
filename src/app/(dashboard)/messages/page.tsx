import type { Metadata } from 'next'
import { MessagesSquare } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { PhasePlaceholder } from '@/components/common/phase-placeholder'
import { AccessDenied } from '@/components/common/states'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'

export const metadata: Metadata = { title: 'Messages' }

export default async function Page() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'message.read')) return <AccessDenied what="messages" />

  return (
    <>
      <PageHeader title="Messages" />
      <PhasePlaceholder
        icon={MessagesSquare}
        phase="06"
        title="Messages"
        description="Team channels for day-to-day conversation."
        planned={[
          'Company, team and project channels',
          'Direct messages',
          'Unread counts and mentions',
          'Message editing and deletion',
        ]}
        foundation={[
          'channels and messages tables',
          'A #general channel seeded',
          'message.read / message.send permissions',
        ]}
      />
    </>
  )
}
