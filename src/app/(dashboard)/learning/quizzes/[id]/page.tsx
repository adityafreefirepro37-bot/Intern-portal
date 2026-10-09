import type { Metadata } from 'next'
import Link from 'next/link'
import { FileQuestion } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { DataTable } from '@/components/tables/data-table'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { StartQuizButton } from '@/features/learning/components/learner-actions'
import { ANSWER_POLICY_LABELS } from '@/lib/learning/quiz'
import { formatDay, pluralize } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { quizService } from '@/server/services/quiz.service'

export const metadata: Metadata = { title: 'Quiz' }

export default async function QuizPage({ params }: PageProps<'/learning/quizzes/[id]'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  const view = await quizService.overview(ctx, id)
  const { quiz } = view
  const submitted = view.attempts.filter((a) => a.status === 'SUBMITTED')

  return (
    <>
      <PageHeader
        title={quiz.title}
        breadcrumbs={[
          { label: 'Learning Hub', href: '/learning' },
          { label: quiz.course.title, href: `/learning/courses/${quiz.course.id}` },
          { label: 'Quiz' },
        ]}
        description={quiz.description ?? undefined}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card className="h-fit space-y-4 p-5">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileQuestion className="size-5" aria-hidden />
            </span>
            <div>
              <p className="text-h3">{pluralize(quiz._count.questions, 'question')}</p>
              <p className="text-small text-muted-foreground">Pass mark {quiz.passing_score}%</p>
            </div>
            {view.passed && (
              <Badge variant="success" className="ml-auto">
                Passed
              </Badge>
            )}
          </div>
          <ul className="list-disc space-y-1 pl-5 text-small text-muted-foreground">
            <li>{quiz.attempt_limit ? `${pluralize(quiz.attempt_limit, 'attempt')} allowed` : 'Unlimited attempts'}</li>
            <li>
              {quiz.time_limit_minutes
                ? `${quiz.time_limit_minutes} minutes per attempt — your answers are submitted when time runs out`
                : 'No time limit'}
            </li>
            <li>{ANSWER_POLICY_LABELS[quiz.answer_policy]}</li>
            <li>Answers are checked on the server when you submit.</li>
          </ul>
          {view.openAttemptId ? (
            <Link href={`/learning/quizzes/attempts/${view.openAttemptId}`} className={buttonVariants()}>
              Resume attempt
            </Link>
          ) : view.can.start ? (
            <StartQuizButton quizId={quiz.id} label={submitted.length ? 'Try again' : 'Start quiz'} />
          ) : (
            view.can.reason && <p className="text-small text-muted-foreground">{view.can.reason}</p>
          )}
          {view.attemptsLeft !== null && view.enrolled && (
            <p className="text-caption text-muted-foreground">{pluralize(view.attemptsLeft, 'attempt')} left</p>
          )}
        </Card>
        <Card className="h-fit p-5">
          <h2 className="mb-3 text-h3">Your attempts</h2>
          {submitted.length === 0 ? (
            <p className="text-small text-muted-foreground">No attempts yet.</p>
          ) : (
            <DataTable
              caption="Quiz attempts"
              rows={submitted}
              getRowId={(a) => a.id}
              columns={[
                {
                  key: 'n',
                  header: '#',
                  cell: (a) => (
                    <Link href={`/learning/quizzes/attempts/${a.id}`} className="font-medium hover:underline">
                      {a.attempt_number}
                    </Link>
                  ),
                },
                { key: 'score', header: 'Score', cell: (a) => `${a.percentage ?? 0}%` },
                { key: 'result', header: 'Result', cell: (a) => (a.passed ? 'Passed' : 'Not passed') },
                { key: 'date', header: 'Date', cell: (a) => (a.submitted_at ? formatDay(a.submitted_at) : '') },
              ]}
            />
          )}
        </Card>
      </div>
    </>
  )
}
