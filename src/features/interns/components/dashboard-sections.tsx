import Link from 'next/link'
import { ClipboardList, GraduationCap, HeartHandshake } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { InternshipProgress, OnboardingProgress } from '@/lib/interns/progress'
import { InternshipProgressBar, OnboardingProgressBar } from './progress'

interface RelationSummary {
  total: number
  onboarding: number
  endingSoon: number
  overdueOnboarding: number
}

/** The intern's own internship on the overview page. */
export function MyInternshipCard({
  self,
}: {
  self: {
    id: string
    status: string
    title: string | null
    manager: string | null
    mentor: string | null
    progress: InternshipProgress
    onboarding: OnboardingProgress | null
  }
}) {
  const onboardingOpen = self.onboarding && !self.onboarding.complete
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            {self.title ?? 'My internship'} <StatusBadge status={self.status} />
          </CardTitle>
          <CardDescription>
            Manager: {self.manager ?? 'not assigned yet'} · Mentor: {self.mentor ?? 'not assigned yet'}
          </CardDescription>
        </div>
        <Link href={`/interns/${self.id}`} className="shrink-0 text-small font-medium text-primary hover:underline">
          View
        </Link>
      </CardHeader>
      <CardContent className="space-y-5">
        <InternshipProgressBar progress={self.progress} />
        {self.onboarding && (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-label">
              <ClipboardList className="size-4 text-primary" aria-hidden /> Onboarding
            </p>
            <OnboardingProgressBar progress={self.onboarding} />
            {onboardingOpen && (
              <Link
                href={`/interns/${self.id}/onboarding`}
                className="inline-block text-small font-medium text-primary hover:underline"
              >
                Continue your checklist
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Summary of interns the viewer manages or mentors. */
export function RelationSummaryCard({ kind, summary }: { kind: 'managed' | 'mentored'; summary: RelationSummary }) {
  const Icon = kind === 'managed' ? GraduationCap : HeartHandshake
  const href = kind === 'managed' ? '/my-interns' : '/my-mentees'
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4 text-primary" aria-hidden />
          {kind === 'managed' ? 'My interns' : 'My mentees'}
        </CardTitle>
        <Link href={href} className="text-small font-medium text-primary hover:underline">
          Open
        </Link>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-3 text-small">
          <div>
            <dt className="text-caption text-muted-foreground">Total</dt>
            <dd className="tabular text-h3">{summary.total}</dd>
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">Onboarding</dt>
            <dd className="tabular text-h3">{summary.onboarding}</dd>
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">Ending soon</dt>
            <dd className="tabular text-h3">{summary.endingSoon}</dd>
          </div>
          <div>
            <dt className="text-caption text-muted-foreground">Overdue onboarding</dt>
            <dd className={summary.overdueOnboarding > 0 ? 'tabular text-h3 text-destructive' : 'tabular text-h3'}>
              {summary.overdueOnboarding}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
