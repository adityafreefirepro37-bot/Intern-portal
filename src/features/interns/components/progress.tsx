import { Progress } from '@/components/ui/misc'
import type { InternshipProgress, OnboardingProgress } from '@/lib/interns/progress'
import { cn, pluralize } from '@/lib/utils'

/** Human summary of an internship's progress, computed from real dates on the server. */
export function describeInternship(progress: InternshipProgress): string {
  switch (progress.state) {
    case 'not_scheduled':
      return 'Dates not set'
    case 'upcoming':
      return `Starts in ${pluralize(progress.daysUntilStart, 'day')}`
    case 'in_progress':
      return `Day ${progress.day} of ${progress.totalDays} · ${pluralize(progress.daysRemaining, 'day')} left`
    case 'finished':
      return `Completed · ${pluralize(progress.totalDays, 'day')}`
    case 'ended_early':
      return `Ended on day ${progress.day} of ${progress.totalDays}`
  }
}

export function InternshipProgressBar({
  progress,
  compact = false,
  className,
}: {
  progress: InternshipProgress
  compact?: boolean
  className?: string
}) {
  const label = describeInternship(progress)
  return (
    <div className={cn('grid gap-1.5', className)}>
      {!compact && (
        <div className="flex items-baseline justify-between gap-2 text-small">
          <span className="text-muted-foreground">{label}</span>
          <span className="tabular font-medium">{progress.percent}%</span>
        </div>
      )}
      <Progress
        value={progress.percent}
        label={`Internship progress: ${progress.percent}% (${label})`}
        indicatorClassName={cn(
          progress.state === 'ended_early' && 'bg-destructive',
          progress.state === 'finished' && 'bg-success',
        )}
      />
      {compact && <span className="text-caption text-muted-foreground">{label}</span>}
    </div>
  )
}

export function OnboardingProgressBar({ progress, className }: { progress: OnboardingProgress; className?: string }) {
  const summary = `${progress.requiredDone} of ${progress.requiredTotal} required`
  return (
    <div className={cn('grid gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2 text-small">
        <span className="text-muted-foreground">
          {summary}
          {progress.overdue > 0 && <span className="text-destructive"> · {progress.overdue} overdue</span>}
          {progress.blocked > 0 && <span className="text-warning"> · {progress.blocked} blocked</span>}
        </span>
        <span className="tabular font-medium">{progress.percent}%</span>
      </div>
      <Progress
        value={progress.percent}
        label={`Onboarding progress: ${progress.percent}% (${summary})`}
        indicatorClassName={cn(progress.complete && 'bg-success')}
      />
    </div>
  )
}
