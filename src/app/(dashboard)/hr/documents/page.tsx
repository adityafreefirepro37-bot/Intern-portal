import type { Metadata } from 'next'
import Link from 'next/link'
import { BadgeCheck, CalendarClock, Download, FileClock, FileText, FileX } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { StatCard } from '@/components/common/stat-card'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { UserAvatar } from '@/components/common/user-avatar'
import { DataTable } from '@/components/tables/data-table'
import { Pagination } from '@/components/tables/pagination'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input, inputClassName } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/misc'
import { DocumentReviewActions } from '@/features/hr/components/document-review'
import { HrNav, SubTabs } from '@/features/hr/components/hr-nav'
import { hrNavItems } from '@/features/hr/nav'
import { DOCUMENT_STATUS_LABELS } from '@/lib/hr/documents'
import { formatDate, formatDay } from '@/lib/utils'
import { firstParam } from '@/lib/validation/list-params'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { documentService } from '@/server/services/document.service'

export const metadata: Metadata = { title: 'Documents · HR' }

/** CSV download (an API route, not a page). */
const EXPORT_HREF = '/api/hr/export/documents'

const STATUS_FILTERS = [
  { value: 'PENDING', label: 'Awaiting review' },
  { value: 'UPLOADED', label: 'Uploaded' },
  { value: 'UNDER_REVIEW', label: 'Under review' },
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'EXPIRED', label: 'Expired' },
]

/** Document verification queue and required-document completion across interns in scope. */
export default async function HrDocumentsPage({ searchParams }: PageProps<'/hr/documents'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'document.verify')) return <AccessDenied what="document verification" />
  const params = await searchParams
  const view = firstParam(params, 'view') === 'completion' ? 'completion' : 'queue'
  const canExport = authorizationService.can(ctx, 'document.export')
  return (
    <>
      <PageHeader
        title="Documents"
        description="Verify uploads, chase missing documents and watch expiry dates. Sensitive types are only shown to people allowed to see them."
        actions={
          canExport && (
            <a href={EXPORT_HREF} download className={buttonVariants({ variant: 'outline' })}>
              <Download aria-hidden /> Export completion CSV
            </a>
          )
        }
      />
      <HrNav items={hrNavItems(ctx)} active="/hr/documents" />
      <SubTabs
        label="Document views"
        active={view}
        items={[
          { key: 'queue', href: '/hr/documents', label: 'Documents' },
          { key: 'completion', href: '/hr/documents?view=completion', label: 'Completion by intern' },
        ]}
      />
      {view === 'queue' ? <QueueView ctx={ctx} params={params} /> : <CompletionView ctx={ctx} />}
    </>
  )
}

type Ctx = Awaited<ReturnType<typeof requirePageContext>>

async function QueueView({ ctx, params }: { ctx: Ctx; params: Record<string, string | string[] | undefined> }) {
  const [{ query, page, stats, warnDays }, types, counts] = await Promise.all([
    documentService.queue(ctx, params),
    documentService.activeTypes(ctx),
    documentService.counts(ctx),
  ])
  type Row = (typeof page.items)[number]
  const linkParams = Object.fromEntries(
    Object.entries(params).flatMap(([k, v]) => (typeof v === 'string' && k !== 'page' ? [[k, v]] : [])),
  )
  return (
    <div className="space-y-4">
      <section aria-label="Document totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Awaiting review"
          value={stats.pending}
          icon={FileClock}
          href="/hr/documents?status=PENDING"
          tone={stats.pending ? 'attention' : 'default'}
        />
        <StatCard label="Verified" value={stats.verified} icon={BadgeCheck} href="/hr/documents?status=VERIFIED" />
        <StatCard label="Rejected" value={stats.rejected} icon={FileX} href="/hr/documents?status=REJECTED" />
        <StatCard
          label={`Expiring in ${warnDays} days`}
          value={counts?.expiring ?? 0}
          icon={CalendarClock}
          href="/hr/documents?expiring=1"
        />
      </section>
      <form method="get" className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-4 sm:grid-cols-5 sm:items-end">
        <div className="col-span-2 grid gap-1.5 sm:col-span-1">
          <Label htmlFor="doc-q">Intern</Label>
          <Input id="doc-q" name="q" type="search" placeholder="Name or code" defaultValue={query.q} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="doc-status">Status</Label>
          <select id="doc-status" name="status" defaultValue={query.status ?? ''} className={inputClassName}>
            <option value="">Any</option>
            {STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="doc-type">Type</Label>
          <select id="doc-type" name="type" defaultValue={query.type ?? ''} className={inputClassName}>
            <option value="">Any</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex h-9 items-center gap-2 text-small">
          <input
            type="checkbox"
            name="expiring"
            value="1"
            defaultChecked={Boolean(query.expiring)}
            className="size-4"
          />
          Expiring soon
        </label>
        <div className="flex gap-2">
          <Button type="submit">Apply</Button>
          <Link href="/hr/documents" className={buttonVariants({ variant: 'ghost' })}>
            Clear
          </Link>
        </div>
      </form>
      <DataTable<Row>
        caption="Documents"
        rows={page.items}
        getRowId={(row) => row.id}
        empty={
          <EmptyState
            icon={FileText}
            title="No documents match"
            description="Try another status or clear the filters."
          />
        }
        columns={[
          {
            key: 'intern',
            header: 'Intern',
            cell: (row) => (
              <div className="flex min-w-44 items-center gap-3">
                <UserAvatar person={row.intern.user} className="size-8" />
                <div className="min-w-0">
                  <Link
                    href={`/interns/${row.intern.id}?tab=documents`}
                    className="block truncate font-medium hover:underline"
                  >
                    {row.internName}
                  </Link>
                  <p className="text-caption text-muted-foreground">{row.intern.employee_code}</p>
                </div>
              </div>
            ),
          },
          {
            key: 'doc',
            header: 'Document',
            cell: (row) => (
              <div className="min-w-40">
                <p className="font-medium">
                  {row.typeName}
                  {row.version > 1 && <span className="ml-1 text-caption text-muted-foreground">v{row.version}</span>}
                </p>
                <a
                  href={`/api/documents/${row.id}?inline=1`}
                  target="_blank"
                  rel="noopener"
                  className="block max-w-56 truncate text-caption text-primary hover:underline"
                >
                  {row.file_name}
                </a>
              </div>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            cell: (row) => (
              <div className="space-y-1">
                <StatusBadge status={row.status} label={DOCUMENT_STATUS_LABELS[row.status]} />
                {row.expiringSoon && <p className="text-caption text-warning">Expires {formatDay(row.expires_at)}</p>}
              </div>
            ),
          },
          {
            key: 'uploaded',
            header: 'Uploaded',
            hideBelow: 'lg',
            cell: (row) => (
              <span className="whitespace-nowrap">{formatDate(row.created_at, ctx.organization.timezone)}</span>
            ),
          },
          {
            key: 'actions',
            header: 'Review',
            cell: (row) => (
              <div className="flex flex-wrap items-center gap-2">
                <DocumentReviewActions
                  documentId={row.id}
                  status={row.status}
                  name={`${row.typeName} for ${row.internName}`}
                />
              </div>
            ),
          },
        ]}
      />
      <Pagination
        pathname="/hr/documents"
        params={linkParams}
        page={page.page}
        totalPages={page.totalPages}
        total={page.total}
        pageSize={page.pageSize}
      />
    </div>
  )
}

async function CompletionView({ ctx }: { ctx: Ctx }) {
  const { rows, stats } = await documentService.completionOverview(ctx)
  type Row = (typeof rows)[number]
  return (
    <div className="space-y-4">
      <p className="text-small text-muted-foreground">
        {stats.complete} complete · {stats.incomplete} incomplete · {stats.missing} required document
        {stats.missing === 1 ? '' : 's'} not uploaded yet. Only verified documents count as complete.
      </p>
      <DataTable<Row>
        caption="Required-document completion"
        rows={[...rows].sort((a, b) => a.completion.percent - b.completion.percent)}
        getRowId={(row) => row.id}
        empty={<EmptyState icon={FileText} title="No interns to track" />}
        columns={[
          {
            key: 'intern',
            header: 'Intern',
            cell: (row) => (
              <Link href={`/interns/${row.id}?tab=documents`} className="font-medium hover:underline">
                {row.name}
              </Link>
            ),
          },
          {
            key: 'status',
            header: 'Intern status',
            hideBelow: 'md',
            cell: (row) => <StatusBadge status={row.status} />,
          },
          {
            key: 'progress',
            header: 'Verified',
            cell: (row) => (
              <div className="min-w-36 space-y-1">
                <Progress value={row.completion.percent} label={`${row.completion.percent}% verified`} />
                <p className="text-caption text-muted-foreground">
                  {row.completion.verified}/{row.completion.required}
                </p>
              </div>
            ),
          },
          { key: 'waiting', header: 'Awaiting review', hideBelow: 'md', cell: (row) => row.completion.submitted },
          { key: 'missing', header: 'Missing', cell: (row) => row.completion.missing },
          {
            key: 'issues',
            header: 'Rejected / expired',
            hideBelow: 'lg',
            cell: (row) => `${row.completion.rejected} / ${row.completion.expired}`,
          },
        ]}
      />
    </div>
  )
}
