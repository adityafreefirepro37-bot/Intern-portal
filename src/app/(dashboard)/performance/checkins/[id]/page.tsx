import type { Metadata } from 'next'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { Card } from '@/components/ui/card'
import { CheckinReviewForm, GiveFeedbackDialog } from '@/features/performance/components/performance-forms'
import { CHECKIN_QUESTIONS, CHECKIN_STATUS_LABELS } from '@/lib/performance/rules'
import { formatDay, fullName } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { checkinService } from '@/server/services/checkin.service'

export const metadata: Metadata = { title: 'Weekly check-in' }

export default async function CheckinPage({ params }: PageProps<'/performance/checkins/[id]'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  const { checkin, relation, can } = await checkinService.get(ctx, id)
  const title = `Week of ${formatDay(checkin.week_start)}`

  return (
    <>
      <PageHeader
        title={title}
        breadcrumbs={[
          { label: 'Performance', href: '/performance' },
          { label: 'Check-ins', href: '/performance/checkins' },
          { label: relation.isSelf ? title : fullName(checkin.intern.user) },
        ]}
        description={relation.isSelf ? undefined : `Check-in by ${fullName(checkin.intern.user)}`}
        actions={
          <>
            <StatusBadge status={checkin.status} label={CHECKIN_STATUS_LABELS[checkin.status]} />
            {!relation.isSelf && authorizationService.can(ctx, 'feedback.create') && (
              <GiveFeedbackDialog
                interns={[]}
                internId={checkin.intern.id}
                context={{ type: 'WEEKLY_CHECKIN', id: checkin.id, label: title }}
                label="Give feedback"
              />
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card className="divide-y">
          {CHECKIN_QUESTIONS.map((q) => (
            <section key={q.key} className="space-y-1 p-5">
              <h2 className="text-label text-muted-foreground">{q.label}</h2>
              <p className="whitespace-pre-line text-small">{checkin[q.key] || '—'}</p>
            </section>
          ))}
        </Card>
        <aside className="space-y-4">
          {checkin.reviewed_at && (
            <Card className="space-y-2 p-5">
              <h2 className="text-h3">Review</h2>
              <p className="whitespace-pre-line text-small">{checkin.review_comment}</p>
              <p className="text-caption text-muted-foreground">
                {checkin.reviewer ? `${fullName(checkin.reviewer)} · ` : ''}
                {formatDay(checkin.reviewed_at)}
              </p>
            </Card>
          )}
          {can.review && (
            <Card className="p-5">
              <h2 className="mb-3 text-h3">Review this check-in</h2>
              <CheckinReviewForm checkinId={checkin.id} />
            </Card>
          )}
          {checkin.submitted_at && <p className="text-caption text-muted-foreground">Submitted {formatDay(checkin.submitted_at)}</p>}
        </aside>
      </div>
    </>
  )
}
