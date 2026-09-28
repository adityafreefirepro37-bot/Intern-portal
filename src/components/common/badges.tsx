import { ArrowDown, ArrowUp, ChevronsUp, Minus } from 'lucide-react'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { humanizeEnum } from '@/lib/utils/format'

/**
 * Status tones shared across entities (tasks, projects, interns, submissions,
 * courses, leave). Unknown statuses fall back to neutral.
 */
const STATUS_TONES: Record<string, BadgeVariant> = {
  // positive / done
  COMPLETED: 'success',
  APPROVED: 'success',
  PUBLISHED: 'success',
  PRESENT: 'success',
  ISSUED: 'success',
  // in motion
  ACTIVE: 'primary',
  IN_PROGRESS: 'primary',
  ASSIGNED: 'info',
  ONBOARDING: 'info',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'info',
  IN_REVIEW: 'info',
  // needs attention
  BLOCKED: 'destructive',
  REJECTED: 'destructive',
  TERMINATED: 'destructive',
  ABSENT: 'destructive',
  CHANGES_REQUESTED: 'warning',
  ENDING_SOON: 'warning',
  ON_HOLD: 'warning',
  PENDING: 'warning',
  LATE: 'warning',
  // idle / archived
  BACKLOG: 'neutral',
  PLANNED: 'neutral',
  SELECTED: 'neutral',
  DRAFT: 'neutral',
  CANCELLED: 'outline',
  ARCHIVED: 'outline',
  ALUMNI: 'outline',
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant={STATUS_TONES[status] ?? 'neutral'} className={className}>
      {humanizeEnum(status)}
    </Badge>
  )
}

const PRIORITIES = {
  LOW: { variant: 'neutral', Icon: ArrowDown },
  MEDIUM: { variant: 'outline', Icon: Minus },
  HIGH: { variant: 'warning', Icon: ArrowUp },
  URGENT: { variant: 'destructive', Icon: ChevronsUp },
} as const satisfies Record<string, { variant: BadgeVariant; Icon: typeof ArrowDown }>

export function PriorityBadge({ priority, className }: { priority: keyof typeof PRIORITIES; className?: string }) {
  const { variant, Icon } = PRIORITIES[priority]
  return (
    <Badge variant={variant} className={className}>
      <Icon aria-hidden />
      {humanizeEnum(priority)}
      <span className="sr-only"> priority</span>
    </Badge>
  )
}

/** Marks a feature that ships in a later implementation phase. */
export function PhaseBadge({ phase, className }: { phase: string; className?: string }) {
  return (
    <Badge variant="outline" className={className}>
      Phase {phase}
    </Badge>
  )
}
