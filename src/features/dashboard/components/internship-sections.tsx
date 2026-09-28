import Link from 'next/link'
import {
  CalendarClock,
  CalendarPlus,
  ClipboardList,
  GraduationCap,
  OctagonAlert,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { StatCard } from '@/components/common/stat-card'
import { UserAvatar } from '@/components/common/user-avatar'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InternshipProgressBar, OnboardingProgressBar } from '@/features/interns/components/progress'
import type { RelatedIntern } from '@/features/interns/components/related-interns'
import { formatDay, fullName, pluralize } from '@/lib/utils'
import type { DashboardOverview } from '@/server/services/dashboard.service'

type Internship = DashboardOverview['internship']

/** HR/Admin: programme headline figures (all from the database). */
export function ProgrammeStats({ programme }: { programme: NonNullable<Internship['programme']> }) {
  return (
    <section aria-labelledby="programme-heading" className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="programme-heading" className="text-h2">
          Internship programme
        </h2>
        <Link href="/hr" className="text-small font-medium text-primary hover:underline">
          HR dashboard
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total interns" value={programme.total} icon={UsersRound} href="/interns" />
        <StatCard label="Active" value={programme.active} icon={UserRoundCheck} href="/interns?status=ACTIVE" />
        <StatCard
          label="Onboarding"
          value={programme.onboarding}
          icon={ClipboardList}
          href="/interns?status=ONBOARDING"
        />
        <StatCard
          label="Ending soon"
          value={programme.endingSoon}
          icon={CalendarClock}
          href="/interns?status=ENDING_SOON"
          tone={programme.endingSoon > 0 ? 'attention' : 'default'}
        />
        <StatCard label="Upcoming joins" value={programme.upcomingJoins} icon={CalendarPlus} hint="Next 30 days" />
        {programme.onboardingOverdue !== null ? (
          <StatCard
            label="Onboarding overdue"
            value={programme.onboardingOverdue}
            icon={OctagonAlert}
            href="/onboarding?state=OVERDUE"
            tone={programme.onboardingOverdue > 0 ? 'attention' : 'default'}
          />
        ) : (
          <StatCard
            label="Completed"
            value={programme.completed}
            icon={GraduationCap}
            href="/interns?status=COMPLETED"
          />
        )}
      </div>
    </section>
  )
}

const ENDING_WINDOW_DAYS = 30

/** Managers and mentors: their interns with progress, most urgent end dates first. */
export function RelatedInternsCard({
  interns,
  relation,
}: {
  interns: (RelatedIntern & { expected_end_date: Date | null; openTasks: number | null })[]
  relation: 'managed' | 'mentored'
}) {
  const current = interns.filter((intern) => !['COMPLETED', 'ALUMNI', 'TERMINATED'].includes(intern.status))
  const ending = current.filter(
    (intern) => intern.progress.state === 'in_progress' && intern.progress.daysRemaining <= ENDING_WINDOW_DAYS,
  ).length
  const shown = current.slice(0, 5)
  const title = relation === 'managed' ? 'My interns' : 'My mentees'
  const href = relation === 'managed' ? '/my-interns' : '/my-mentees'

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>
            {title} <span className="tabular text-muted-foreground">({current.length})</span>
          </CardTitle>
          <CardDescription>
            {ending > 0
              ? `${pluralize(ending, 'internship')} ending in the next ${ENDING_WINDOW_DAYS} days`
              : 'No internships ending in the next 30 days'}
          </CardDescription>
        </div>
        <Link href={href} className="shrink-0 text-small font-medium text-primary hover:underline">
          View all
        </Link>
      </CardHeader>
      <CardContent>
        {shown.length === 0 ? (
          <p className="py-4 text-center text-small text-muted-foreground">
            {relation === 'managed'
              ? 'You currently don’t have any interns assigned to you.'
              : 'You don’t have any current mentees.'}
          </p>
        ) : (
          <ul className="divide-y">
            {shown.map((intern) => (
              <li key={intern.id} className="grid gap-2 py-3">
                <div className="flex items-center gap-3">
                  <UserAvatar person={intern.user} className="size-8" />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/interns/${intern.id}`}
                      className="block truncate text-small font-medium hover:underline"
                    >
                      {fullName(intern.user)}
                    </Link>
                    <p className="truncate text-caption text-muted-foreground">
                      {intern.position?.title ?? 'Intern'}
                      {intern.expected_end_date && ` · Ends ${formatDay(intern.expected_end_date)}`}
                      {intern.openTasks !== null && ` · ${pluralize(intern.openTasks, 'open task')}`}
                    </p>
                  </div>
                  <StatusBadge status={intern.status} />
                </div>
                <InternshipProgressBar progress={intern.progress} compact />
                {intern.onboarding && !intern.onboarding.complete && (
                  <p
                    className={
                      intern.onboarding.overdue > 0
                        ? 'text-caption text-destructive'
                        : 'text-caption text-muted-foreground'
                    }
                  >
                    Onboarding {intern.onboarding.percent}% ({intern.onboarding.requiredDone}/
                    {intern.onboarding.requiredTotal} required
                    {intern.onboarding.overdue > 0 && `, ${intern.onboarding.overdue} overdue`})
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/** Interns: their own internship at a glance. */
export function MyInternshipCard({ self }: { self: NonNullable<Internship['self']> }) {
  const onboardingOpen = self.onboarding && !self.onboarding.completedAt
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="flex flex-wrap items-center gap-2">
            My internship <StatusBadge status={self.status} />
          </CardTitle>
          <CardDescription>
            {[self.position, self.department].filter(Boolean).join(' · ') || 'Placement not set'}
            <span className="font-mono"> · {self.employeeCode}</span>
          </CardDescription>
        </div>
        <Link href={`/interns/${self.id}`} className="shrink-0 text-small font-medium text-primary hover:underline">
          Profile
        </Link>
      </CardHeader>
      <CardContent className="grid gap-5">
        <InternshipProgressBar progress={self.progress} />
        {self.onboarding && (
          <div className="grid gap-2">
            <h3 className="text-small font-medium">{onboardingOpen ? 'Onboarding progress' : 'Onboarding complete'}</h3>
            <OnboardingProgressBar progress={self.onboarding.progress} />
            {onboardingOpen && (
              <Link
                href={`/interns/${self.id}/onboarding`}
                className={buttonVariants({ size: 'sm', className: 'w-fit' })}
              >
                Continue onboarding
              </Link>
            )}
          </div>
        )}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-small">
          <div>
            <dt className="text-caption text-muted-foreground">Manager</dt>
            <dd>{self.manager ?? 'Not assigned yet'}</dd>
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">Mentor</dt>
            <dd>{self.mentor ?? 'Not assigned yet'}</dd>
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">Joining date</dt>
            <dd>{self.joiningDate ? formatDay(self.joiningDate) : '—'}</dd>
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">End date</dt>
            <dd>{self.expectedEndDate ? formatDay(self.expectedEndDate) : '—'}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
