import type { Metadata } from 'next'
import Link from 'next/link'
import { CheckCircle2, Circle, Lock } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { CreatePlanDialog } from '@/features/performance/components/setup-forms'
import { CorrectAnswerDialog, RatingScaleHelp, ReopenReviewDialog, ReviewAnswerForm } from '@/features/performance/components/review-forms'
import { RATING_SCALE, RESPONDENT_LABELS, REVIEW_STATUS_LABELS } from '@/lib/performance/rules'
import { cn, formatDay, fullName } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { performanceReviewService, type ReviewDetail } from '@/server/services/performance-review.service'

export const metadata: Metadata = { title: 'Performance review' }

type Answer = ReviewDetail['sections'][number]['questions'][number]['answers'][number]
type Question = ReviewDetail['sections'][number]['questions'][number]

function AnswerValue({ answer, question }: { answer: Answer; question: Question }) {
  switch (question.question_type) {
    case 'RATING': {
      const scale = RATING_SCALE.find((r) => r.value === answer.rating)
      return answer.rating ? (
        <span>
          <span className="font-semibold tabular">{answer.rating}</span> — {scale?.label}
        </span>
      ) : (
        <span className="text-muted-foreground">Not answered</span>
      )
    }
    case 'BOOLEAN':
      return <span>{answer.bool_value === null ? '—' : answer.bool_value ? 'Yes' : 'No'}</span>
    case 'MULTI_SELECT':
      return <span>{answer.selected_options.join(', ') || '—'}</span>
    default:
      return <span className="whitespace-pre-line">{answer.text_value || '—'}</span>
  }
}

export default async function ReviewPage({ params }: PageProps<'/performance/reviews/[id]'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  const data = await performanceReviewService.get(ctx, id)
  const { review, viewer, can } = data
  const name = fullName(review.intern.user)
  const writable = data.myRespondent
  const mySections = writable
    ? data.sections
        .filter((s) => s.respondents.includes(writable))
        .map((s) => ({
          id: s.id,
          title: s.title,
          description: s.description,
          questions: s.questions.map((q) => {
            const draft = q.answers.find((a) => a.respondent === writable) ?? null
            return {
              id: q.id,
              prompt: q.prompt,
              question_type: q.question_type,
              guidance: q.guidance,
              options: q.options,
              is_required: q.is_required,
              requires_evidence: q.requires_evidence,
              draft: draft && {
                rating: draft.rating,
                text_value: draft.text_value,
                bool_value: draft.bool_value,
                selected_options: draft.selected_options,
                evidence: draft.evidence,
              },
            }
          }),
        }))
    : []
  const anyVisible = data.sections.some((s) => s.questions.some((q) => q.answers.some((a) => a.respondent !== writable)))

  return (
    <>
      <PageHeader
        title={viewer.isSelf ? 'Your performance review' : `Review: ${name}`}
        breadcrumbs={[
          { label: 'Performance', href: '/performance' },
          { label: 'Reviews', href: '/performance/reviews' },
          { label: review.cycle?.name ?? 'Review' },
        ]}
        description={`${review.cycle?.name ?? 'Ad-hoc review'} · ${formatDay(review.review_period_start)} – ${formatDay(review.review_period_end)}${
          review.due_date ? ` · due ${formatDay(review.due_date)}` : ''
        }`}
        actions={
          <>
            <StatusBadge status={review.status} label={REVIEW_STATUS_LABELS[review.status]} />
            {can.reopen && (
              <ReopenReviewDialog
                reviewId={review.id}
                stages={data.stages.map((s) => ({ stage: s.stage, label: REVIEW_STATUS_LABELS[s.stage] ?? s.stage }))}
              />
            )}
            {can.plan && <CreatePlanDialog internId={review.intern.id} reviewId={review.id} />}
          </>
        }
      />

      <ol className="mb-6 flex flex-wrap gap-2" aria-label="Review stages">
        {data.stages.map((s) => (
          <li
            key={s.stage}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3 py-1 text-caption',
              s.current && 'border-primary bg-primary/10 font-medium text-primary',
              s.submitted && 'text-success',
            )}
            aria-current={s.current ? 'step' : undefined}
          >
            {s.submitted ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Circle className="size-3.5" aria-hidden />}
            {RESPONDENT_LABELS[s.respondent]}
          </li>
        ))}
        <li className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1 text-caption', review.status === 'COMPLETED' && 'text-success')}>
          {review.locked_at ? <Lock className="size-3.5" aria-hidden /> : <Circle className="size-3.5" aria-hidden />} Completed
        </li>
      </ol>

      {review.reopen_reason && review.status !== 'COMPLETED' && (
        <p className="mb-4 rounded-md bg-warning/10 p-3 text-small">
          Reopened {review.reopened_at ? formatDay(review.reopened_at) : ''}: {review.reopen_reason}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {writable && (
            <section className="space-y-3">
              <h2 className="text-h2">Your part: {RESPONDENT_LABELS[writable]}</h2>
              <ReviewAnswerForm reviewId={review.id} respondent={writable} sections={mySections} />
            </section>
          )}

          {anyVisible ? (
            <section className="space-y-3">
              <h2 className="text-h2">{writable ? 'Other answers you can see' : 'Answers'}</h2>
              {!writable && <RatingScaleHelp />}
              {data.sections.map((section) => {
                const questions = section.questions.filter((q) => q.answers.some((a) => a.respondent !== writable))
                if (!questions.length) return null
                return (
                  <Card key={section.id} className="space-y-4 p-5">
                    <h3 className="text-h3">{section.title}</h3>
                    {questions.map((q) => (
                      <div key={q.id} className="space-y-2 border-t pt-3 first-of-type:border-t-0 first-of-type:pt-0">
                        <p className="text-small font-medium">{q.prompt}</p>
                        <ul className="grid gap-2">
                          {q.answers
                            .filter((a) => a.respondent !== writable)
                            .map((a) => (
                              <li key={a.id} className="rounded-md bg-muted/50 p-3 text-small">
                                <div className="mb-1 flex flex-wrap items-center gap-2">
                                  <Badge variant={a.respondent === 'SELF' ? 'info' : 'neutral'}>{RESPONDENT_LABELS[a.respondent]}</Badge>
                                  {a.author && <span className="text-caption text-muted-foreground">{fullName(a.author)}</span>}
                                  {can.correct && (
                                    <span className="ml-auto">
                                      <CorrectAnswerDialog
                                        answer={{
                                          id: a.id,
                                          rating: a.rating,
                                          text_value: a.text_value,
                                          bool_value: a.bool_value,
                                          selected_options: a.selected_options,
                                        }}
                                        question={{ question_type: q.question_type, options: q.options }}
                                      />
                                    </span>
                                  )}
                                </div>
                                <AnswerValue answer={a} question={q} />
                                {a.evidence && <p className="mt-1 text-caption text-muted-foreground">Evidence: {a.evidence}</p>}
                              </li>
                            ))}
                        </ul>
                      </div>
                    ))}
                  </Card>
                )
              })}
            </section>
          ) : (
            !writable && (
              <Card className="p-5 text-small text-muted-foreground">
                {viewer.isSelf
                  ? 'Your manager’s and mentor’s answers are shared with you when the review is completed.'
                  : 'Nothing to show yet. Answers appear here as each stage is submitted.'}
              </Card>
            )
          )}
        </div>

        <aside className="space-y-4">
          <Card className="space-y-2 p-5 text-small">
            <h2 className="text-h3">People</h2>
            <p>
              Intern:{' '}
              {viewer.isSelf ? (
                'You'
              ) : (
                <Link href={`/interns/${review.intern.id}?tab=performance`} className="text-primary hover:underline">
                  {name}
                </Link>
              )}
            </p>
            <p>Manager: {fullName(review.reviewer)}</p>
            {review.mentor && <p>Mentor: {fullName(review.mentor)}</p>}
            {review.completed_at && (
              <p className="text-muted-foreground">
                Completed {formatDay(review.completed_at)}
                {review.completer ? ` by ${fullName(review.completer)}` : ''}
              </p>
            )}
          </Card>
          {!viewer.isSelf && (
            <Card className="p-5 text-small">
              <h2 className="mb-2 text-h3">Evidence</h2>
              <p className="text-muted-foreground">Base ratings on the intern’s actual work.</p>
              <Link href={`/interns/${review.intern.id}?tab=performance`} className="mt-2 inline-block text-primary hover:underline">
                Open the evidence view
              </Link>
            </Card>
          )}
          {data.plans.length > 0 && (
            <Card className="p-5 text-small">
              <h2 className="mb-2 text-h3">Development plans</h2>
              <ul className="space-y-1.5">
                {data.plans.map((p) => (
                  <li key={p.id}>
                    <Link href={`/performance/development/${p.id}`} className="text-primary hover:underline">
                      {p.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {data.revisions.length > 0 && (
            <Card className="p-5 text-small">
              <h2 className="mb-2 text-h3">Corrections</h2>
              <ul className="space-y-2">
                {data.revisions.map((r) => (
                  <li key={r.id}>
                    <p>{r.reason}</p>
                    <p className="text-caption text-muted-foreground">
                      {r.actor ? `${fullName(r.actor)} · ` : ''}
                      {formatDay(r.created_at)} · before: {JSON.stringify(r.before)}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </>
  )
}
