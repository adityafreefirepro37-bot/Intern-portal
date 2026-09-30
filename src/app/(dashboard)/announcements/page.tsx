import type { Metadata } from 'next'
import { Megaphone } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { AnnouncementEditor, AnnouncementStatusButton } from '@/features/hr/components/announcements'
import { SubTabs } from '@/features/hr/components/hr-nav'
import { ANNOUNCEMENT_AUDIENCE_LABELS, ANNOUNCEMENT_CATEGORY_LABELS } from '@/lib/hr/announcements'
import { cn, formatDate, fullName } from '@/lib/utils'
import { firstParam } from '@/lib/validation/list-params'
import { requirePageContext } from '@/server/context'
import { announcementService } from '@/server/services/announcement.service'
import { authorizationService } from '@/server/services/authorization.service'

export const metadata: Metadata = { title: 'Announcements' }

/**
 * Announcements addressed to the viewer; people who publish also get a
 * "Manage" view with drafts, scheduled and archived announcements.
 */
export default async function AnnouncementsPage({ searchParams }: PageProps<'/announcements'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'announcement.read')) return <AccessDenied what="announcements" />
  const params = await searchParams
  const highlight = firstParam(params, 'highlight')
  const canCreate = authorizationService.can(ctx, 'announcement.create')
  const canUpdate = authorizationService.can(ctx, 'announcement.update')
  const manage = (canCreate || canUpdate) && firstParam(params, 'view') === 'manage'
  const tz = ctx.organization.timezone
  const [announcements, managed, options] = await Promise.all([
    manage ? Promise.resolve([]) : announcementService.listActive(ctx, 50),
    manage ? announcementService.manageList(ctx) : Promise.resolve(null),
    canCreate || canUpdate ? announcementService.audienceOptions(ctx) : Promise.resolve(null),
  ])

  return (
    <>
      <PageHeader
        title="Announcements"
        description="Updates from Ayava. Each announcement reaches only its audience."
        actions={canCreate && options && <AnnouncementEditor options={options} timeZone={tz} />}
      />
      {(canCreate || canUpdate) && (
        <SubTabs
          label="Announcement views"
          active={manage ? 'manage' : 'feed'}
          items={[
            { key: 'feed', href: '/announcements', label: 'For me' },
            { key: 'manage', href: '/announcements?view=manage', label: 'Manage' },
          ]}
        />
      )}
      {managed ? (
        managed.length === 0 ? (
          <EmptyState icon={Megaphone} title="No announcements yet" />
        ) : (
          <ul className="mx-auto max-w-3xl divide-y rounded-xl border bg-card">
            {managed.map((a) => (
              <li key={a.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="font-medium">{a.title}</p>
                  <p className="text-caption text-muted-foreground">
                    {ANNOUNCEMENT_CATEGORY_LABELS[a.category]} · {ANNOUNCEMENT_AUDIENCE_LABELS[a.audience]}
                    {a.audience_ids.length > 0 && ` (${a.audience_ids.length})`}
                    {a.published_at &&
                      ` · ${a.status === 'SCHEDULED' ? 'Goes live' : 'Published'} ${formatDate(a.published_at, tz)}`}
                    {a.authorName && ` · ${a.authorName}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={a.status} />
                  {canUpdate && options && a.status !== 'ARCHIVED' && (
                    <AnnouncementEditor announcement={a} options={options} timeZone={tz} />
                  )}
                  {canUpdate && (a.status === 'DRAFT' || a.status === 'SCHEDULED') && (
                    <AnnouncementStatusButton id={a.id} action="PUBLISH" label="Publish now" />
                  )}
                  {canUpdate && a.status !== 'ARCHIVED' && (
                    <AnnouncementStatusButton id={a.id} action="ARCHIVE" label="Archive" />
                  )}
                  {canUpdate && a.status === 'ARCHIVED' && (
                    <AnnouncementStatusButton id={a.id} action="UNARCHIVE" label="Restore" />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : announcements.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No announcements"
          description="Announcements addressed to you will appear here."
        />
      ) : (
        <ol className="mx-auto max-w-3xl space-y-4">
          {announcements.map((announcement) => (
            <li key={announcement.id}>
              <Card className={cn('p-5 sm:p-6', highlight === announcement.id && 'ring-2 ring-ring')}>
                <article className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-h3">{announcement.title}</h2>
                    <Badge variant="outline">{ANNOUNCEMENT_CATEGORY_LABELS[announcement.category]}</Badge>
                    {(announcement.priority === 'HIGH' || announcement.priority === 'URGENT') && (
                      <Badge variant="warning">{announcement.priority === 'URGENT' ? 'Urgent' : 'Important'}</Badge>
                    )}
                  </div>
                  <p className="text-caption text-muted-foreground">
                    {announcement.publisher ? `${fullName(announcement.publisher)} · ` : ''}
                    {formatDate(announcement.published_at, tz)}
                    {announcement.audience !== 'EVERYONE' &&
                      ` · For ${ANNOUNCEMENT_AUDIENCE_LABELS[announcement.audience].toLowerCase()}`}
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
