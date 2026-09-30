import type { Metadata } from 'next'
import Link from 'next/link'
import { CalendarClock } from 'lucide-react'
import { PhaseBadge, StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { UserAvatar } from '@/components/common/user-avatar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/misc'
import { HrNav, SubTabs } from '@/features/hr/components/hr-nav'
import { OffboardingChecklist, StartOffboardingButton } from '@/features/hr/components/offboarding'
import { hrNavItems } from '@/features/hr/nav'
import { ENDING_WINDOWS } from '@/lib/hr/operations'
import { formatDay, humanizeEnum, pluralize } from '@/lib/utils'
import { firstParam } from '@/lib/validation/list-params'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { offboardingService } from '@/server/services/offboarding.service'

export const metadata: Metadata = { title: 'Ending internships · HR' }

/**
 * Internships ending within 7 / 14 / 30 days (or past their end date and
 * still active), with open work, documents and certificate status, and each
 * intern's offboarding checklist. Performance reviews arrive in Phase 06.
 */
export default async function OffboardingPage({ searchParams }: PageProps<'/hr/offboarding'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'offboarding.read')) return <AccessDenied what="offboarding" />
  const params = await searchParams
  const data = await offboardingService.endingSoon(ctx, firstParam(params, 'window'))
  const openId = firstParam(params, 'intern')
  const open = openId ? await offboardingService.checklist(ctx, openId).catch(() => null) : null
  const openRow = data.rows.find((r) => r.id === openId)

  return (
    <>
      <PageHeader
        title="Ending internships"
        description="Wrap up work, paperwork and certificates before an internship ends."
      />
      <HrNav items={hrNavItems(ctx)} active="/hr/offboarding" />
      <SubTabs
        label="Ending within"
        active={String(data.window)}
        items={ENDING_WINDOWS.map((w) => ({ key: String(w), href: `/hr/offboarding?window=${w}`, label: `${w} days` }))}
      />
      {data.rows.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Nothing ending"
          description={`No active internship ends within ${data.window} days.`}
        />
      ) : (
        <ul className="space-y-3">
          {data.rows.map((row) => (
            <li key={row.id}>
              <Card className={openId === row.id ? 'ring-2 ring-primary' : undefined}>
                <CardContent className="flex flex-col gap-4 pt-6 lg:flex-row lg:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <UserAvatar person={row.user} className="size-10" />
                    <div className="min-w-0">
                      <Link href={`/interns/${row.id}`} className="block truncate font-medium hover:underline">
                        {row.name}
                      </Link>
                      <p className="text-caption text-muted-foreground">
                        {row.code}
                        {row.department && ` · ${row.department}`}
                        {row.manager && ` · Manager: ${row.manager}`}
                      </p>
                      <p className={row.daysLeft < 0 ? 'text-caption text-destructive' : 'text-caption'}>
                        Ends {formatDay(row.endDate)} ·{' '}
                        {row.daysLeft < 0
                          ? `${pluralize(-row.daysLeft, 'day')} past the end date`
                          : row.daysLeft === 0
                            ? 'today'
                            : `in ${pluralize(row.daysLeft, 'day')}`}
                      </p>
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-small sm:grid-cols-4 lg:w-[34rem]">
                    <div>
                      <dt className="text-caption text-muted-foreground">Open tasks</dt>
                      <dd className="tabular font-medium">
                        <Link href={`/interns/${row.id}?tab=tasks`} className="hover:underline">
                          {row.openTasks}
                        </Link>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-caption text-muted-foreground">Documents</dt>
                      <dd className="tabular font-medium">
                        {row.documents.verified}/{row.documents.required} verified
                      </dd>
                    </div>
                    <div>
                      <dt className="text-caption text-muted-foreground">Review</dt>
                      <dd>
                        <PhaseBadge phase="06" />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-caption text-muted-foreground">Certificate</dt>
                      <dd>
                        {row.certificate ? (
                          <StatusBadge status={row.certificate.status} />
                        ) : (
                          <span className="text-muted-foreground">Not issued</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                  <div className="flex items-center gap-2 lg:w-44 lg:justify-end">
                    {row.checklist ? (
                      <Link
                        href={`/hr/offboarding?window=${data.window}&intern=${row.id}`}
                        className="w-full space-y-1 text-small"
                      >
                        <Progress
                          value={row.checklist.total ? Math.round((row.checklist.done / row.checklist.total) * 100) : 0}
                          label={`Offboarding ${row.checklist.done} of ${row.checklist.total} done`}
                        />
                        <span className="text-caption text-primary hover:underline">
                          Checklist {row.checklist.done}/{row.checklist.total}
                        </span>
                      </Link>
                    ) : row.canStart ? (
                      <StartOffboardingButton internId={row.id} name={row.name} />
                    ) : (
                      <span className="text-caption text-muted-foreground">Not started</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {open?.checklist && openRow && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Offboarding: {openRow.name}</CardTitle>
            <CardDescription>
              {open.checklist.completed_at
                ? `Completed ${formatDay(open.checklist.completed_at)}`
                : `Started ${formatDay(open.checklist.started_at)}`}{' '}
              · Status {humanizeEnum(openRow.status)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OffboardingChecklist items={open.checklist.items} canManage={open.canManage} />
          </CardContent>
        </Card>
      )}
    </>
  )
}
