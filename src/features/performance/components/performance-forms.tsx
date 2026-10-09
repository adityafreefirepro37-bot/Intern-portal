'use client'

import * as React from 'react'
import { MessageSquarePlus, Pencil, Plus, Send } from 'lucide-react'
import { EditorDialog, Select } from '@/components/forms/editor-dialog'
import { Button } from '@/components/ui/button'
import { Input, inputClassName, Textarea } from '@/components/ui/input'
import { Field, FormMessage, SubmitButton } from '@/features/auth/components/form-bits'
import { useFormAction } from '@/features/interns/components/use-form-action'
import {
  CHECKIN_QUESTIONS,
  FEEDBACK_CONTEXT_LABELS,
  FEEDBACK_TYPE_LABELS,
  FEEDBACK_VISIBILITY_LABELS,
  GOAL_CATEGORY_LABELS,
  GOAL_PROGRESS_STEPS,
  GOAL_STATUS_LABELS,
} from '@/lib/performance/rules'
import {
  addGoalEvidenceAction,
  editFeedbackAction,
  giveFeedbackAction,
  goalProgressAction,
  requestFeedbackAction,
  reviewCheckinAction,
  saveCheckinAction,
  saveGoalAction,
} from '@/server/actions/performance'

interface Option {
  id: string
  name: string
}

const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }))

// ── Goals ───────────────────────────────────────────────────────────────────

export interface GoalFormValues {
  id: string
  title: string
  description: string | null
  category: keyof typeof GOAL_CATEGORY_LABELS
  start_date: string | null
  target_date: string | null
}

export function GoalDialog({ goal, interns, internId }: { goal?: GoalFormValues; interns?: Option[]; internId?: string }) {
  return (
    <EditorDialog
      title={goal ? 'Edit goal' : 'New goal'}
      description="Specific, measurable goals work best. Progress is updated by hand in 25% steps."
      action={saveGoalAction}
      trigger={(open) =>
        goal ? (
          <Button variant="outline" onClick={open}>
            <Pencil aria-hidden /> Edit
          </Button>
        ) : (
          <Button onClick={open}>
            <Plus aria-hidden /> New goal
          </Button>
        )
      }
    >
      {(state) => (
        <>
          {goal && <input type="hidden" name="goalId" value={goal.id} />}
          {!goal && internId && <input type="hidden" name="internId" value={internId} />}
          {!goal && !internId && interns && interns.length > 0 && (
            <Field label="Intern" htmlFor="g-intern" error={state.fields?.internId}>
              <Select id="g-intern" name="internId" options={interns.map((i) => ({ value: i.id, label: i.name }))} />
            </Field>
          )}
          <Field label="Goal" htmlFor="g-title" error={state.fields?.title}>
            <Input id="g-title" name="title" required minLength={3} maxLength={200} defaultValue={goal?.title} />
          </Field>
          <Field label="Description and success criteria" htmlFor="g-desc" error={state.fields?.description}>
            <Textarea id="g-desc" name="description" rows={4} maxLength={4000} defaultValue={goal?.description ?? ''} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Category" htmlFor="g-cat">
              <Select id="g-cat" name="category" defaultValue={goal?.category ?? 'TECHNICAL'} options={options(GOAL_CATEGORY_LABELS)} />
            </Field>
            <Field label="Start" htmlFor="g-start" error={state.fields?.startDate}>
              <Input id="g-start" name="startDate" type="date" defaultValue={goal?.start_date ?? ''} />
            </Field>
            <Field label="Target date" htmlFor="g-target" error={state.fields?.targetDate}>
              <Input id="g-target" name="targetDate" type="date" defaultValue={goal?.target_date ?? ''} />
            </Field>
          </div>
        </>
      )}
    </EditorDialog>
  )
}

export function GoalProgressForm({
  goalId,
  status,
  progress,
  canClose,
}: {
  goalId: string
  status: keyof typeof GOAL_STATUS_LABELS
  progress: number
  canClose: boolean
}) {
  const [state, action] = useFormAction(goalProgressAction)
  const statuses = Object.entries(GOAL_STATUS_LABELS).filter(
    ([value]) => canClose || !['COMPLETED', 'CANCELLED'].includes(value) || value === status,
  )
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="goalId" value={goalId} />
      <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Status" htmlFor="gp-status" error={state.fields?.status}>
          <select id="gp-status" name="status" defaultValue={status} className={inputClassName}>
            {statuses.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Progress" htmlFor="gp-progress" error={state.fields?.progress}>
          <select id="gp-progress" name="progress" defaultValue={String(progress)} className={inputClassName}>
            {GOAL_PROGRESS_STEPS.map((step) => (
              <option key={step} value={step}>
                {step}%
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Note (optional, added to the evidence)" htmlFor="gp-note">
        <Input id="gp-note" name="note" maxLength={1000} />
      </Field>
      <div>
        <SubmitButton pendingLabel="Saving…">Update progress</SubmitButton>
      </div>
    </form>
  )
}

const EVIDENCE_TYPES = {
  TASK: 'Task',
  PROJECT: 'Project',
  SUBMISSION: 'Task submission',
  COURSE: 'Course',
  LINK: 'Link',
  NOTE: 'Note',
} as const

export function EvidenceForm({ goalId, records }: { goalId: string; records: Record<'TASK' | 'PROJECT' | 'SUBMISSION' | 'COURSE', { id: string; label: string }[]> }) {
  const [type, setType] = React.useState<keyof typeof EVIDENCE_TYPES>('TASK')
  const [state, action] = useFormAction(addGoalEvidenceAction)
  const list = type === 'LINK' || type === 'NOTE' ? [] : records[type]
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="goalId" value={goalId} />
      <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
      <Field label="Evidence type" htmlFor="ev-type">
        <select id="ev-type" name="type" value={type} onChange={(e) => setType(e.target.value as typeof type)} className={inputClassName}>
          {Object.entries(EVIDENCE_TYPES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      {type === 'LINK' ? (
        <Field label="Link" htmlFor="ev-url" error={state.fields?.url}>
          <Input id="ev-url" name="url" type="url" placeholder="https://" required />
        </Field>
      ) : type !== 'NOTE' ? (
        <Field label="Record" htmlFor="ev-ref" error={state.fields?.referenceId}>
          {list.length ? (
            <select id="ev-ref" name="referenceId" required className={inputClassName}>
              {list.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-small text-muted-foreground">No {EVIDENCE_TYPES[type].toLowerCase()} records to link yet.</p>
          )}
        </Field>
      ) : null}
      <Field label={type === 'NOTE' ? 'Note' : 'Note (optional)'} htmlFor="ev-note" error={state.fields?.note}>
        <Textarea id="ev-note" name="note" rows={2} maxLength={2000} required={type === 'NOTE'} />
      </Field>
      <div>
        <SubmitButton variant="outline" pendingLabel="Adding…">
          Add evidence
        </SubmitButton>
      </div>
    </form>
  )
}

// ── Check-ins ───────────────────────────────────────────────────────────────

export function CheckinForm({
  weekStart,
  weekLabel,
  values,
}: {
  weekStart: string
  weekLabel: string
  values: Partial<Record<(typeof CHECKIN_QUESTIONS)[number]['key'], string | null>>
}) {
  const [state, action] = useFormAction(saveCheckinAction)
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="weekStart" value={weekStart} />
      <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
      <p className="text-small text-muted-foreground">Week of {weekLabel}. Drafts are only visible to you.</p>
      {CHECKIN_QUESTIONS.map((q) => (
        <Field key={q.key} label={q.label} htmlFor={`ci-${q.key}`} error={state.fields?.[q.key]}>
          <Textarea id={`ci-${q.key}`} name={q.key} rows={3} maxLength={4000} defaultValue={values[q.key] ?? ''} />
        </Field>
      ))}
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="intent" value="draft" variant="outline" pendingLabel="Saving…">
          Save draft
        </SubmitButton>
        <SubmitButton name="intent" value="submit" pendingLabel="Submitting…">
          <Send aria-hidden /> Submit check-in
        </SubmitButton>
      </div>
    </form>
  )
}

export function CheckinReviewForm({ checkinId }: { checkinId: string }) {
  const [state, action] = useFormAction(reviewCheckinAction)
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="checkinId" value={checkinId} />
      <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
      <Field label="Comment for the intern" htmlFor="cr-comment" error={state.fields?.comment}>
        <Textarea id="cr-comment" name="comment" rows={4} required maxLength={4000} />
      </Field>
      <div>
        <SubmitButton pendingLabel="Saving…">Mark reviewed</SubmitButton>
      </div>
    </form>
  )
}

// ── Feedback ────────────────────────────────────────────────────────────────

export function GiveFeedbackDialog({
  interns,
  internId,
  request,
  label = 'Give feedback',
  context,
}: {
  interns: Option[]
  internId?: string
  context?: { type: Exclude<keyof typeof FEEDBACK_CONTEXT_LABELS, 'GENERAL'>; id: string; label: string }
  request?: { id: string; question: string; internId: string | null; requester: string }
  label?: string
}) {
  return (
    <EditorDialog
      title={request ? `Feedback for ${request.requester}` : 'Give feedback'}
      description={request ? `They asked: “${request.question}”` : 'Be specific and kind. Choose who can see it.'}
      action={giveFeedbackAction}
      trigger={(open) => (
        <Button onClick={open} variant={request ? 'outline' : 'default'} size={request ? 'sm' : 'default'}>
          <MessageSquarePlus aria-hidden /> {label}
        </Button>
      )}
    >
      {(state) => (
        <>
          {request && <input type="hidden" name="requestId" value={request.id} />}
          {internId || request?.internId ? (
            <input type="hidden" name="internId" value={internId ?? request?.internId ?? ''} />
          ) : (
            <Field label="Intern" htmlFor="fb-intern" error={state.fields?.internId}>
              <Select id="fb-intern" name="internId" options={interns.map((i) => ({ value: i.id, label: i.name }))} />
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="fb-type">
              <Select id="fb-type" name="feedbackType" defaultValue="GENERAL" options={options(FEEDBACK_TYPE_LABELS)} />
            </Field>
            <Field label="Who can see it" htmlFor="fb-vis" error={state.fields?.visibility}>
              <Select id="fb-vis" name="visibility" defaultValue="SHARED_WITH_INTERN" options={options(FEEDBACK_VISIBILITY_LABELS)} />
            </Field>
          </div>
          {context ? (
            <>
              <input type="hidden" name="contextType" value={context.type} />
              <input type="hidden" name="contextId" value={context.id} />
              <p className="text-small text-muted-foreground">
                About: {FEEDBACK_CONTEXT_LABELS[context.type]} — {context.label}
              </p>
            </>
          ) : (
            <input type="hidden" name="contextType" value="GENERAL" />
          )}
          <Field label="Feedback" htmlFor="fb-body" error={state.fields?.body}>
            <Textarea id="fb-body" name="body" rows={6} required minLength={10} maxLength={5000} />
          </Field>
        </>
      )}
    </EditorDialog>
  )
}

export function EditFeedbackDialog({
  feedback,
}: {
  feedback: { id: string; body: string; feedback_type: keyof typeof FEEDBACK_TYPE_LABELS; visibility: keyof typeof FEEDBACK_VISIBILITY_LABELS }
}) {
  return (
    <EditorDialog
      title="Edit feedback"
      description="Edits are marked as edited and recorded in the audit log."
      action={editFeedbackAction}
      trigger={(open) => (
        <Button size="sm" variant="ghost" onClick={open}>
          <Pencil aria-hidden /> Edit
        </Button>
      )}
    >
      {(state) => (
        <>
          <input type="hidden" name="feedbackId" value={feedback.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="fe-type">
              <Select id="fe-type" name="feedbackType" defaultValue={feedback.feedback_type} options={options(FEEDBACK_TYPE_LABELS)} />
            </Field>
            <Field label="Who can see it" htmlFor="fe-vis">
              <Select id="fe-vis" name="visibility" defaultValue={feedback.visibility} options={options(FEEDBACK_VISIBILITY_LABELS)} />
            </Field>
          </div>
          <Field label="Feedback" htmlFor="fe-body" error={state.fields?.body}>
            <Textarea id="fe-body" name="body" rows={6} required minLength={10} maxLength={5000} defaultValue={feedback.body} />
          </Field>
        </>
      )}
    </EditorDialog>
  )
}

export function RequestFeedbackDialog({ recipients }: { recipients: Option[] }) {
  return (
    <EditorDialog
      title="Ask for feedback"
      description="Your manager or mentor gets a notification with your question."
      action={requestFeedbackAction}
      trigger={(open) => (
        <Button variant="outline" onClick={open}>
          <MessageSquarePlus aria-hidden /> Ask for feedback
        </Button>
      )}
    >
      {(state) => (
        <>
          <Field label="Ask" htmlFor="fr-to" error={state.fields?.recipientId}>
            <Select id="fr-to" name="recipientId" options={recipients.map((r) => ({ value: r.id, label: r.name }))} />
          </Field>
          <Field label="What would you like feedback on?" htmlFor="fr-q" error={state.fields?.question}>
            <Textarea id="fr-q" name="question" rows={4} required minLength={5} maxLength={1000} />
          </Field>
          <Field label="Useful by (optional)" htmlFor="fr-due" error={state.fields?.dueDate}>
            <Input id="fr-due" name="dueDate" type="date" className="w-48" />
          </Field>
        </>
      )}
    </EditorDialog>
  )
}
