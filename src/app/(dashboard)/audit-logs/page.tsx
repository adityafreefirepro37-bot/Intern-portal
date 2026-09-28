import type { Metadata } from 'next'
import { ScrollText } from 'lucide-react'
import { z } from 'zod'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { DataTable } from '@/components/tables/data-table'
import { Pagination } from '@/components/tables/pagination'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { inputClassName } from '@/components/ui/input'
import { fullName, humanizeEnum } from '@/lib/utils'
import { isoDateSchema } from '@/lib/validation'
import { firstParam, readListParams } from '@/lib/validation/list-params'
import { requirePageContext } from '@/server/context'
import { AUDIT_ACTIONS } from '@/server/services/audit-actions'
import { auditService } from '@/server/services/audit.service'
import { authorizationService } from '@/server/services/authorization.service'

export const metadata: Metadata = { title: 'Audit Logs' }

const STATUS_TONE: Record<string, BadgeVariant> = { SUCCESS: 'success', FAILURE: 'warning', DENIED: 'destructive' }

const filterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  action: z
    .string()
    .max(80)
    .regex(/^[a-z_]+\.[a-z_]+$/)
    .optional(),
  actor: z.uuid().optional(),
  status: z.enum(['SUCCESS', 'FAILURE', 'DENIED']).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
})

export default async function AuditLogsPage({ searchParams }: PageProps<'/audit-logs'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'audit_log.read')) return <AccessDenied what="audit logs" />

  const params = await searchParams
  const { pagination } = readListParams(params, { pageSize: 25 })
  // Untrusted URL input: anything malformed is simply ignored.
  const parsed = filterSchema.safeParse(
    Object.fromEntries(
      ['q', 'action', 'actor', 'status', 'from', 'to'].map((key) => [key, firstParam(params, key) || undefined]),
    ),
  )
  const filter = parsed.success ? parsed.data : {}
  const to = filter.to ? new Date(`${filter.to}T00:00:00Z`) : undefined
  if (to) to.setUTCDate(to.getUTCDate() + 1)

  const [page, actors] = await Promise.all([
    auditService.listPage(ctx, pagination, {
      search: filter.q,
      action: filter.action,
      actorUserId: filter.actor,
      status: filter.status,
      from: filter.from ? new Date(`${filter.from}T00:00:00Z`) : undefined,
      to,
    }),
    auditService.listActors(ctx),
  ])
  type Row = (typeof page.items)[number]
  const dateTime = new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: ctx.organization.timezone,
  })
  const raw = { ...filter, page: pagination.page > 1 ? String(pagination.page) : undefined }

  return (
    <>
      <PageHeader
        title="Audit Logs"
        description="Append-only record of sign-ins, access denials and administrative changes, written by the server."
      />

      <form
        role="search"
        aria-label="Filter audit log"
        className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[1fr_12rem_12rem_9rem_9.5rem_9.5rem_auto]"
      >
        <input
          name="q"
          type="search"
          placeholder="Search actor, action, IP…"
          defaultValue={filter.q}
          aria-label="Search audit log"
          className={inputClassName}
        />
        <select name="action" defaultValue={filter.action ?? ''} aria-label="Action" className={inputClassName}>
          <option value="">All actions</option>
          {Object.values(AUDIT_ACTIONS).map((action) => (
            <option key={action} value={action}>
              {action}
            </option>
          ))}
        </select>
        <select name="actor" defaultValue={filter.actor ?? ''} aria-label="Actor" className={inputClassName}>
          <option value="">All actors</option>
          {actors.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {fullName(actor)}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={filter.status ?? ''} aria-label="Status" className={inputClassName}>
          <option value="">Any status</option>
          <option value="SUCCESS">Success</option>
          <option value="FAILURE">Failure</option>
          <option value="DENIED">Denied</option>
        </select>
        <input name="from" type="date" defaultValue={filter.from} aria-label="From date" className={inputClassName} />
        <input name="to" type="date" defaultValue={filter.to} aria-label="To date" className={inputClassName} />
        <Button type="submit" variant="outline">
          Apply
        </Button>
      </form>

      <DataTable<Row>
        caption="Audit log entries, newest first"
        rows={page.items}
        getRowId={(entry) => entry.id}
        empty={<EmptyState icon={ScrollText} title="No matching events" description="Try widening the filters." />}
        columns={[
          {
            key: 'time',
            header: 'Time',
            cell: (entry) => (
              <time dateTime={entry.created_at.toISOString()} className="whitespace-nowrap text-muted-foreground">
                {dateTime.format(entry.created_at)}
              </time>
            ),
          },
          {
            key: 'actor',
            header: 'Actor',
            cell: (entry) =>
              entry.actor ? fullName(entry.actor) : <span className="text-muted-foreground">System / anonymous</span>,
          },
          {
            key: 'action',
            header: 'Action',
            cell: (entry) => (
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-caption">{entry.action}</code>
            ),
          },
          {
            key: 'resource',
            header: 'Resource',
            hideBelow: 'md',
            cell: (entry) => <Badge variant="neutral">{humanizeEnum(entry.resource_type)}</Badge>,
          },
          {
            key: 'status',
            header: 'Status',
            cell: (entry) => (
              <Badge variant={STATUS_TONE[entry.status] ?? 'neutral'}>{humanizeEnum(entry.status)}</Badge>
            ),
          },
          {
            key: 'ip',
            header: 'IP',
            hideBelow: 'lg',
            cell: (entry) => (
              <span className="font-mono text-caption text-muted-foreground">{entry.ip_address ?? '—'}</span>
            ),
          },
        ]}
      />
      <Pagination
        pathname="/audit-logs"
        params={raw}
        page={page.page}
        totalPages={page.totalPages}
        total={page.total}
        pageSize={page.pageSize}
      />
    </>
  )
}
