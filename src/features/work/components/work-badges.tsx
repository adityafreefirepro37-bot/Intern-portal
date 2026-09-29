import type { SubmissionStatus } from '@prisma/client'
import { CalendarClock, CheckCircle2, OctagonAlert } from 'lucide-react'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { MILESTONE_STATUS_LABELS, type MilestoneDisplayStatus } from '@/lib/work/projects'
import { SUBMISSION_STATUS_LABELS } from '@/lib/work/submissions'
import { describeDeadline, type Deadline } from '@/lib/work/tasks'
import { WORKLOAD_LABELS, type WorkloadLevel } from '@/lib/work/workload'

/** Deadline text with a semantic tone (overdue / today / soon). */
export function DeadlineLabel({ deadline, className }: { deadline: Deadline; className?: string }) {
  const text = describeDeadline(deadline)
  if (!text) return null
  const tone =
    deadline.state === 'OVERDUE' || deadline.state === 'COMPLETED_LATE'
      ? 'text-destructive'
      : deadline.state === 'DUE_TODAY' || deadline.state === 'DUE_SOON'
        ? 'text-warning'
        : deadline.state === 'COMPLETED_ON_TIME'
          ? 'text-success'
          : 'text-muted-foreground'
  const Icon =
    deadline.state === 'OVERDUE' ? OctagonAlert : deadline.state.startsWith('COMPLETED') ? CheckCircle2 : CalendarClock
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap text-caption', tone, className)}>
      <Icon className="size-3.5" aria-hidden />
      {text}
    </span>
  )
}

const SUBMISSION_TONES: Record<SubmissionStatus, BadgeVariant> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  RESUBMITTED: 'info',
  UNDER_REVIEW: 'info',
  CHANGES_REQUESTED: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
}

export function SubmissionBadge({ status, className }: { status: SubmissionStatus | null; className?: string }) {
  if (!status) return null
  return (
    <Badge variant={SUBMISSION_TONES[status]} className={className}>
      {SUBMISSION_STATUS_LABELS[status]}
    </Badge>
  )
}

const WORKLOAD_TONES: Record<WorkloadLevel, BadgeVariant> = {
  LOW: 'neutral',
  NORMAL: 'success',
  HIGH: 'warning',
  OVERLOADED: 'destructive',
}

export function WorkloadBadge({ level }: { level: WorkloadLevel }) {
  return <Badge variant={WORKLOAD_TONES[level]}>{WORKLOAD_LABELS[level]}</Badge>
}

const MILESTONE_TONES: Record<MilestoneDisplayStatus, BadgeVariant> = {
  UPCOMING: 'neutral',
  ACTIVE: 'primary',
  COMPLETED: 'success',
  CANCELLED: 'outline',
  OVERDUE: 'destructive',
}

export function MilestoneBadge({ status }: { status: MilestoneDisplayStatus }) {
  return <Badge variant={MILESTONE_TONES[status]}>{MILESTONE_STATUS_LABELS[status]}</Badge>
}

/** One-line description of a project/task audit entry for timelines. */
export function describeActivity(action: string, metadata: Record<string, unknown>): string {
  const title = typeof metadata.title === 'string' ? `“${metadata.title}”` : 'a task'
  const label = (value: unknown) => (typeof value === 'string' ? value.replace(/_/g, ' ').toLowerCase() : '')
  switch (action) {
    case 'project.created':
      return 'created the project'
    case 'project.updated':
      return 'updated the project details'
    case 'project.status_changed':
      return `moved the project to ${label(metadata.to)}`
    case 'project.member_added':
      return metadata.previousRole
        ? `changed a member’s role to ${label(metadata.role)}`
        : `added a ${label(metadata.role)}`
    case 'project.member_removed':
      return 'removed a member'
    case 'project.file_uploaded':
      return `uploaded ${typeof metadata.fileName === 'string' ? metadata.fileName : 'a file'}`
    case 'project.file_deleted':
      return `deleted ${typeof metadata.fileName === 'string' ? metadata.fileName : 'a file'}`
    case 'milestone.created':
      return `created milestone “${metadata.name}”`
    case 'milestone.completed':
      return `completed milestone “${metadata.name}”`
    case 'milestone.updated':
      return `updated milestone “${metadata.name}”`
    case 'task.created':
      return `created ${title}`
    case 'task.updated':
      return `edited ${title}`
    case 'task.assigned':
      return `assigned ${title}`
    case 'task.unassigned':
      return `unassigned someone from ${title}`
    case 'task.status_changed':
      return `moved ${title} to ${label(metadata.to)}`
    case 'task.priority_changed':
      return `set ${title} to ${label(metadata.to)} priority`
    case 'task.deadline_changed':
      return `changed the due date of ${title}`
    case 'task.deleted':
      return `deleted ${title}`
    case 'task.commented':
      return metadata.deleted ? `deleted a comment on ${title}` : `commented on ${title}`
    case 'task.submitted':
      return `submitted ${title} for review (v${metadata.version})`
    case 'task.reviewed':
      return metadata.decision === 'APPROVED' ? `approved ${title}` : `requested changes on ${title}`
    case 'task.attachment_added':
      return `attached a file to ${title}`
    case 'task.checklist_updated':
      return `updated the checklist of ${title}`
    case 'task.dependency_changed':
      return `changed dependencies of ${title}`
    case 'task.time_logged':
      return `logged time on ${title}`
    default:
      return action.replace(/[._]/g, ' ')
  }
}
