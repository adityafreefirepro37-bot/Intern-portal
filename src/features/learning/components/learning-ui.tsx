import Link from 'next/link'
import { BookOpen, Clock, Layers, Lock } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/misc'
import { parseLessonText } from '@/lib/learning/content'
import {
  DEADLINE_LABELS,
  DIFFICULTY_LABELS,
  ENROLLMENT_STATUS_LABELS,
  ENROLLMENT_TYPE_LABELS,
  formatMinutes,
  type EffectiveEnrollmentStatus,
  type LearningDeadline,
} from '@/lib/learning/rules'
import { cn, formatDay, pluralize } from '@/lib/utils'

/** Server-renderable learning building blocks (no client state). */

const DEADLINE_TONE: Record<LearningDeadline, BadgeVariant> = {
  NONE: 'outline',
  UPCOMING: 'neutral',
  DUE_SOON: 'warning',
  DUE_TODAY: 'warning',
  OVERDUE: 'destructive',
  COMPLETED: 'success',
}

export function DeadlineBadge({ deadline, due }: { deadline: LearningDeadline; due: Date | null }) {
  if (deadline === 'NONE' || deadline === 'COMPLETED') return null
  return (
    <Badge variant={DEADLINE_TONE[deadline]}>
      {DEADLINE_LABELS[deadline]}
      {due ? ` · ${formatDay(due)}` : ''}
    </Badge>
  )
}

export function EnrollmentStatusBadge({ status }: { status: EffectiveEnrollmentStatus }) {
  return <StatusBadge status={status} label={ENROLLMENT_STATUS_LABELS[status]} />
}

export interface EnrollmentCardData {
  id: string
  course_id: string
  enrollment_type: keyof typeof ENROLLMENT_TYPE_LABELS
  progress_percentage: number
  due_date: Date | null
  effectiveStatus: EffectiveEnrollmentStatus
  deadline: LearningDeadline
  course: {
    title: string
    description: string | null
    difficulty: keyof typeof DIFFICULTY_LABELS
    estimated_minutes: number | null
    is_required: boolean
    category: { name: string } | null
  }
}

/** A course the person is enrolled in: progress, type and deadline. */
export function EnrollmentCard({ enrollment }: { enrollment: EnrollmentCardData }) {
  const { course } = enrollment
  return (
    <Card className="relative flex h-full flex-col gap-3 p-5 transition-colors hover:border-ring/40">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={enrollment.enrollment_type === 'REQUIRED' ? 'warning' : 'neutral'}>
          {ENROLLMENT_TYPE_LABELS[enrollment.enrollment_type]}
        </Badge>
        {course.category && <Badge variant="outline">{course.category.name}</Badge>}
        <DeadlineBadge deadline={enrollment.deadline} due={enrollment.due_date} />
      </div>
      <h3 className="text-h3">
        <Link
          href={`/learning/courses/${enrollment.course_id}`}
          className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-xl focus-visible:after:outline-2 focus-visible:after:outline-ring"
        >
          {course.title}
        </Link>
      </h3>
      <div className="mt-auto space-y-1.5">
        <div className="flex items-center justify-between text-caption text-muted-foreground">
          <EnrollmentStatusBadge status={enrollment.effectiveStatus} />
          <span className="tabular">{enrollment.progress_percentage}%</span>
        </div>
        <Progress value={enrollment.progress_percentage} label={`${course.title} progress`} />
      </div>
    </Card>
  )
}

export interface CourseCardData {
  id: string
  title: string
  description: string | null
  difficulty: keyof typeof DIFFICULTY_LABELS
  estimated_minutes: number | null
  is_required: boolean
  category: { name: string } | null
  _count?: { lessons: number; modules?: number }
  enrollment?: { status: string; progress_percentage: number } | null
}

export function CourseCard({ course, highlight }: { course: CourseCardData; highlight?: boolean }) {
  const enrolled = course.enrollment && course.enrollment.status !== 'CANCELLED'
  return (
    <Card className={cn('relative flex h-full flex-col p-5 transition-colors hover:border-ring/40', highlight && 'ring-2 ring-ring')}>
      <span className="mb-4 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <BookOpen className="size-5" aria-hidden />
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="neutral">{DIFFICULTY_LABELS[course.difficulty]}</Badge>
        {course.is_required && <Badge variant="warning">Required</Badge>}
        {course.category && <Badge variant="outline">{course.category.name}</Badge>}
      </div>
      <h3 className="mt-3 text-h3">
        <Link
          href={`/learning/courses/${course.id}`}
          className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-xl focus-visible:after:outline-2 focus-visible:after:outline-ring"
        >
          {course.title}
        </Link>
      </h3>
      {course.description && <p className="mt-2 line-clamp-3 text-small text-muted-foreground">{course.description}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-4 pt-5 text-caption text-muted-foreground">
        {course._count && (
          <span className="flex items-center gap-1.5">
            <Layers className="size-3.5" aria-hidden /> {pluralize(course._count.lessons, 'lesson')}
          </span>
        )}
        {course.estimated_minutes ? (
          <span className="flex items-center gap-1.5">
            <Clock className="size-3.5" aria-hidden /> {formatMinutes(course.estimated_minutes)}
          </span>
        ) : null}
        {enrolled && (
          <span className="ml-auto font-medium text-primary">
            {course.enrollment!.status === 'COMPLETED' ? 'Completed' : `Enrolled · ${course.enrollment!.progress_percentage}%`}
          </span>
        )}
      </div>
    </Card>
  )
}

/** Lesson text rendered as React text nodes — never as HTML. */
export function LessonText({ text }: { text: string | null }) {
  const blocks = parseLessonText(text)
  if (!blocks.length) return <p className="text-small text-muted-foreground">This lesson has no text.</p>
  return (
    <div className="max-w-prose space-y-4 text-body leading-relaxed">
      {blocks.map((block, index) =>
        block.type === 'heading' ? (
          <h2 key={index} className="pt-2 text-h2">
            {block.text}
          </h2>
        ) : block.type === 'list' ? (
          <ul key={index} className="list-disc space-y-1.5 pl-6">
            {block.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={index}>{block.text}</p>
        ),
      )}
    </div>
  )
}

export function LockedNotice({ what = 'this lesson' }: { what?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed p-4 text-small text-muted-foreground">
      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>Complete the earlier required lessons in this course to unlock {what}.</p>
    </div>
  )
}

/** Simple horizontal bars for factual counts (no charts library). */
export function CountBars({ items, label }: { items: { label: string; value: number; href?: string | null }[]; label: string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  if (!items.length) return <p className="text-small text-muted-foreground">No data yet.</p>
  return (
    <ul aria-label={label} className="space-y-2.5">
      {items.map((item) => (
        <li key={item.label} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-small">
          {item.href ? (
            <Link href={item.href} className="truncate hover:underline">
              {item.label}
            </Link>
          ) : (
            <span className="truncate">{item.label}</span>
          )}
          <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span className="block h-full rounded-full bg-primary" style={{ width: `${(item.value / max) * 100}%` }} />
          </span>
          <span className="tabular w-10 text-right font-medium">{item.value}</span>
        </li>
      ))}
    </ul>
  )
}
