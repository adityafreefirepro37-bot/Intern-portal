'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus, RotateCcw, Send } from 'lucide-react'
import { Check, EditorDialog, Select } from '@/components/forms/editor-dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Textarea } from '@/components/ui/input'
import { Field, FormMessage, SubmitButton } from '@/features/auth/components/form-bits'
import { useFormAction } from '@/features/interns/components/use-form-action'
import { RATING_SCALE, RESPONDENT_LABELS } from '@/lib/performance/rules'
import { cn } from '@/lib/utils'
import {
  correctReviewAnswerAction,
  reopenReviewAction,
  saveReviewAnswersAction,
  startReviewAction,
} from '@/server/actions/performance'

type QuestionType = 'TEXT' | 'RATING' | 'BOOLEAN' | 'MULTI_SELECT'

export interface FormQuestion {
  id: string
  prompt: string
  question_type: QuestionType
  guidance: string | null
  options: string[]
  is_required: boolean
  requires_evidence: boolean
  /** The respondent's saved draft answer, if any. */
  draft: { rating: number | null; text_value: string | null; bool_value: boolean | null; selected_options: string[]; evidence: string | null } | null
}

export interface FormSection {
  id: string
  title: string
  description: string | null
  questions: FormQuestion[]
}

interface AnswerState {
  rating: number | null
  text: string
  bool: boolean | null
  selected: string[]
  evidence: string
}

export function RatingScaleHelp() {
  return (
    <details className="rounded-lg border p-3 text-small">
      <summary className="cursor-pointer font-medium">Rating scale (1–5)</summary>
      <dl className="mt-2 grid gap-1.5">
        {RATING_SCALE.map((r) => (
          <div key={r.value} className="grid grid-cols-[1.5rem_1fr] gap-2">
            <dt className="font-medium tabular">{r.value}</dt>
            <dd>
              <span className="font-medium">{r.label}.</span> <span className="text-muted-foreground">{r.criteria}</span>
            </dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

/** The current respondent's part of a review. Answers are sent as one JSON payload and validated on the server. */
export function ReviewAnswerForm({
  reviewId,
  respondent,
  sections,
}: {
  reviewId: string
  respondent: keyof typeof RESPONDENT_LABELS
  sections: FormSection[]
}) {
  const initial = Object.fromEntries(
    sections.flatMap((s) =>
      s.questions.map((q) => [
        q.id,
        {
          rating: q.draft?.rating ?? null,
          text: q.draft?.text_value ?? '',
          bool: q.draft?.bool_value ?? null,
          selected: q.draft?.selected_options ?? [],
          evidence: q.draft?.evidence ?? '',
        } satisfies AnswerState,
      ]),
    ),
  )
  const [answers, setAnswers] = React.useState<Record<string, AnswerState>>(initial)
  const [state, action] = useFormAction(saveReviewAnswersAction)
  const set = (id: string, patch: Partial<AnswerState>) => setAnswers((a) => ({ ...a, [id]: { ...a[id], ...patch } }))
  const payload = JSON.stringify(
    sections.flatMap((s) =>
      s.questions.map((q) => {
        const a = answers[q.id]
        return {
          questionId: q.id,
          rating: q.question_type === 'RATING' ? a.rating : null,
          text: q.question_type === 'TEXT' ? a.text || null : null,
          bool: q.question_type === 'BOOLEAN' ? a.bool : null,
          selected: q.question_type === 'MULTI_SELECT' ? a.selected : [],
          evidence: a.evidence || null,
        }
      }),
    ),
  )
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="reviewId" value={reviewId} />
      <input type="hidden" name="answers" value={payload} />
      <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
      <RatingScaleHelp />
      {sections.map((section) => (
        <Card key={section.id} className="space-y-4 p-5">
          <div>
            <h3 className="text-h3">{section.title}</h3>
            {section.description && <p className="text-small text-muted-foreground">{section.description}</p>}
          </div>
          {section.questions.map((q) => {
            const a = answers[q.id]
            const error = state.fields?.[q.id]
            const id = `rq-${q.id}`
            return (
              <fieldset key={q.id} className="grid gap-2 border-t pt-4 first-of-type:border-t-0 first-of-type:pt-0" aria-describedby={error ? `${id}-error` : undefined}>
                <legend className="text-body font-medium">
                  {q.prompt}
                  {q.is_required && <span className="text-destructive"> *</span>}
                </legend>
                {q.guidance && <p className="text-caption text-muted-foreground">{q.guidance}</p>}
                {q.question_type === 'TEXT' && (
                  <Textarea aria-label={q.prompt} rows={4} maxLength={5000} value={a.text} onChange={(e) => set(q.id, { text: e.target.value })} />
                )}
                {q.question_type === 'RATING' && (
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={q.prompt}>
                    {RATING_SCALE.map((r) => (
                      <label
                        key={r.value}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-small hover:bg-muted',
                          a.rating === r.value && 'border-primary bg-primary/10',
                        )}
                        title={r.criteria}
                      >
                        <input
                          type="radio"
                          name={`rating-${q.id}`}
                          className="sr-only"
                          checked={a.rating === r.value}
                          onChange={() => set(q.id, { rating: r.value })}
                        />
                        <span className="font-medium tabular">{r.value}</span>
                        <span className="text-muted-foreground">{r.label}</span>
                      </label>
                    ))}
                  </div>
                )}
                {q.question_type === 'BOOLEAN' && (
                  <div className="flex gap-4 text-small" role="radiogroup" aria-label={q.prompt}>
                    {[
                      [true, 'Yes'],
                      [false, 'No'],
                    ].map(([value, label]) => (
                      <label key={String(value)} className="flex items-center gap-2">
                        <input type="radio" name={`bool-${q.id}`} checked={a.bool === value} onChange={() => set(q.id, { bool: value as boolean })} />
                        {label as string}
                      </label>
                    ))}
                  </div>
                )}
                {q.question_type === 'MULTI_SELECT' && (
                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-small">
                    {q.options.map((option) => (
                      <label key={option} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={a.selected.includes(option)}
                          onChange={(e) =>
                            set(q.id, { selected: e.target.checked ? [...a.selected, option] : a.selected.filter((s) => s !== option) })
                          }
                        />
                        {option}
                      </label>
                    ))}
                  </div>
                )}
                {(q.requires_evidence || q.question_type === 'RATING') && (
                  <Input
                    aria-label={`Evidence for: ${q.prompt}`}
                    placeholder={q.requires_evidence ? 'Evidence (required) — e.g. the task, project or feedback this is based on' : 'Evidence (optional)'}
                    maxLength={2000}
                    value={a.evidence}
                    onChange={(e) => set(q.id, { evidence: e.target.value })}
                  />
                )}
                {error && (
                  <p id={`${id}-error`} role="alert" className="text-caption font-medium text-destructive">
                    {error}
                  </p>
                )}
              </fieldset>
            )
          })}
        </Card>
      ))}
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="intent" value="draft" variant="outline" pendingLabel="Saving…">
          Save draft
        </SubmitButton>
        <SubmitButton name="intent" value="submit" pendingLabel="Submitting…">
          <Send aria-hidden /> Submit {RESPONDENT_LABELS[respondent].toLowerCase()}
        </SubmitButton>
      </div>
      <p className="text-caption text-muted-foreground">Submitting moves the review to the next stage. You can’t change your answers afterwards.</p>
    </form>
  )
}

/** HR correction of one answer on a completed review (keeps the old value in the history). */
export function CorrectAnswerDialog({
  answer,
  question,
}: {
  answer: { id: string; rating: number | null; text_value: string | null; bool_value: boolean | null; selected_options: string[] }
  question: { question_type: QuestionType; options: string[] }
}) {
  const [rating, setRating] = React.useState(answer.rating ?? 3)
  const [text, setText] = React.useState(answer.text_value ?? '')
  const [bool, setBool] = React.useState(answer.bool_value ?? false)
  const [selected, setSelected] = React.useState(answer.selected_options)
  const [reason, setReason] = React.useState('')
  const payload = JSON.stringify({
    answerId: answer.id,
    reason,
    ...(question.question_type === 'RATING' ? { rating } : {}),
    ...(question.question_type === 'TEXT' ? { text } : {}),
    ...(question.question_type === 'BOOLEAN' ? { bool } : {}),
    ...(question.question_type === 'MULTI_SELECT' ? { selected } : {}),
  })
  return (
    <EditorDialog
      title="Correct this answer"
      description="The previous value is kept in the review history, with your reason."
      action={correctReviewAnswerAction}
      trigger={(open) => (
        <Button size="sm" variant="ghost" onClick={open}>
          <Pencil aria-hidden /> Correct
        </Button>
      )}
    >
      {() => (
        <>
          <input type="hidden" name="payload" value={payload} />
          {question.question_type === 'RATING' && (
            <Field label="Rating" htmlFor="ca-rating">
              <select id="ca-rating" value={rating} onChange={(e) => setRating(Number(e.target.value))} className="h-9 rounded-md border px-2">
                {RATING_SCALE.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.value} — {r.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {question.question_type === 'TEXT' && (
            <Field label="Answer" htmlFor="ca-text">
              <Textarea id="ca-text" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
          )}
          {question.question_type === 'BOOLEAN' && (
            <label className="flex items-center gap-2 text-small">
              <input type="checkbox" checked={bool} onChange={(e) => setBool(e.target.checked)} /> Yes
            </label>
          )}
          {question.question_type === 'MULTI_SELECT' && (
            <div className="flex flex-wrap gap-3 text-small">
              {question.options.map((o) => (
                <label key={o} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.includes(o)}
                    onChange={(e) => setSelected(e.target.checked ? [...selected, o] : selected.filter((s) => s !== o))}
                  />
                  {o}
                </label>
              ))}
            </div>
          )}
          <Field label="Reason for the correction" htmlFor="ca-reason">
            <Textarea id="ca-reason" rows={3} required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </>
      )}
    </EditorDialog>
  )
}

export function ReopenReviewDialog({ reviewId, stages }: { reviewId: string; stages: { stage: string; label: string }[] }) {
  return (
    <EditorDialog
      title="Reopen this review"
      description="The chosen stage and the ones after it are submitted again. The reason is recorded."
      action={reopenReviewAction}
      trigger={(open) => (
        <Button variant="outline" onClick={open}>
          <RotateCcw aria-hidden /> Reopen
        </Button>
      )}
    >
      {(state) => (
        <>
          <input type="hidden" name="reviewId" value={reviewId} />
          <Field label="Reopen at" htmlFor="ro-stage">
            <Select id="ro-stage" name="stage" options={stages.map((s) => ({ value: s.stage, label: s.label }))} />
          </Field>
          <Field label="Reason" htmlFor="ro-reason" error={state.fields?.reason}>
            <Textarea id="ro-reason" name="reason" rows={3} required minLength={5} maxLength={1000} />
          </Field>
        </>
      )}
    </EditorDialog>
  )
}

export function StartReviewDialog({ interns, templates }: { interns: { id: string; name: string }[]; templates: { id: string; name: string }[] }) {
  const router = useRouter()
  return (
    <EditorDialog
      title="Start a review"
      description="An ad-hoc review outside a cycle. The intern’s manager writes the manager review."
      action={startReviewAction}
      onSuccess={(s) => s.data && router.push(`/performance/reviews/${s.data.id}`)}
      trigger={(open) => (
        <Button onClick={open} disabled={!interns.length || !templates.length}>
          <Plus aria-hidden /> Start review
        </Button>
      )}
    >
      {(state) => (
        <>
          <Field label="Intern" htmlFor="sr-intern" error={state.fields?.internId}>
            <Select id="sr-intern" name="internId" options={interns.map((i) => ({ value: i.id, label: i.name }))} />
          </Field>
          <Field label="Template" htmlFor="sr-template" error={state.fields?.templateId}>
            <Select id="sr-template" name="templateId" options={templates.map((t) => ({ value: t.id, label: t.name }))} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Period start" htmlFor="sr-start" error={state.fields?.periodStart}>
              <Input id="sr-start" name="periodStart" type="date" required />
            </Field>
            <Field label="Period end" htmlFor="sr-end" error={state.fields?.periodEnd}>
              <Input id="sr-end" name="periodEnd" type="date" required />
            </Field>
            <Field label="Due" htmlFor="sr-due" error={state.fields?.dueDate}>
              <Input id="sr-due" name="dueDate" type="date" />
            </Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-label">Stages (manager review is always included)</legend>
            <Check name="selfReview" label="Self-review first" defaultChecked />
            <Check name="mentorReview" label="Mentor review (if the intern has a mentor)" defaultChecked />
            <Check name="hrReview" label="HR review and sign-off" defaultChecked />
          </fieldset>
        </>
      )}
    </EditorDialog>
  )
}
