import type { Metadata } from 'next'
import Link from 'next/link'
import { ClipboardList, Eye, FileQuestion } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ActionButton } from '@/features/hr/components/action-form'
import {
  AssignmentDialog,
  CourseDialog,
  DeleteButton,
  LessonDialog,
  ModuleDialog,
  MoveButtons,
  QuestionDialog,
  QuizDialog,
} from '@/features/learning/components/course-builder'
import { ConfirmActionButton } from '@/features/learning/components/confirm-action'
import { QUESTION_TYPE_LABELS } from '@/lib/learning/quiz'
import { CONTENT_TYPE_LABELS, DIFFICULTY_LABELS, formatMinutes } from '@/lib/learning/rules'
import { pluralize } from '@/lib/utils'
import { courseStatusAction, deleteCourseAction, quizStatusAction } from '@/server/actions/learning'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { learningCatalogService } from '@/server/services/learning-catalog.service'

export const metadata: Metadata = { title: 'Course builder' }

type Builder = Awaited<ReturnType<typeof learningCatalogService.builder>>

export default async function CourseBuilderPage({ params }: PageProps<'/learning/manage/courses/[id]'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'course.update')) return <AccessDenied what="course authoring" />
  const { id } = await params
  const [course, categories] = await Promise.all([learningCatalogService.builder(ctx, id), learningCatalogService.categories(ctx)])
  const modules = course.modules.map((m) => ({ id: m.id, title: m.title }))
  const canPublish = authorizationService.can(ctx, 'course.publish')
  const learners = course._count.enrollments

  return (
    <>
      <PageHeader
        title={course.title}
        breadcrumbs={[
          { label: 'Learning Hub', href: '/learning' },
          { label: 'Manage', href: '/learning/manage' },
          { label: course.title },
        ]}
        description={
          <>
            {DIFFICULTY_LABELS[course.difficulty]}
            {course.estimated_minutes ? ` · ${formatMinutes(course.estimated_minutes)}` : ''} · {pluralize(learners, 'learner')}
          </>
        }
        actions={
          <>
            <StatusBadge status={course.status} />
            <Link href={`/learning/courses/${course.id}`} className={buttonVariants({ variant: 'outline' })}>
              <Eye aria-hidden /> Preview
            </Link>
            <CourseDialog course={course} categories={categories} />
            {course.status !== 'PUBLISHED' && canPublish && (
              <ActionButton action={courseStatusAction} fields={{ courseId: course.id, action: 'PUBLISH' }} pendingLabel="Publishing…">
                Publish
              </ActionButton>
            )}
            {course.status === 'PUBLISHED' && (
              <ConfirmActionButton
                action={courseStatusAction}
                fields={{ courseId: course.id, action: learners ? 'ARCHIVE' : 'DRAFT' }}
                title={learners ? 'Archive this course?' : 'Move back to draft?'}
                description={
                  learners
                    ? 'Learners keep their progress and history, but nobody new can enroll.'
                    : 'The course disappears from the catalog until it is published again.'
                }
                variant="outline"
              >
                {learners ? 'Archive' : 'Unpublish'}
              </ConfirmActionButton>
            )}
            {!learners && authorizationService.can(ctx, 'course.delete') && (
              <ConfirmActionButton
                action={deleteCourseAction}
                fields={{ courseId: course.id }}
                title="Delete this course?"
                description="Courses without learners can be deleted. This can’t be undone from the app."
                confirmLabel="Delete"
                destructive
                variant="ghost"
              >
                Delete
              </ConfirmActionButton>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ModuleDialog courseId={course.id} />
        <QuizDialog courseId={course.id} modules={modules} />
        <AssignmentDialog courseId={course.id} modules={modules} />
      </div>
      <div className="space-y-4">
        {course.modules.map((module, index) => (
          <Card key={module.id} className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 flex-1 text-h3">
                <span className="text-muted-foreground">Module {index + 1} · </span>
                {module.title}
              </h2>
              <MoveButtons kind="module" id={module.id} first={index === 0} last={index === course.modules.length - 1} />
              <ModuleDialog courseId={course.id} module={module} />
              <DeleteButton kind="module" id={module.id} name={module.title} />
            </div>
            {module.description && <p className="mt-1 text-small text-muted-foreground">{module.description}</p>}
            <ol className="mt-3 divide-y rounded-lg border">
              {module.lessons.map((lesson, i) => (
                <li key={lesson.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-small">
                  <span className="min-w-0 flex-1 truncate">{lesson.title}</span>
                  <Badge variant="neutral">{CONTENT_TYPE_LABELS[lesson.content_type]}</Badge>
                  {!lesson.is_required && <Badge variant="outline">Optional</Badge>}
                  <MoveButtons kind="lesson" id={lesson.id} first={i === 0} last={i === module.lessons.length - 1} />
                  <LessonDialog moduleId={module.id} lesson={lesson} />
                  {lesson._count.learning_progress === 0 && <DeleteButton kind="lesson" id={lesson.id} name={lesson.title} />}
                </li>
              ))}
              {module.lessons.length === 0 && <li className="px-3 py-2 text-small text-muted-foreground">No lessons yet.</li>}
            </ol>
            <div className="mt-3">
              <LessonDialog moduleId={module.id} />
            </div>
            <Items course={course} moduleId={module.id} modules={modules} />
          </Card>
        ))}
        <Card className="p-5">
          <h2 className="text-h3">Course-level items</h2>
          <p className="text-small text-muted-foreground">Final assessments and assignments not tied to a module.</p>
          <Items course={course} moduleId={null} modules={modules} />
        </Card>
      </div>
    </>
  )
}

function Items({ course, moduleId, modules }: { course: Builder; moduleId: string | null; modules: { id: string; title: string }[] }) {
  const quizzes = course.quizzes.filter((q) => q.module_id === moduleId)
  const assignments = course.assignments.filter((a) => a.module_id === moduleId)
  if (!quizzes.length && !assignments.length) return null
  return (
    <div className="mt-4 grid gap-3">
      {quizzes.map((quiz) => {
        const locked = quiz._count.attempts > 0
        return (
          <div key={quiz.id} className="rounded-lg border bg-muted/30 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <FileQuestion className="size-4 text-primary" aria-hidden />
              <span className="min-w-0 flex-1 font-medium">Quiz: {quiz.title}</span>
              <StatusBadge status={quiz.status} />
              <span className="text-caption text-muted-foreground">
                {pluralize(quiz.questions.length, 'question')} · pass {quiz.passing_score}% · {pluralize(quiz._count.attempts, 'attempt')}
              </span>
              <QuizDialog courseId={course.id} modules={modules} quiz={quiz} />
              {quiz.status === 'DRAFT' ? (
                <ActionButton action={quizStatusAction} fields={{ quizId: quiz.id, action: 'PUBLISH' }} size="sm" variant="outline">
                  Publish quiz
                </ActionButton>
              ) : (
                !locked && (
                  <ActionButton action={quizStatusAction} fields={{ quizId: quiz.id, action: 'DRAFT' }} size="sm" variant="ghost">
                    Unpublish
                  </ActionButton>
                )
              )}
              {!locked && <DeleteButton kind="quiz" id={quiz.id} name={quiz.title} />}
            </div>
            {locked && (
              <p className="mt-2 text-caption text-muted-foreground">
                People have attempted this quiz, so its questions are locked to keep results consistent.
              </p>
            )}
            <ol className="mt-3 grid gap-2">
              {quiz.questions.map((q, i) => (
                <li key={q.id} className="flex flex-wrap items-start gap-2 rounded-md bg-card px-3 py-2 text-small">
                  <span className="min-w-0 flex-1">
                    {i + 1}. {q.question}
                    <span className="block text-caption text-muted-foreground">
                      {QUESTION_TYPE_LABELS[q.question_type]} · {pluralize(q.points, 'point')} ·{' '}
                      {q.question_type === 'SHORT_ANSWER'
                        ? `accepts: ${q.accepted_answers.join(', ')}`
                        : `correct: ${q.options.filter((o) => o.is_correct).map((o) => o.option_text).join(', ')}`}
                    </span>
                  </span>
                  {!locked && (
                    <>
                      <QuestionDialog quizId={quiz.id} question={q} />
                      <DeleteButton kind="question" id={q.id} name={`question ${i + 1}`} />
                    </>
                  )}
                </li>
              ))}
            </ol>
            {!locked && (
              <div className="mt-3">
                <QuestionDialog quizId={quiz.id} />
              </div>
            )}
          </div>
        )
      })}
      {assignments.map((a) => (
        <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-4 text-small">
          <ClipboardList className="size-4 text-primary" aria-hidden />
          <span className="min-w-0 flex-1 font-medium">Assignment: {a.title}</span>
          <span className="text-caption text-muted-foreground">
            {a.max_points ? `${a.max_points} points · ` : ''}
            {a.due_days ? `due ${a.due_days} days after enrolling · ` : ''}
            {pluralize(a._count.submissions, 'submission')}
          </span>
          <AssignmentDialog courseId={course.id} modules={modules} assignment={a} />
          {a._count.submissions === 0 && <DeleteButton kind="assignment" id={a.id} name={a.title} />}
        </div>
      ))}
    </div>
  )
}
