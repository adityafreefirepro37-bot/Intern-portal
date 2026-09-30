import Link from 'next/link'
import { Inbox } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { RelativeTime } from '@/components/common/relative-time'
import { EmptyState } from '@/components/common/states'
import { DataTable, type Column } from '@/components/tables/data-table'
import { HR_REQUEST_CATEGORY_LABELS, HR_REQUEST_STATUS_LABELS } from '@/lib/hr/requests'
import type { HrRequestList } from '@/server/services/hr-request.service'

type Row = HrRequestList['page']['items'][number]

/** HR requests table; `showRequester` for the HR queue. */
export function RequestTable({
  rows,
  showRequester,
  emptyText,
}: {
  rows: Row[]
  showRequester: boolean
  emptyText: string
}) {
  const columns: Column<Row>[] = [
    {
      key: 'subject',
      header: 'Request',
      cell: (row) => (
        <div className="min-w-48">
          <Link href={`/requests/${row.id}`} className="font-medium hover:underline">
            {row.subject}
          </Link>
          <p className="text-caption text-muted-foreground">
            {HR_REQUEST_CATEGORY_LABELS[row.category]}
            {showRequester && ` · ${row.requesterName}`}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <StatusBadge
          status={row.status}
          label={
            row.status === 'WAITING_FOR_USER' && showRequester
              ? 'Waiting for requester'
              : HR_REQUEST_STATUS_LABELS[row.status]
          }
        />
      ),
    },
  ]
  if (showRequester) {
    columns.push({ key: 'assignee', header: 'Assigned to', hideBelow: 'md', cell: (row) => row.assigneeName ?? '—' })
  }
  columns.push({
    key: 'activity',
    header: 'Updated',
    hideBelow: 'md',
    cell: (row) => (
      <span className="whitespace-nowrap text-muted-foreground">
        <RelativeTime date={row.updated_at} />
        {row._count.comments > 0 && ` · ${row._count.comments} ${row._count.comments === 1 ? 'reply' : 'replies'}`}
      </span>
    ),
  })
  return (
    <DataTable<Row>
      caption="HR requests"
      rows={rows}
      getRowId={(row) => row.id}
      empty={<EmptyState icon={Inbox} title="No requests" description={emptyText} />}
      columns={columns}
    />
  )
}
