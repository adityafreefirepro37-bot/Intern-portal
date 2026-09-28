import Link from 'next/link'
import { UsersRound } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { EmptyState } from '@/components/common/states'
import { UserAvatar } from '@/components/common/user-avatar'
import { Card } from '@/components/ui/card'
import type { InternshipProgress, OnboardingProgress } from '@/lib/interns/progress'
import { fullName } from '@/lib/utils'
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
  progress: InternshipProgress
  onboarding: OnboardingProgress | null
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
              <div className="flex justify-between gap-2 text-caption text-muted-foreground">
                <span>
                  {relation === 'managed' ? 'Mentor' : 'Manager'}: {other ? fullName(other) : 'not assigned'}
                </span>
                {intern.onboarding && intern.status === 'ONBOARDING' && (
                  <span className={intern.onboarding.overdue > 0 ? 'text-destructive' : undefined}>
                    Onboarding {intern.onboarding.percent}%
                  </span>
                )}
              </div>
            </Card>
          </li>
        )
      })}
    </ul>
  )
}
