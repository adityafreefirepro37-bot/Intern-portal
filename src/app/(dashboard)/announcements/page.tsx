import type { Metadata } from 'next'
import { Megaphone, Plus } from 'lucide-react'
import { PhaseBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn, formatDate, fullName } from '@/lib/utils'
import { firstParam } from '@/lib/validation/list-params'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { announcementService } from '@/server/services/content.service'

export const metadata: Metadata = { title: 'Announcements' }

export default async function AnnouncementsPage({ searchParams }: PageProps<'/announcements'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'announcement.read')) return <AccessDenied what="announcements" />

  const highlight = firstParam(await searchParams, 'highlight')
  const announcements = await announcementService.listActive(ctx, 50)

  return (
    <>
      <PageHeader
        title="Announcements"
        description="Company-wide updates. Publishing and read receipts arrive in Phase 06."
        actions={
          authorizationService.can(ctx, 'announcement.create') && (
            <Button disabled>
              <Plus aria-hidden /> New announcement
              <PhaseBadge phase="06" className="border-primary-foreground/40 text-primary-foreground" />
            </Button>
          )
        }
      />
      {announcements.length === 0 ? (
        <EmptyState icon={Megaphone} title="No announcements" description="Published announcements will appear here." />
      ) : (
        <ol className="mx-auto max-w-3xl space-y-4">
          {announcements.map((announcement) => (
            <li key={announcement.id}>
              <Card className={cn('p-5 sm:p-6', highlight === announcement.id && 'ring-2 ring-ring')}>
                <article className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-h3">{announcement.title}</h2>
                    {(announcement.priority === 'HIGH' || announcement.priority === 'URGENT') && (
                      <Badge variant="warning">{announcement.priority === 'URGENT' ? 'Urgent' : 'Important'}</Badge>
                    )}
                  </div>
                  <p className="text-caption text-muted-foreground">
                    {announcement.publisher ? `${fullName(announcement.publisher)} · ` : ''}
                    {formatDate(announcement.published_at, ctx.organization.timezone)}
                  </p>
                  <p className="whitespace-pre-line text-body">{announcement.body}</p>
                </article>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}
