'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Play, Send, Timer, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input, inputClassName, Textarea } from '@/components/ui/input'
import { Field, FormMessage, SubmitButton } from '@/features/auth/components/form-bits'
import { ActionButton } from '@/features/hr/components/action-form'
import { useFormAction } from '@/features/interns/components/use-form-action'
import {
  assignCourseAction,
  assignPathAction,
  completeLessonAction,
  enrollAction,
  reviewAssignmentAction,
  saveAssignmentDraftAction,
  startQuizAction,
  submitAssignmentAction,
  submitQuizAction,
} from '@/server/actions/learning'

export function EnrollButton({ courseId }: { courseId: string }) {
  return (
    <ActionButton action={enrollAction} fields={{ courseId }} pendingLabel="Enrolling…">
      <Play aria-hidden /> Enroll
    </ActionButton>
  )
}

export function CompleteLessonButton({ lessonId }: { lessonId: string }) {
  return (
    <ActionButton action={completeLessonAction} fields={{ lessonId }} pendingLabel="Saving…">
      <CheckCircle2 aria-hidden /> Mark lesson complete
    </ActionButton>
  )
}

export interface PersonOption {
  id: string
  name: string
  department: string | null
}

/** Assign a course or a path to people in the viewer's scope. */
export function AssignDialog({
  kind,
  targetId,
  title,
  people,
}: {
  kind: 'course' | 'path'
  targetId: string
  title: string
  people: PersonOption[]
}) {
  const [open, setOpen] = React.useState(false)
  const [state, action] = useFormAction(kind === 'course' ? assignCourseAction : assignPathAction, {
    onSuccess: () => setOpen(false),
  })
  const [filter, setFilter] = React.useState('')
  const shown = people.filter((p) => `${p.name} ${p.department ?? ''}`.toLowerCase().includes(filter.toLowerCase()))
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={!people.length}>
        <UserPlus aria-hidden /> Assign
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Assign “{title}”</DialogTitle>
            <DialogDescription>
              {kind === 'path'
                ? 'Each person gets their own plan: every course in the path, in order, with due dates.'
                : 'People are enrolled and notified. Existing progress is kept.'}
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="grid gap-4">
            <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
            <input type="hidden" name={kind === 'course' ? 'courseId' : 'pathId'} value={targetId} />
            <Field label="Find people" htmlFor="assign-filter">
              <Input id="assign-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Name or department" />
            </Field>
            <fieldset className="max-h-64 overflow-y-auto rounded-md border p-2" aria-label="People">
              {shown.length === 0 && <p className="p-2 text-small text-muted-foreground">Nobody matches.</p>}
              {shown.map((person) => (
                <label key={person.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-small hover:bg-muted">
                  <input type="checkbox" name="userIds" value={person.id} className="size-4" />
                  <span className="min-w-0 flex-1 truncate">{person.name}</span>
                  {person.department && <span className="text-caption text-muted-foreground">{person.department}</span>}
                </label>
              ))}
            </fieldset>
            {state.fields?.userIds && <p className="text-caption text-destructive">{state.fields.userIds}</p>}
            <Field label="Due date (optional)" htmlFor="assign-due" error={state.fields?.dueDate}>
              <Input id="assign-due" name="dueDate" type="date" />
            </Field>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton pendingLabel="Assigning…">Assign</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function StartQuizButton({ quizId, label }: { quizId: string; label: string }) {
  const router = useRouter()
  const [state, action] = useFormAction(startQuizAction, {
    toast: false,
    onSuccess: (s) => s.data && router.push(`/learning/quizzes/attempts/${s.data.attemptId}`),
  })
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="quizId" value={quizId} />
      <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
      <SubmitButton pendingLabel="Starting…">
        <Play aria-hidden /> {label}
      </SubmitButton>
    </form>
  )
}

interface TakeQuestion {
  id: string
  question: string
  question_type: 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'SHORT_ANSWER'
  points: number
  options: { id: string; option_text: string }[]
}

function useCountdown(expiresAt: string | null) {
  const [left, setLeft] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (!expiresAt) return
    const end = new Date(expiresAt).getTime()
    const tick = () => setLeft(Math.max(0, Math.round((end - Date.now()) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [expiresAt])
  return left
}

/**
 * The quiz form. Answers are kept in the page and sent once, on submit; the
 * server grades them. Nothing here knows the correct answers.
 */
export function QuizTaker({
  attemptId,
  questions,
  expiresAt,
}: {
  attemptId: string
  questions: TakeQuestion[]
  expiresAt: string | null
}) {
  const router = useRouter()
  const [answers, setAnswers] = React.useState<Record<string, { selected: string[]; text: string }>>({})
  const [state, action] = useFormAction(submitQuizAction, {
    onSuccess: () => router.push(`/learning/quizzes/attempts/${attemptId}`),
  })
  const left = useCountdown(expiresAt)
  const formRef = React.useRef<HTMLFormElement>(null)
  const submitted = React.useRef(false)
  // Submit automatically when the timer runs out.
  React.useEffect(() => {
    if (left === 0 && !submitted.current) {
      submitted.current = true
      formRef.current?.requestSubmit()
    }
  }, [left])

  const set = (id: string, value: Partial<{ selected: string[]; text: string }>) =>
    setAnswers((current) => ({ ...current, [id]: { ...(current[id] ?? { selected: [], text: '' }), ...value } }))
  const payload = JSON.stringify(
    questions.map((q) => ({
      questionId: q.id,
      selectedOptionIds: answers[q.id]?.selected ?? [],
      text: q.question_type === 'SHORT_ANSWER' ? answers[q.id]?.text || null : null,
    })),
  )
  const answered = questions.filter((q) => (answers[q.id]?.selected.length ?? 0) > 0 || answers[q.id]?.text?.trim()).length

  return (
    <form ref={formRef} action={action} className="grid gap-4">
      <input type="hidden" name="attemptId" value={attemptId} />
      <input type="hidden" name="answers" value={payload} />
      <div className="sticky top-14 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card/95 px-4 py-2 text-small backdrop-blur">
        <span>
          {answered} of {questions.length} answered
        </span>
        {left !== null && (
          <span className={`flex items-center gap-1.5 font-medium tabular ${left < 60 ? 'text-destructive' : ''}`} aria-live="polite">
            <Timer className="size-4" aria-hidden />
            {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} left
          </span>
        )}
      </div>
      <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
      <ol className="grid gap-4">
        {questions.map((q, index) => (
          <li key={q.id}>
            <Card className="p-5">
              <fieldset>
                <legend className="mb-3 text-body font-medium">
                  <span className="text-muted-foreground">{index + 1}. </span>
                  {q.question}
                  <span className="ml-2 text-caption font-normal text-muted-foreground">
                    ({q.points} {q.points === 1 ? 'point' : 'points'})
                  </span>
                </legend>
                {q.question_type === 'SHORT_ANSWER' ? (
                  <Input
                    aria-label={`Answer to question ${index + 1}`}
                    value={answers[q.id]?.text ?? ''}
                    maxLength={500}
                    onChange={(e) => set(q.id, { text: e.target.value })}
                  />
                ) : (
                  <div className="grid gap-2">
                    {q.question_type === 'MULTIPLE_CHOICE' && (
                      <p className="text-caption text-muted-foreground">Select every correct answer.</p>
                    )}
                    {q.options.map((option) => {
                      const multi = q.question_type === 'MULTIPLE_CHOICE'
                      const checked = answers[q.id]?.selected.includes(option.id) ?? false
                      return (
                        <label key={option.id} className="flex items-start gap-2.5 rounded-md border p-3 text-small hover:bg-muted/60">
                          <input
                            type={multi ? 'checkbox' : 'radio'}
                            name={`q-${q.id}`}
                            className="mt-0.5 size-4"
                            checked={checked}
                            onChange={() =>
                              set(q.id, {
                                selected: multi
                                  ? checked
                                    ? (answers[q.id]?.selected ?? []).filter((id) => id !== option.id)
                                    : [...(answers[q.id]?.selected ?? []), option.id]
                                  : [option.id],
                              })
                            }
                          />
                          <span>{option.option_text}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </fieldset>
            </Card>
          </li>
        ))}
      </ol>
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Submitting…">
          <Send aria-hidden /> Submit answers
        </SubmitButton>
      </div>
    </form>
  )
}

/** Draft and submit / resubmit work for a learning assignment. */
export function AssignmentWork({
  assignmentId,
  draft,
  canDraft,
  canSubmit,
  resubmit,
}: {
  assignmentId: string
  draft: string | null
  canDraft: boolean
  canSubmit: boolean
  resubmit: boolean
}) {
  const [draftState, draftAction] = useFormAction(saveAssignmentDraftAction)
  const [state, action] = useFormAction(submitAssignmentAction)
  const [text, setText] = React.useState(draft ?? '')
  return (
    <div className="grid gap-4">
      {canDraft && (
        <form action={draftAction} className="grid gap-3">
          <input type="hidden" name="assignmentId" value={assignmentId} />
          <Field label="Your notes (draft — only you can see this)" htmlFor="as-draft" error={draftState.fields?.text}>
            <Textarea id="as-draft" name="text" rows={5} maxLength={10000} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div>
            <SubmitButton variant="outline" pendingLabel="Saving…">
              Save draft
            </SubmitButton>
          </div>
        </form>
      )}
      {canSubmit && (
        <form action={action} className="grid gap-3 rounded-lg border p-4">
          <h3 className="text-h3">{resubmit ? 'Resubmit your work' : 'Submit your work'}</h3>
          <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
          <input type="hidden" name="assignmentId" value={assignmentId} />
          <Field label="What are you submitting?" htmlFor="as-message" error={state.fields?.message}>
            <Textarea id="as-message" name="message" rows={5} required maxLength={10000} defaultValue={text} />
          </Field>
          <Field label="Files (optional, up to 5)" htmlFor="as-files" error={state.fields?.files}>
            <Input id="as-files" name="files" type="file" multiple />
          </Field>
          <div>
            <SubmitButton pendingLabel="Submitting…">
              <Send aria-hidden /> {resubmit ? 'Resubmit' : 'Submit for review'}
            </SubmitButton>
          </div>
        </form>
      )}
    </div>
  )
}

export function ReviewSubmissionForm({
  submissionId,
  maxPoints,
  rubric,
}: {
  submissionId: string
  maxPoints: number | null
  rubric: string | null
}) {
  const [state, action] = useFormAction(reviewAssignmentAction)
  const [decision, setDecision] = React.useState<'APPROVE' | 'REQUEST_CHANGES'>('APPROVE')
  return (
    <form action={action} className="grid gap-4">
      <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
      <input type="hidden" name="submissionId" value={submissionId} />
      <fieldset className="flex flex-wrap gap-4 text-small">
        <legend className="mb-2 text-label">Decision</legend>
        {(
          [
            ['APPROVE', 'Approve'],
            ['REQUEST_CHANGES', 'Request changes'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-2">
            <input type="radio" name="decision" value={value} checked={decision === value} onChange={() => setDecision(value)} />
            {label}
          </label>
        ))}
      </fieldset>
      {maxPoints !== null && decision === 'APPROVE' && (
        <Field label={`Points (0–${maxPoints})`} htmlFor="rv-points" error={state.fields?.points} hint="Use the rubric below.">
          <Input id="rv-points" name="points" type="number" min={0} max={maxPoints} required className="w-32" />
        </Field>
      )}
      {rubric && maxPoints !== null && (
        <div className="rounded-md bg-muted/60 p-3 text-small">
          <p className="mb-1 font-medium">Rubric</p>
          <p className="whitespace-pre-line text-muted-foreground">{rubric}</p>
        </div>
      )}
      <Field
        label={decision === 'APPROVE' ? 'Comment (optional)' : 'What needs to change?'}
        htmlFor="rv-comment"
        error={state.fields?.comment}
      >
        <Textarea id="rv-comment" name="comment" rows={4} maxLength={5000} required={decision === 'REQUEST_CHANGES'} />
      </Field>
      <div>
        <SubmitButton pendingLabel="Saving…">{decision === 'APPROVE' ? 'Approve' : 'Request changes'}</SubmitButton>
      </div>
    </form>
  )
}

/** Inline select used by several learning forms. */
export function SelectField({
  id,
  name,
  label,
  options,
  defaultValue,
  error,
  includeEmpty,
}: {
  id: string
  name: string
  label: string
  options: { value: string; label: string }[]
  defaultValue?: string
  error?: string
  includeEmpty?: string
}) {
  return (
    <Field label={label} htmlFor={id} error={error}>
      <select id={id} name={name} defaultValue={defaultValue ?? ''} className={inputClassName}>
        {includeEmpty !== undefined && <option value="">{includeEmpty}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  )
}
