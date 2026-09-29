import type { Metadata } from 'next'
import Link from 'next/link'
import { Gauge } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { UserAvatar } from '@/components/common/user-avatar'
import { Card, CardContent } from '@/components/ui/card'
import { WorkloadBadge } from '@/features/work/components/work-badges'
import { cn, fullName } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { workloadService } from '@/server/services/workload.service'

export const metadata: Metadata = { title: 'Workload' }

/**
 * Intern workload. Organization-wide viewers (HR/Admin) see every current
 * intern; managers and mentors see the interns they guide.
 */
export default async function WorkloadPage() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'task.review')) return <AccessDenied what="workload" />
  const orgWide =
    ctx.actor.permissions.get('task.read') === 'ORGANIZATION' &&
    ctx.actor.permissions.get('intern.read') === 'ORGANIZATION'
  const rows = orgWide ? await workloadService.forAllInterns(ctx) : await workloadService.forMyInterns(ctx)

  return (
    <>
      <PageHeader
        title="Workload"
        description="Open work per intern. Levels follow transparent rules: active tasks, overdue work and estimated hours due this week."
      />
      {rows.length === 0 ? (
        <EmptyState icon={Gauge} title="No interns to show" description="Interns you manage or mentor appear here." />
      ) : (
        <Card>
          <CardContent className="pt-4">
            <div role="region" aria-label="Workload" tabIndex={0} className="overflow-x-auto">
              <table className="w-full text-small">
                <thead>
                  <tr className="border-b text-left text-caption text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Intern
                    </th>
                    <th scope="col" className="px-3 font-medium">
                      Active
                    </th>
                    <th scope="col" className="px-3 font-medium">
                      Overdue
                    </th>
                    <th scope="col" className="px-3 font-medium">
                      Due this week
                    </th>
                    <th scope="col" className="px-3 font-medium">
                      In review
                    </th>
                    <th scope="col" className="px-3 font-medium">
                      Est. hours (week)
                    </th>
                    <th scope="col" className="pl-3 font-medium">
                      Load
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.user.id} className="border-b last:border-b-0">
                      <td className="py-2.5 pr-3">
                        <Link
                          href={`/tasks?assignee=${row.user.id}`}
                          className="flex items-center gap-2 hover:underline"
                        >
                          <UserAvatar person={row.user} className="size-7" /> {fullName(row.user)}
                        </Link>
                      </td>
                      <td className="tabular px-3">{row.active}</td>
                      <td className={cn('tabular px-3', row.overdue > 0 && 'font-medium text-destructive')}>
                        {row.overdue}
                      </td>
                      <td className="tabular px-3">{row.dueThisWeek}</td>
                      <td className="tabular px-3">{row.inReview}</td>
                      <td className="tabular px-3">{row.hoursThisWeek}</td>
                      <td className="pl-3">
                        <WorkloadBadge level={row.level} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
      <p className="mt-4 text-caption text-muted-foreground">
        Overloaded: 8+ active, 3+ overdue, or over 40 estimated hours due this week. High: 5+ active, any overdue, or
        over 30 hours. Low: at most one active task and nothing overdue.
      </p>
    </>
  )
}
