import type { Metadata } from 'next'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { RelativeTime } from '@/components/common/relative-time'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NotificationSettingsForm } from '@/features/communication/components/notification-settings'
import { SubTabs } from '@/features/hr/components/hr-nav'
import { ActionButton } from '@/features/hr/components/action-form'
import { cn } from '@/lib/utils'
import { firstParam } from '@/lib/validation/list-params'
import { retryNotificationEmailsAction } from '@/server/actions/communication'
import { markNotificationsReadAction } from '@/server/actions/work'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { notificationDeliveryService } from '@/server/services/notification-delivery.service'
import { notificationService } from '@/server/services/notification.service'

export const metadata: Metadata = { title: 'Notifications' }

export default async function NotificationsPage({ searchParams }: PageProps<'/notifications'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'notification.read')) return <AccessDenied what="notifications" />
  const params = await searchParams
  const view = firstParam(params, 'view') === 'settings' ? 'settings' : firstParam(params, 'view') === 'unread' ? 'unread' : 'all'
  const page = Math.max(1, Number(firstParam(params, 'page')) || 1)
  const canManage = authorizationService.can(ctx, 'notification.manage')
  const [history, preferences, stats] = await Promise.all([
    view === 'settings' ? null : notificationService.history(ctx, { unreadOnly: view === 'unread', page }),
    view === 'settings' ? notificationDeliveryService.preferences(ctx) : null,
    view === 'settings' && canManage ? notificationDeliveryService.stats(ctx) : null,
  ])

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Everything that’s happened around your work, and where you want to hear about it."
        actions={
          view !== 'settings' &&
          ctx.shell.unreadNotifications > 0 && (
            <ActionButton action={markNotificationsReadAction} fields={{}} variant="outline">
              Mark all read
            </ActionButton>
          )
        }
      />
      <SubTabs
        label="Notification views"
        active={view}
        items={[
          { key: 'all', href: '/notifications', label: 'All' },
          { key: 'unread', href: '/notifications?view=unread', label: 'Unread', count: ctx.shell.unreadNotifications },
          { key: 'settings', href: '/notifications?view=settings', label: 'Settings' },
        ]}
      />
      {preferences && (
        <div className="grid max-w-4xl gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Where notifications reach you</CardTitle>
            </CardHeader>
            <CardContent>
              <NotificationSettingsForm items={preferences.items} emailAvailable={preferences.emailAvailable} />
            </CardContent>
          </Card>
          {stats && (
            <Card>
              <CardHeader>
                <CardTitle>Email delivery (last 7 days)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-small">
                {!stats.configured && (
                  <p className="rounded-md bg-warning/10 p-3">
                    No email provider is configured (EMAIL_PROVIDER, EMAIL_FROM and the provider’s keys), so email copies are
                    skipped. In-app notifications work as usual.
                  </p>
                )}
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ['Sent', stats.sent],
                    ['Waiting', stats.pending],
                    ['Failed', stats.failed],
                    ['Skipped', stats.skipped],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border p-3">
                      <dt className="text-caption text-muted-foreground">{label}</dt>
                      <dd className="tabular text-h3">{value}</dd>
                    </div>
                  ))}
                </dl>
                {stats.failed > 0 && stats.configured && (
                  <ActionButton action={retryNotificationEmailsAction} fields={{}} variant="outline" size="sm">
                    Retry failed emails
                  </ActionButton>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
      {history &&
        (history.items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={view === 'unread' ? 'You’re all caught up' : 'No notifications yet'}
            description="Assignments, reviews, meetings and messages that need you show up here."
          />
        ) : (
          <>
            <ul className="max-w-4xl divide-y rounded-xl border bg-card">
              {history.items.map((item) => {
                const content = (
                  <>
                    <span className={cn('block text-small', !item.read_at && 'font-semibold')}>{item.title}</span>
                    <span className="block text-caption text-muted-foreground">
                      {item.body ? `${item.body} · ` : ''}
                      <RelativeTime date={item.created_at} />
                    </span>
                  </>
                )
                return (
                  <li key={item.id} className={cn('flex items-start gap-3 p-3 sm:p-4', !item.read_at && 'bg-accent/40')}>
                    <span
                      className={cn('mt-1.5 size-2 shrink-0 rounded-full', item.read_at ? 'bg-transparent' : 'bg-primary')}
                      aria-label={item.read_at ? undefined : 'Unread'}
                    />
                    <div className="min-w-0 flex-1">
                      {item.href ? (
                        <Link href={item.href} className="hover:underline">
                          {content}
                        </Link>
                      ) : (
                        content
                      )}
                    </div>
                    {!item.read_at && (
                      <ActionButton action={markNotificationsReadAction} fields={{ notificationId: item.id }} variant="ghost" size="sm">
                        Mark read
                      </ActionButton>
                    )}
                  </li>
                )
              })}
            </ul>
            {(history.page > 1 || history.hasMore) && (
              <nav aria-label="Pages" className="mt-4 flex gap-2">
                {history.page > 1 && (
                  <Link
                    href={`/notifications?${view === 'unread' ? 'view=unread&' : ''}page=${history.page - 1}`}
                    className="inline-flex h-8 items-center rounded-md border bg-card px-3 text-caption font-medium hover:bg-accent"
                  >
                    ← Newer
                  </Link>
                )}
                {history.hasMore && (
                  <Link
                    href={`/notifications?${view === 'unread' ? 'view=unread&' : ''}page=${history.page + 1}`}
                    className="inline-flex h-8 items-center rounded-md border bg-card px-3 text-caption font-medium hover:bg-accent"
                  >
                    Older →
                  </Link>
                )}
              </nav>
            )}
          </>
        ))}
    </>
  )
}
