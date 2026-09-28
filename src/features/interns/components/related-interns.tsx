import Link from 'next/link'
import { UsersRound } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { EmptyState } from '@/components/common/states'
import { UserAvatar } from '@/components/common/user-avatar'
import { Card } from '@/components/ui/card'
import type { InternshipProgress, OnboardingProgress } from '@/lib/interns/progress'
import { formatDay, fullName, pluralize } from '@/lib/utils'
import { InternshipProgressBar } from './progress'

type Person = { id: string; first_name: string; last_name: string; display_name: string | null; avatar_url: string | null }

export interface RelatedIntern {
  id: string
  employee_code: string
  status: string
  user: Person
  position: { title: string } | null
  department: { name: string } | null
  manager: Person | null
  mentor: Person | null
  expected_end_date?: Date | null
  progress: InternshipProgress
  onboarding: OnboardingProgress | null
  /** Open tasks assigned to the intern; null when the viewer can't read tasks. */
  openTasks?: number | null
}

/** Cards for My Interns / My Mentees. */
export function RelatedInternGrid({ interns, relation }: { interns: RelatedIntern[]; relation: 'managed' | 'mentored' }) {
  if (interns.length === 0) {
    return (
      <EmptyState
        icon={UsersRound}
        title={relation === 'managed' ? 'No interns assigned to you' : 'No mentees yet'}
        description="HR assigns managers and mentors from the intern’s profile."
      />
    )
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {interns.map((intern) => {
        const other = relation === 'managed' ? intern.mentor : intern.manager
        return (
          <li key={intern.id}>
            <Card className="relative h-full space-y-4 p-5 transition-colors hover:border-ring/40">
              <div className="flex items-start gap-3">
                <UserAvatar person={intern.user} className="size-11" />
                <div className="min-w-0 flex-1">
                  <Link href={`/interns/${intern.id}`} className="block truncate font-medium after:absolute after:inset-0">
                    {fullName(intern.user)}
                  </Link>
                  <p className="truncate text-caption text-muted-foreground">
                    {intern.position?.title ?? 'Intern'} · {intern.department?.name ?? '—'}
                  </p>
                </div>
                <StatusBadge status={intern.status} />
              </div>
              <InternshipProgressBar progress={intern.progress} compact />
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-caption">
                <div>
                  <dt className="text-muted-foreground">{relation === 'managed' ? 'Mentor' : 'Manager'}</dt>
                  <dd>{other ? fullName(other) : 'Not assigned'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Internship ends</dt>
                  <dd>{intern.expected_end_date ? formatDay(intern.expected_end_date) : '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Onboarding</dt>
                  <dd className={intern.onboarding && intern.onboarding.overdue > 0 ? 'text-destructive' : undefined}>
                    {intern.onboarding
                      ? `${intern.onboarding.percent}%${intern.onboarding.overdue > 0 ? ` · ${intern.onboarding.overdue} overdue` : ''}`
                      : 'Not started'}
                  </dd>
                </div>
                {intern.openTasks !== undefined && intern.openTasks !== null && (
                  <div>
                    <dt className="text-muted-foreground">Current work</dt>
                    <dd>{pluralize(intern.openTasks, 'open task')}</dd>
                  </div>
                )}
                {relation === 'mentored' && (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Learning progress</dt>
                    <dd className="text-muted-foreground">Available when the Learning Hub launches (Phase 06)</dd>
                  </div>
                )}
              </dl>
            </Card>
          </li>
        )
      })}
    </ul>
  )
}
