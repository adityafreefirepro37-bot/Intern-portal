import Link from 'next/link'
import { BookOpen, CalendarCheck, CheckSquare, ClipboardList, MessageSquareHeart, Target } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/misc'
import {
  FEEDBACK_CONTEXT_LABELS,
  FEEDBACK_TYPE_LABELS,
  FEEDBACK_VISIBILITY_LABELS,
  GOAL_CATEGORY_LABELS,
  GOAL_STATUS_LABELS,
} from '@/lib/performance/rules'
import { cn, formatDay, fullName } from '@/lib/utils'
import type { FeedbackItem } from '@/server/services/feedback.service'
import type { GoalList } from '@/server/services/goal.service'
import type { PerformanceEvidence, PerformanceTimeline } from '@/server/services/performance-dashboard.service'
import { EditFeedbackDialog } from './performance-forms'

/** Evidence groups: every number links to the records it counts. */
export function EvidenceGroups({ evidence }: { evidence: PerformanceEvidence }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {evidence.groups.map((group) => (
        <Card key={group.title} className="p-5">
          <h3 className="mb-3 text-h3">{group.title}</h3>
          <ul className="divide-y text-small">
            {group.metrics.map((m) => (
              <li key={m.label} className="flex items-center justify-between gap-3 py-2">
                {m.href ? (
                  <Link href={m.href} className="hover:underline">
                    {m.label}
                  </Link>
                ) : (
                  <span>{m.label}</span>
                )}
                <span className="tabular font-semibold">{m.value}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  )
}

const TIMELINE_ICONS = {
  task: CheckSquare,
  course: BookOpen,
  goal: Target,
  checkin: CalendarCheck,
  feedback: MessageSquareHeart,
  review: ClipboardList,
} as const

export function PerformanceTimelineList({ timeline }: { timeline: PerformanceTimeline }) {
  if (!timeline.events.length) return <p className="text-small text-muted-foreground">Nothing recorded yet.</p>
  return (
    <ol className="relative space-y-4 border-l pl-6">
      {timeline.events.map((event, index) => {
        const Icon = TIMELINE_ICONS[event.kind]
        return (
          <li key={`${event.href}-${index}`} className="relative">
            <span className="absolute -left-[2.05rem] flex size-6 items-center justify-center rounded-full border bg-card text-primary">
              <Icon className="size-3.5" aria-hidden />
            </span>
            <Link href={event.href} className="text-small font-medium hover:underline">
              {event.title}
            </Link>
            <p className="text-caption text-muted-foreground">{formatDay(event.at)}</p>
          </li>
        )
      })}
    </ol>
  )
}

export function FeedbackList({ items, highlight, showRecipient }: { items: FeedbackItem[]; highlight?: string; showRecipient?: boolean }) {
  if (!items.length) return <p className="text-small text-muted-foreground">No feedback to show.</p>
  return (
    <ul className="grid gap-3">
      {items.map((f) => (
        <li key={f.id} id={`feedback-${f.id}`}>
          <Card className={cn('space-y-2 p-4', highlight === f.id && 'ring-2 ring-ring')}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={f.feedback_type === 'POSITIVE' ? 'success' : f.feedback_type === 'DEVELOPMENTAL' ? 'info' : 'neutral'}>
                {FEEDBACK_TYPE_LABELS[f.feedback_type]}
              </Badge>
              <Badge variant="outline">{FEEDBACK_VISIBILITY_LABELS[f.visibility].split(' (')[0]}</Badge>
              {f.context && (
                <Link href={f.context.href} className="text-caption text-primary hover:underline">
                  {FEEDBACK_CONTEXT_LABELS[f.context_type]}: {f.context.title}
                </Link>
              )}
              <span className="ml-auto text-caption text-muted-foreground">
                {formatDay(f.created_at)}
                {f.edited_at ? ' · edited' : ''}
              </span>
            </div>
            <p className="whitespace-pre-line text-small">{f.body}</p>
            <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-muted-foreground">
              <span>
                From {fullName(f.from_user)}
                {showRecipient ? ` to ${fullName(f.to_user)}` : ''}
              </span>
              {f.canEdit && (
                <EditFeedbackDialog feedback={{ id: f.id, body: f.body, feedback_type: f.feedback_type, visibility: f.visibility }} />
              )}
            </div>
          </Card>
        </li>
      ))}
    </ul>
  )
}

export function GoalCards({ goals, showIntern }: { goals: GoalList['goals']; showIntern?: boolean }) {
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {goals.map((g) => (
        <li key={g.id}>
          <Card className="relative space-y-2 p-4 transition-colors hover:border-ring/40">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={g.status} label={GOAL_STATUS_LABELS[g.status]} />
              <Badge variant="outline">{GOAL_CATEGORY_LABELS[g.category]}</Badge>
              {g.overdue && <StatusBadge status="OVERDUE" label="Past target date" />}
            </div>
            <h3 className="font-medium">
              <Link
                href={`/performance/goals/${g.id}`}
                className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-xl focus-visible:after:outline-2 focus-visible:after:outline-ring"
              >
                {g.title}
              </Link>
            </h3>
            <Progress value={g.progress} label={`${g.title} progress`} />
            <p className="text-caption text-muted-foreground">
              {g.progress}%{g.target_date ? ` · target ${formatDay(g.target_date)}` : ''}
              {g._count.evidence ? ` · ${g._count.evidence} evidence` : ''}
              {showIntern ? ` · ${fullName(g.intern.user)}` : ''}
            </p>
          </Card>
        </li>
      ))}
    </ul>
  )
}
