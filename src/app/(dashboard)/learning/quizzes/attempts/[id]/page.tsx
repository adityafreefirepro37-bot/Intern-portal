import type { Metadata } from 'next'
import Link from 'next/link'
import { CheckCircle2, XCircle } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { QuizTaker } from '@/features/learning/components/learner-actions'
import { cn, formatDay, fullName } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { quizService, type QuizResult } from '@/server/services/quiz.service'

export const metadata: Metadata = { title: 'Quiz attempt' }

export default async function AttemptPage({ params }: PageProps<'/learning/quizzes/attempts/[id]'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  let result = await quizService.result(ctx, id)

  if (result.open) {
    const take = await quizService.take(ctx, id)
    if (!take.submitted) {
      return (
        <>
          <PageHeader
            title={take.quiz.title}
            breadcrumbs={[
              { label: 'Learning Hub', href: '/learning' },
              { label: take.quiz.course.title, href: `/learning/courses/${take.quiz.course.id}` },
              { label: `Attempt ${take.attemptNumber}` },
            ]}
            description={`Pass mark ${take.quiz.passing_score}%. Your answers are checked when you submit.`}
          />
          <QuizTaker
            attemptId={take.attemptId}
            questions={take.quiz.questions}
            expiresAt={take.expiresAt ? take.expiresAt.toISOString() : null}
          />
        </>
      )
    }
    // The time limit had passed: the attempt was just closed.
    result = await quizService.result(ctx, id)
  }
  if (result.open) return null
  return <Result result={result} />
}

function Result({ result }: { result: Extract<QuizResult, { open: false }> }) {
  const { attempt, quiz } = result
  return (
    <>
      <PageHeader
        title={`${quiz.title} — result`}
        breadcrumbs={[
          { label: 'Learning Hub', href: '/learning' },
          { label: quiz.course.title, href: `/learning/courses/${quiz.course.id}` },
          { label: `Attempt ${attempt.attempt_number}` },
        ]}
        description={result.learner ? `Attempt by ${fullName(result.learner)}` : undefined}
        actions={
          <Link href={`/learning/quizzes/${quiz.id}`} className={buttonVariants({ variant: 'outline' })}>
            Back to quiz
          </Link>
        }
      />
      <Card className="mb-6 flex flex-wrap items-center gap-6 p-5">
        <div>
          <p className="text-caption text-muted-foreground">Score</p>
          <p className="tabular text-[1.875rem] font-semibold leading-none">{attempt.percentage ?? 0}%</p>
        </div>
        <div className="text-small">
          <p>
            {attempt.score ?? 0} of {attempt.max_score ?? 0} points · pass mark {quiz.passing_score}%
          </p>
          <p className="text-muted-foreground">
            {result.correctCount} correct · {result.incorrectCount} incorrect
            {attempt.submitted_at ? ` · ${formatDay(attempt.submitted_at)}` : ''}
          </p>
        </div>
        <Badge variant={attempt.passed ? 'success' : 'destructive'} className="ml-auto">
          {attempt.passed ? 'Passed' : 'Not passed'}
        </Badge>
      </Card>
      {!result.revealed && (
        <p className="mb-4 text-small text-muted-foreground">
          {quiz.answer_policy === 'NEVER'
            ? 'Correct answers aren’t shown for this quiz.'
            : 'Correct answers are shown once you pass this quiz.'}
        </p>
      )}
      <ol className="grid gap-3">
        {result.questions.map((q, index) => (
          <li key={q.id}>
            <Card className="p-5">
              <div className="flex items-start gap-3">
                {q.correct ? (
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-label="Correct" />
                ) : (
                  <XCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-label="Incorrect" />
                )}
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="font-medium">
                    {index + 1}. {q.question}{' '}
                    <span className="text-caption font-normal text-muted-foreground">
                      ({q.pointsAwarded}/{q.points})
                    </span>
                  </p>
                  {q.question_type === 'SHORT_ANSWER' ? (
                    <p className="text-small">
                      Your answer: <span className="font-medium">{q.textAnswer || '—'}</span>
                      {result.revealed && q.acceptedAnswers && (
                        <span className="block text-muted-foreground">Accepted answers: {q.acceptedAnswers.join(', ')}</span>
                      )}
                    </p>
                  ) : (
                    <ul className="grid gap-1.5">
                      {q.options.map((o) => {
                        const chosen = q.selectedOptionIds.includes(o.id)
                        const correct = 'is_correct' in o && o.is_correct
                        return (
                          <li
                            key={o.id}
                            className={cn(
                              'rounded-md border px-3 py-2 text-small',
                              chosen && 'border-ring',
                              result.revealed && correct && 'border-success bg-success/10',
                            )}
                          >
                            {o.option_text}
                            {chosen && <span className="ml-2 text-caption text-muted-foreground">(your answer)</span>}
                            {result.revealed && correct && <span className="ml-2 text-caption text-success">correct</span>}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  {result.revealed && q.explanation && <p className="text-small text-muted-foreground">{q.explanation}</p>}
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ol>
    </>
  )
}
