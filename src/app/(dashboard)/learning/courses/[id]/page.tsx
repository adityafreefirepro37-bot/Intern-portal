import type { Metadata } from 'next'
import Link from 'next/link'
import { CheckCircle2, CircleDashed, ClipboardList, FileQuestion, Lock, Pencil } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/misc'
import { AssignDialog, EnrollButton } from '@/features/learning/components/learner-actions'
import { DeadlineBadge, EnrollmentStatusBadge } from '@/features/learning/components/learning-ui'
import { CONTENT_TYPE_LABELS, DIFFICULTY_LABELS, ENROLLMENT_TYPE_LABELS, formatMinutes } from '@/lib/learning/rules'
import { SUBMISSION_STATUS_LABELS } from '@/lib/work/submissions'
import { cn, formatDay, pluralize } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { learningService, type CourseView } from '@/server/services/learning.service'

export const metadata: Metadata = { title: 'Course' }

type ModuleView = CourseView['modules'][number]

export default async function CoursePage({ params }: PageProps<'/learning/courses/[id]'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  const view = await learningService.courseView(ctx, id)
  const { course, enrollment, completion, can } = view
  const people = can.assign ? await learningService.assignablePeople(ctx) : []
  const lessonCount = view.modules.reduce((sum, m) => sum + m.lessons.length, 0)

  return (
    <>
      <PageHeader
        title={course.title}
        breadcrumbs={[{ label: 'Learning Hub', href: '/learning' }, { label: course.title }]}
        description={course.description ?? undefined}
        actions={
          <>
            {can.author && (
              <Link href={`/learning/manage/courses/${course.id}`} className={buttonVariants({ variant: 'outline' })}>
                <Pencil aria-hidden /> Edit course
              </Link>
            )}
            {can.assign && <AssignDialog kind="course" targetId={course.id} title={course.title} people={people} />}
            {can.enroll && <EnrollButton courseId={course.id} />}
            {view.nextLessonId && can.learn && (
              <Link href={`/learning/courses/${course.id}/lessons/${view.nextLessonId}`} className={buttonVariants()}>
                {enrollment?.progress_percentage ? 'Continue' : 'Start course'}
              </Link>
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {view.modules.map((module, index) => (
            <ModuleCard key={module.id} module={module} index={index} courseId={course.id} enrolled={Boolean(enrollment)} />
          ))}
          {(view.finalQuizzes.length > 0 || view.finalAssignments.length > 0) && (
            <Card className="p-5">
              <h2 className="text-h3">Final assessment</h2>
              <ItemList quizzes={view.finalQuizzes} assignments={view.finalAssignments} enrolled={Boolean(enrollment)} />
            </Card>
          )}
          {view.modules.length === 0 && <p className="text-small text-muted-foreground">This course has no content yet.</p>}
        </div>
        <aside className="space-y-4">
          <Card className="space-y-3 p-5">
            <h2 className="text-h3">About this course</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-small">
              <dt className="text-muted-foreground">Difficulty</dt>
              <dd>{DIFFICULTY_LABELS[course.difficulty]}</dd>
              {course.category && (
                <>
                  <dt className="text-muted-foreground">Category</dt>
                  <dd>{course.category.name}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Lessons</dt>
              <dd>{lessonCount}</dd>
              {course.estimated_minutes ? (
                <>
                  <dt className="text-muted-foreground">Time</dt>
                  <dd>{formatMinutes(course.estimated_minutes)}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Order</dt>
              <dd>{course.is_sequential ? 'Lessons unlock in order' : 'Any order'}</dd>
            </dl>
            <p className="text-caption text-muted-foreground">
              Completing it needs every required lesson
              {course.require_quizzes ? ', passing the required quizzes' : ''}
              {course.require_assignments ? ' and approved required assignments' : ''}.
            </p>
            {course.status !== 'PUBLISHED' && <StatusBadge status={course.status} />}
          </Card>
          {enrollment && (
            <Card className="space-y-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-h3">Your progress</h2>
                <EnrollmentStatusBadge status={enrollment.effectiveStatus} />
              </div>
              <Progress value={enrollment.progress_percentage} label="Course progress" />
              <p className="text-small">
                <span className="tabular font-medium">{enrollment.progress_percentage}%</span>
                {completion && !completion.complete && (
                  <span className="text-muted-foreground"> · {remainingText(completion.remaining)}</span>
                )}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="neutral">{ENROLLMENT_TYPE_LABELS[enrollment.enrollment_type]}</Badge>
                <DeadlineBadge deadline={enrollment.deadline} due={enrollment.due_date} />
              </div>
              {enrollment.completed_at && (
                <p className="text-caption text-muted-foreground">Completed {formatDay(enrollment.completed_at)}</p>
              )}
            </Card>
          )}
        </aside>
      </div>
    </>
  )
}

function remainingText(remaining: { lessons: number; quizzes: number; assignments: number }) {
  const parts = [
    remaining.lessons ? pluralize(remaining.lessons, 'lesson') : null,
    remaining.quizzes ? pluralize(remaining.quizzes, 'quiz', 'quizzes') : null,
    remaining.assignments ? pluralize(remaining.assignments, 'assignment') : null,
  ].filter(Boolean)
  return parts.length ? `${parts.join(', ')} to go` : 'almost there'
}

function ModuleCard({ module, index, courseId, enrolled }: { module: ModuleView; index: number; courseId: string; enrolled: boolean }) {
  return (
    <Card className="p-5">
      <h2 className="text-h3">
        <span className="text-muted-foreground">Module {index + 1} · </span>
        {module.title}
      </h2>
      {module.description && <p className="mt-1 text-small text-muted-foreground">{module.description}</p>}
      <ol className="mt-4 divide-y rounded-lg border">
        {module.lessons.map((lesson) => (
          <li key={lesson.id} className="flex items-center gap-3 px-3 py-2.5 text-small">
            {lesson.completed ? (
              <CheckCircle2 className="size-4 shrink-0 text-success" aria-label="Completed" />
            ) : lesson.locked && enrolled ? (
              <Lock className="size-4 shrink-0 text-muted-foreground" aria-label="Locked" />
            ) : (
              <CircleDashed className="size-4 shrink-0 text-muted-foreground" aria-label="Not completed" />
            )}
            <Link href={`/learning/courses/${courseId}/lessons/${lesson.id}`} className="min-w-0 flex-1 truncate hover:underline">
              {lesson.title}
            </Link>
            <span className="hidden text-caption text-muted-foreground sm:inline">{CONTENT_TYPE_LABELS[lesson.content_type]}</span>
            {lesson.estimated_minutes ? (
              <span className="text-caption text-muted-foreground">{formatMinutes(lesson.estimated_minutes)}</span>
            ) : null}
            {!lesson.is_required && <Badge variant="outline">Optional</Badge>}
          </li>
        ))}
        {module.lessons.length === 0 && <li className="px-3 py-2.5 text-small text-muted-foreground">No lessons yet.</li>}
      </ol>
      <ItemList quizzes={module.quizzes} assignments={module.assignments} enrolled={enrolled} />
    </Card>
  )
}

function ItemList({
  quizzes,
  assignments,
  enrolled,
}: {
  quizzes: CourseView['finalQuizzes']
  assignments: CourseView['finalAssignments']
  enrolled: boolean
}) {
  if (!quizzes.length && !assignments.length) return null
  return (
    <ul className="mt-3 grid gap-2">
      {quizzes.map((quiz) => (
        <li key={quiz.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/50 px-3 py-2.5 text-small">
          <FileQuestion className="size-4 shrink-0 text-primary" aria-hidden />
          <Link href={`/learning/quizzes/${quiz.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
            Quiz: {quiz.title}
          </Link>
          {enrolled && quiz.passed && <Badge variant="success">Passed</Badge>}
          {enrolled && !quiz.passed && quiz.attempts > 0 && (
            <span className="text-caption text-muted-foreground">
              Best {quiz.bestPercentage ?? 0}% · pass mark {quiz.passing_score}%
            </span>
          )}
          {!quiz.is_required && <Badge variant="outline">Optional</Badge>}
        </li>
      ))}
      {assignments.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/50 px-3 py-2.5 text-small">
          <ClipboardList className="size-4 shrink-0 text-primary" aria-hidden />
          <Link href={`/learning/assignments/${a.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
            Assignment: {a.title}
          </Link>
          {enrolled && a.status && a.status !== 'DRAFT' && <StatusBadge status={a.status} label={SUBMISSION_STATUS_LABELS[a.status]} />}
          {enrolled && a.dueDate && a.status !== 'APPROVED' && (
            <span className={cn('text-caption text-muted-foreground')}>Due {formatDay(a.dueDate)}</span>
          )}
          {!a.is_required && <Badge variant="outline">Optional</Badge>}
        </li>
      ))}
    </ul>
  )
}
