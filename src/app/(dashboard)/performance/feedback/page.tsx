import type { Metadata } from 'next'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { inputClassName } from '@/components/ui/input'
import { SubTabs } from '@/features/hr/components/hr-nav'
import { ConfirmActionButton } from '@/features/learning/components/confirm-action'
import { GiveFeedbackDialog, RequestFeedbackDialog } from '@/features/performance/components/performance-forms'
import { FeedbackList } from '@/features/performance/components/performance-views'
import { FEEDBACK_TYPE_LABELS } from '@/lib/performance/rules'
import { cn, formatDay, fullName } from '@/lib/utils'
import { closeFeedbackRequestAction } from '@/server/actions/performance'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { feedbackService } from '@/server/services/feedback.service'

export const metadata: Metadata = { title: 'Feedback' }

export default async function FeedbackPage({ searchParams }: PageProps<'/performance/feedback'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'feedback.read')) return <AccessDenied what="feedback" />
  const raw = await searchParams
  const params = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]))
  const data = await feedbackService.page(ctx, params)
  const interns = data.interns.map((i) => ({ id: i.id, name: fullName(i.user) }))
  const recipients = data.recipients.map((r) => ({ id: r.id, name: fullName(r) }))
  const openIncoming = data.requests.incoming.filter((r) => r.status === 'OPEN')
  const tabs = [
    ...(data.isIntern ? [{ key: 'received', href: '/performance/feedback', label: 'About me' }] : []),
    ...(data.can.give
      ? [
          { key: 'interns', href: '/performance/feedback?view=interns', label: 'My interns' },
          { key: 'given', href: '/performance/feedback?view=given', label: 'Given by me' },
        ]
      : []),
    { key: 'requests', href: '/performance/feedback?view=requests', label: 'Requests', count: openIncoming.length },
  ]

  return (
    <>
      <PageHeader
        title="Feedback"
        breadcrumbs={[{ label: 'Performance', href: '/performance' }, { label: 'Feedback' }]}
        description="Each piece of feedback has a visibility: only the people it’s shared with can see it."
        actions={
          <>
            {data.can.request && <RequestFeedbackDialog recipients={recipients} />}
            {data.can.give && interns.length > 0 && <GiveFeedbackDialog interns={interns} />}
          </>
        }
      />
      <SubTabs items={tabs} active={data.view} label="Feedback views" />

      {data.view !== 'requests' && (
        <>
          <form className="mb-4 flex flex-wrap gap-2" aria-label="Filter feedback">
            {params.view && <input type="hidden" name="view" value={params.view} />}
            <select name="type" defaultValue={params.type ?? ''} className={cn(inputClassName, 'w-44')} aria-label="Type">
              <option value="">All types</option>
              {Object.entries(FEEDBACK_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {data.view === 'interns' && interns.length > 0 && (
              <select name="internId" defaultValue={params.internId ?? ''} className={cn(inputClassName, 'w-56')} aria-label="Intern">
                <option value="">All interns</option>
                {interns.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            )}
            <input name="q" defaultValue={params.q ?? ''} placeholder="Search feedback" className={cn(inputClassName, 'w-56')} aria-label="Search feedback" />
            <button type="submit" className={buttonVariants({ variant: 'outline' })}>
              Apply
            </button>
          </form>
          <FeedbackList items={data.feedback} highlight={params.highlight} showRecipient={data.view !== 'received'} />
        </>
      )}

      {data.view === 'requests' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="mb-3 text-h3">Asked of you</h2>
            {data.requests.incoming.length === 0 ? (
              <p className="text-small text-muted-foreground">No requests.</p>
            ) : (
              <ul className="divide-y">
                {data.requests.incoming.map((r) => (
                  <li key={r.id} id={`request-${r.id}`} className={cn('space-y-2 py-3 text-small', params.highlight === r.id && 'rounded-md bg-accent/60 px-2')}>
                    <p className="whitespace-pre-line">“{r.question}”</p>
                    <div className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
                      <span>
                        {fullName(r.requester)} · {formatDay(r.created_at)}
                        {r.due_date ? ` · by ${formatDay(r.due_date)}` : ''}
                      </span>
                      <StatusBadge status={r.status} className="ml-auto" />
                    </div>
                    {r.status === 'OPEN' && (
                      <div className="flex flex-wrap gap-2">
                        {data.can.give && (
                          <GiveFeedbackDialog
                            interns={[]}
                            request={{ id: r.id, question: r.question, internId: r.intern?.id ?? null, requester: fullName(r.requester) }}
                            label="Respond"
                          />
                        )}
                        <ConfirmActionButton
                          action={closeFeedbackRequestAction}
                          fields={{ requestId: r.id, action: 'DECLINE' }}
                          title="Decline this request?"
                          description="They’ll see the request as declined."
                          size="sm"
                          variant="ghost"
                        >
                          Decline
                        </ConfirmActionButton>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 text-h3">Asked by you</h2>
            {data.requests.outgoing.length === 0 ? (
              <p className="text-small text-muted-foreground">You haven’t asked for feedback yet.</p>
            ) : (
              <ul className="divide-y">
                {data.requests.outgoing.map((r) => (
                  <li key={r.id} className="space-y-1.5 py-3 text-small">
                    <p className="whitespace-pre-line">“{r.question}”</p>
                    <div className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
                      <span>
                        To {fullName(r.recipient)} · {formatDay(r.created_at)}
                      </span>
                      <StatusBadge status={r.status} className="ml-auto" />
                      {r.status === 'OPEN' && (
                        <ConfirmActionButton
                          action={closeFeedbackRequestAction}
                          fields={{ requestId: r.id, action: 'CANCEL' }}
                          title="Cancel this request?"
                          description="The request is withdrawn."
                          size="sm"
                          variant="ghost"
                        >
                          Cancel
                        </ConfirmActionButton>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  )
}
