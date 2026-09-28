import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CalendarClock, ClipboardList, GraduationCap, UserPlus, UserRoundCheck, UsersRound } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { StatCard } from '@/components/common/stat-card'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { UserAvatar } from '@/components/common/user-avatar'
import { DataTable } from '@/components/tables/data-table'
import { Pagination } from '@/components/tables/pagination'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DirectoryControls, PageSizeSelect } from '@/features/interns/components/directory-controls'
import { STATUS_LABELS, INTERN_STATUSES } from '@/lib/interns/lifecycle'
import { formatDay, fullName } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { internService } from '@/server/services/intern.service'

export const metadata: Metadata = { title: 'Interns' }

const SORTS = [
  { value: 'name', label: 'Name' },
  { value: 'joining', label: 'Joining date' },
  { value: 'end', label: 'End date' },
  { value: 'status', label: 'Status' },
  { value: 'department', label: 'Department' },
  { value: 'created', label: 'Date added' },
]

/**
 * Intern directory (HR/Admin, or department/team leads within their scope).
 * Assigned-scope viewers (managers, mentors) use /my-interns and /my-mentees.
 * Every filter is validated server-side; results are limited by scope.
 */
export default async function InternsPage({ searchParams }: PageProps<'/interns'>) {
  const ctx = await requirePageContext()
  const scope = ctx.actor.permissions.get('intern.read')
  if (!scope) {
    if (await internService.myInternId(ctx)) redirect('/my-internship')
    return <AccessDenied what="the intern directory" />
  }

  const raw = await searchParams
  const [{ query, page, stats }, options] = await Promise.all([internService.directory(ctx, raw), internService.formOptions(ctx)])
  type Row = (typeof page.items)[number]
  const canCreate = authorizationService.can(ctx, 'intern.create')
  const params = Object.fromEntries(
    Object.entries(raw).flatMap(([key, value]) => (typeof value === 'string' && key !== 'page' ? [[key, value]] : [])),
  )
  const filtered = Boolean(query.q || query.status || query.department || query.team || query.position || query.manager || query.mentor || query.joinedFrom || query.joinedTo || query.endFrom || query.endTo)

  return (
    <>
      <PageHeader
        title={scope === 'ORGANIZATION' ? 'Interns' : 'Team interns'}
        description={
          scope === 'ORGANIZATION'
            ? 'Everyone in the internship programme.'
            : 'Interns in the departments and teams you lead.'
        }
        actions={
          canCreate && (
            <Link href="/interns/new" className={buttonVariants()}>
              <UserPlus aria-hidden /> Add intern
            </Link>
          )
        }
      />

      <section aria-label="Intern totals" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Total" value={stats.total} icon={UsersRound} href="/interns" />
        <StatCard label="Active" value={stats.active} icon={UserRoundCheck} href="/interns?status=ACTIVE" />
        <StatCard label="Onboarding" value={stats.onboarding} icon={ClipboardList} href="/interns?status=ONBOARDING" />
        <StatCard
          label="Ending soon"
          value={stats.endingSoon}
          icon={CalendarClock}
          href="/interns?status=ENDING_SOON"
          tone={stats.endingSoon > 0 ? 'attention' : 'default'}
        />
        <StatCard label="Completed" value={stats.completed} icon={GraduationCap} href="/interns?status=COMPLETED" className="col-span-2 lg:col-span-1" />
      </section>

      <DirectoryControls
        statuses={INTERN_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }))}
        departments={options.departments.map((d) => ({ value: d.id, label: d.name }))}
        teams={options.teams.map((t) => ({ value: t.id, label: t.name }))}
        positions={options.positions.map((p) => ({ value: p.id, label: p.title }))}
        people={options.staff.map((s) => ({ value: s.id, label: s.name }))}
        sorts={SORTS}
      />

      {page.items.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title={filtered ? 'No interns match' : 'No interns yet'}
          description={filtered ? 'Try a different search or clear the filters.' : 'Interns appear here once they’re added to the programme.'}
          action={
            !filtered &&
            canCreate && (
              <Link href="/interns/new" className={buttonVariants()}>
                <UserPlus aria-hidden /> Add the first intern
              </Link>
            )
          }
        />
      ) : (
        <>
          {/* Mobile: cards */}
          <ul className="grid gap-3 md:hidden" aria-label="Interns">
            {page.items.map((intern) => (
              <li key={intern.id}>
                <Card className="relative p-4">
                  <div className="flex items-start gap-3">
                    <UserAvatar person={intern.user} className="size-10" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/interns/${intern.id}`} className="block truncate font-medium after:absolute after:inset-0">
                        {fullName(intern.user)}
                      </Link>
                      <p className="truncate text-caption text-muted-foreground">
                        {intern.employee_code} · {intern.position?.title ?? 'No position'}
                      </p>
                      <p className="mt-1 text-caption text-muted-foreground">
                        {formatDay(intern.joining_date)} – {formatDay(intern.expected_end_date)}
                      </p>
                    </div>
                    <StatusBadge status={intern.status} />
                  </div>
                </Card>
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <DataTable<Row>
            caption="Interns"
            className="hidden md:block"
            rows={page.items}
            getRowId={(intern) => intern.id}
            columns={[
              {
                key: 'name',
                header: 'Intern',
                cell: (intern) => (
                  <div className="flex min-w-48 items-center gap-3">
                    <UserAvatar person={intern.user} className="size-8" />
                    <div className="min-w-0">
                      <Link href={`/interns/${intern.id}`} className="block truncate font-medium hover:underline">
                        {fullName(intern.user)}
                      </Link>
                      <p className="truncate text-caption text-muted-foreground">{intern.employee_code}</p>
                    </div>
                  </div>
                ),
              },
              {
                key: 'position',
                header: 'Position',
                cell: (intern) => (
                  <div>
                    <p>{intern.position?.title ?? '—'}</p>
                    <p className="text-caption text-muted-foreground">
                      {[intern.department?.name, intern.team?.name].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                ),
              },
              { key: 'status', header: 'Status', cell: (intern) => <StatusBadge status={intern.status} /> },
              {
                key: 'dates',
                header: 'Internship',
                hideBelow: 'lg',
                cell: (intern) => (
                  <span className="whitespace-nowrap text-muted-foreground">
                    {formatDay(intern.joining_date)} – {formatDay(intern.expected_end_date)}
                  </span>
                ),
              },
              {
                key: 'people',
                header: 'Manager / Mentor',
                hideBelow: 'lg',
                cell: (intern) => (
                  <div className="text-caption">
                    <p>{intern.manager ? fullName(intern.manager) : <span className="text-muted-foreground">No manager</span>}</p>
                    <p className="text-muted-foreground">{intern.mentor ? fullName(intern.mentor) : 'No mentor'}</p>
                  </div>
                ),
              },
            ]}
          />
        </>
      )}

      <div className="mt-2 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PageSizeSelect value={page.pageSize} />
        <div className="flex-1">
          <Pagination
            pathname="/interns"
            params={params}
            page={page.page}
            totalPages={page.totalPages}
            total={page.total}
            pageSize={page.pageSize}
          />
        </div>
      </div>
    </>
  )
}
