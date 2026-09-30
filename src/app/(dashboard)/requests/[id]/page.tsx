import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { FileText } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RequestControls, RequestThread } from '@/features/hr/components/hr-requests'
import { Detail } from '@/features/interns/components/profile-view'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { HR_REQUEST_CATEGORY_LABELS, HR_REQUEST_STATUS_LABELS } from '@/lib/hr/requests'
import { formatDate, fullName } from '@/lib/utils'
import { idSchema } from '@/lib/validation'
import { requirePageContext } from '@/server/context'
import { hrRequestService } from '@/server/services/hr-request.service'

export const metadata: Metadata = { title: 'Request' }

/** One HR request: details, files, conversation and (for HR) workflow controls. Others' requests are 404. */
export default async function RequestPage({ params }: PageProps<'/requests/[id]'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  if (!idSchema.safeParse(id).success) notFound()
  let request: Awaited<ReturnType<typeof hrRequestService.get>>
  try {
    request = await hrRequestService.get(ctx, id)
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    if (error instanceof ForbiddenError) return <AccessDenied what="HR requests" />
    throw error
  }
  const tz = ctx.organization.timezone
  const statusLabel =
    request.status === 'WAITING_FOR_USER' && !request.isRequester
      ? 'Waiting for requester'
      : HR_REQUEST_STATUS_LABELS[request.status]
  return (
    <>
      <PageHeader
        title={request.subject}
        breadcrumbs={[
          request.can.manage
            ? { label: 'HR requests', href: '/hr/requests' }
            : { label: 'My requests', href: '/requests' },
          { label: request.subject },
        ]}
        actions={<StatusBadge status={request.status} label={statusLabel} />}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{HR_REQUEST_CATEGORY_LABELS[request.category]}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="whitespace-pre-line text-small">{request.description}</p>
              {request.attachments.length > 0 && (
                <ul className="space-y-1">
                  {request.attachments.map((file) => (
                    <li key={file.id}>
                      <a
                        href={`/api/hr-requests/attachments/${file.id}`}
                        className="inline-flex items-center gap-2 text-small text-primary hover:underline"
                      >
                        <FileText className="size-4" aria-hidden /> {file.file_name}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {request.resolution && (
                <p className="rounded-lg bg-muted p-3 text-small">
                  <span className="font-medium">Outcome: </span>
                  {request.resolution}
                </p>
              )}
            </CardContent>
          </Card>
          <section aria-labelledby="thread-title" className="space-y-3">
            <h2 id="thread-title" className="text-h3">
              Conversation
            </h2>
            <RequestThread requestId={request.id} comments={request.comments} canComment={request.can.comment} />
          </section>
        </div>
        <div className="space-y-6">
          <Card>
            <CardContent className="pt-6">
              <dl className="grid gap-4">
                <Detail label="Requested by" value={request.requesterName} />
                <Detail label="Raised" value={formatDate(request.created_at, tz)} />
                <Detail label="Assigned to" value={request.assignee ? fullName(request.assignee) : null} />
                {request.resolved_at && <Detail label="Closed" value={formatDate(request.resolved_at, tz)} />}
              </dl>
            </CardContent>
          </Card>
          {(request.can.manage || request.can.cancel) && (
            <Card>
              <CardContent className="pt-6">
                <RequestControls
                  requestId={request.id}
                  targets={[...request.targets]}
                  statusLabels={HR_REQUEST_STATUS_LABELS}
                  handlers={request.handlers}
                  assigneeId={request.assigned_to}
                  canManage={request.can.manage}
                  canCancel={request.can.cancel}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
