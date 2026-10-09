'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { Check, EditorDialog, Select } from '@/components/forms/editor-dialog'
import { Button } from '@/components/ui/button'
import { Input, inputClassName, Textarea } from '@/components/ui/input'
import { Field, SubmitButton } from '@/features/auth/components/form-bits'
import { useFormAction } from '@/features/interns/components/use-form-action'
import { ActionButton } from '@/features/hr/components/action-form'
import { ConfirmActionButton } from '@/features/learning/components/confirm-action'
import { CYCLE_TYPE_LABELS, DEVELOPMENT_ITEM_STATUS_LABELS, RESPONDENT_LABELS } from '@/lib/performance/rules'
import {
  createDevelopmentPlanAction,
  deleteReviewQuestionAction,
  deleteSectionAction,
  developmentItemStatusAction,
  duplicateTemplateAction,
  moveReviewQuestionAction,
  moveSectionAction,
  saveCycleAction,
  saveDevelopmentItemAction,
  saveReviewQuestionAction,
  saveSectionAction,
  saveTemplateAction,
} from '@/server/actions/performance'

interface Option {
  id: string
  name: string
}

const QUESTION_TYPES = { TEXT: 'Written answer', RATING: 'Rating (1–5)', BOOLEAN: 'Yes / no', MULTI_SELECT: 'Choose several' } as const
const CYCLE_TYPES = CYCLE_TYPE_LABELS

// ── Templates ───────────────────────────────────────────────────────────────

export function TemplateDialog({ template }: { template?: { id: string; name: string; description: string | null; is_active: boolean } }) {
  const router = useRouter()
  return (
    <EditorDialog
      title={template ? 'Template details' : 'New review template'}
      action={saveTemplateAction}
      onSuccess={(s) => !template && s.data && router.push(`/performance/templates/${s.data.id}`)}
      trigger={(open) =>
        template ? (
          <Button variant="outline" onClick={open}>
            <Pencil aria-hidden /> Edit details
          </Button>
        ) : (
          <Button variant="outline" onClick={open}>
            <Plus aria-hidden /> New template
          </Button>
        )
      }
    >
      {(state) => (
        <>
          {template && <input type="hidden" name="templateId" value={template.id} />}
          <Field label="Name" htmlFor="t-name" error={state.fields?.name}>
            <Input id="t-name" name="name" required minLength={3} maxLength={160} defaultValue={template?.name} />
          </Field>
          <Field label="Description" htmlFor="t-desc">
            <Textarea id="t-desc" name="description" rows={3} maxLength={2000} defaultValue={template?.description ?? ''} />
          </Field>
          {template && <Check name="active" label="Active (can be used for new cycles and reviews)" defaultChecked={template.is_active} />}
        </>
      )}
    </EditorDialog>
  )
}

/** Copies a template (sections and questions) and opens the copy for editing. */
export function DuplicateTemplateButton({ templateId }: { templateId: string }) {
  const router = useRouter()
  const [, action] = useFormAction(duplicateTemplateAction, {
    onSuccess: (s) => s.data && router.push(`/performance/templates/${s.data.id}`),
  })
  return (
    <form action={action}>
      <input type="hidden" name="templateId" value={templateId} />
      <SubmitButton variant="outline" pendingLabel="Duplicating…">
        Duplicate
      </SubmitButton>
    </form>
  )
}

export function SectionDialog({
  templateId,
  section,
}: {
  templateId: string
  section?: { id: string; title: string; description: string | null; respondents: (keyof typeof RESPONDENT_LABELS)[] }
}) {
  return (
    <EditorDialog
      title={section ? 'Edit section' : 'New section'}
      description="Choose who answers this section. Self-review answers are kept separate from everyone else’s."
      action={saveSectionAction}
      trigger={(open) =>
        section ? (
          <Button size="sm" variant="ghost" onClick={open} aria-label={`Edit ${section.title}`}>
            <Pencil aria-hidden />
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={open}>
            <Plus aria-hidden /> Section
          </Button>
        )
      }
    >
      {(state) => (
        <>
          <input type="hidden" name="templateId" value={templateId} />
          {section && <input type="hidden" name="sectionId" value={section.id} />}
          <Field label="Title" htmlFor="s-title" error={state.fields?.title}>
            <Input id="s-title" name="title" required maxLength={160} defaultValue={section?.title} />
          </Field>
          <Field label="Description" htmlFor="s-desc">
            <Textarea id="s-desc" name="description" rows={2} maxLength={2000} defaultValue={section?.description ?? ''} />
          </Field>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-label">Answered by</legend>
            {Object.entries(RESPONDENT_LABELS).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-small">
                <input
                  type="checkbox"
                  name="respondents"
                  value={value}
                  defaultChecked={section ? section.respondents.includes(value as keyof typeof RESPONDENT_LABELS) : value === 'MANAGER'}
                  className="size-4"
                />
                {label}
              </label>
            ))}
            {state.fields?.respondents && <p className="text-caption text-destructive">{state.fields.respondents}</p>}
          </fieldset>
        </>
      )}
    </EditorDialog>
  )
}

export function ReviewQuestionDialog({
  sectionId,
  question,
}: {
  sectionId: string
  question?: {
    id: string
    prompt: string
    question_type: keyof typeof QUESTION_TYPES
    guidance: string | null
    options: string[]
    is_required: boolean
    requires_evidence: boolean
  }
}) {
  const [type, setType] = React.useState<string>(question?.question_type ?? 'RATING')
  return (
    <EditorDialog
      title={question ? 'Edit question' : 'New question'}
      action={saveReviewQuestionAction}
      trigger={(open) =>
        question ? (
          <Button size="sm" variant="ghost" onClick={open} aria-label="Edit question">
            <Pencil aria-hidden />
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={open}>
            <Plus aria-hidden /> Question
          </Button>
        )
      }
    >
      {(state) => (
        <>
          <input type="hidden" name="sectionId" value={sectionId} />
          {question && <input type="hidden" name="questionId" value={question.id} />}
          <Field label="Question" htmlFor="rq-prompt" error={state.fields?.prompt}>
            <Textarea id="rq-prompt" name="prompt" rows={2} required maxLength={1000} defaultValue={question?.prompt} />
          </Field>
          <Field label="Type" htmlFor="rq-type">
            <select id="rq-type" name="type" value={type} onChange={(e) => setType(e.target.value)} className={inputClassName}>
              {Object.entries(QUESTION_TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          {type === 'MULTI_SELECT' && (
            <Field label="Options (one per line)" htmlFor="rq-options" error={state.fields?.options}>
              <Textarea id="rq-options" name="options" rows={4} defaultValue={question?.options.join('\n')} />
            </Field>
          )}
          <Field label="What good looks like (shown to reviewers)" htmlFor="rq-guidance">
            <Textarea id="rq-guidance" name="guidance" rows={3} maxLength={2000} defaultValue={question?.guidance ?? ''} />
          </Field>
          <Check name="required" label="Required" defaultChecked={question?.is_required ?? true} />
          <Check name="requiresEvidence" label="Answer must cite evidence" defaultChecked={question?.requires_evidence} />
        </>
      )}
    </EditorDialog>
  )
}

export function SetupRowActions({ kind, id, first, last, name }: { kind: 'section' | 'question'; id: string; first: boolean; last: boolean; name: string }) {
  const move = kind === 'section' ? moveSectionAction : moveReviewQuestionAction
  const remove = kind === 'section' ? deleteSectionAction : deleteReviewQuestionAction
  const key = kind === 'section' ? 'sectionId' : 'questionId'
  return (
    <span className="inline-flex">
      <ActionButton action={move} fields={{ [key]: id, direction: 'up' }} size="sm" variant="ghost" disabled={first} aria-label="Move up">
        <ArrowUp aria-hidden />
      </ActionButton>
      <ActionButton action={move} fields={{ [key]: id, direction: 'down' }} size="sm" variant="ghost" disabled={last} aria-label="Move down">
        <ArrowDown aria-hidden />
      </ActionButton>
      <ConfirmActionButton
        action={remove}
        fields={{ [key]: id }}
        title={`Delete this ${kind}?`}
        description={`“${name}” will be removed from the template.`}
        confirmLabel="Delete"
        destructive
        size="sm"
        variant="ghost"
        aria-label={`Delete ${name}`}
      >
        <Trash2 aria-hidden />
      </ConfirmActionButton>
    </span>
  )
}

// ── Cycles ──────────────────────────────────────────────────────────────────

export function CycleDialog({
  cycle,
  templates,
  departments,
}: {
  cycle?: {
    id: string
    name: string
    cycle_type: keyof typeof CYCLE_TYPES
    template_id: string
    start_date: string
    due_date: string
    department_id: string | null
    self_review_enabled: boolean
    mentor_review_enabled: boolean
    hr_review_enabled: boolean
  }
  templates: Option[]
  departments: Option[]
}) {
  const router = useRouter()
  return (
    <EditorDialog
      title={cycle ? 'Edit cycle' : 'New review cycle'}
      description="Opening a cycle creates one review for each intern in the programme (in the department, if chosen)."
      action={saveCycleAction}
      onSuccess={(s) => !cycle && s.data && router.push(`/performance/cycles/${s.data.id}`)}
      trigger={(open) =>
        cycle ? (
          <Button variant="outline" onClick={open}>
            <Pencil aria-hidden /> Edit
          </Button>
        ) : (
          <Button onClick={open} disabled={!templates.length}>
            <Plus aria-hidden /> New cycle
          </Button>
        )
      }
    >
      {(state) => (
        <>
          {cycle && <input type="hidden" name="cycleId" value={cycle.id} />}
          <Field label="Name" htmlFor="cy-name" error={state.fields?.name}>
            <Input id="cy-name" name="name" required minLength={3} maxLength={160} defaultValue={cycle?.name} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="cy-type">
              <Select id="cy-type" name="type" defaultValue={cycle?.cycle_type ?? 'MIDPOINT'} options={Object.entries(CYCLE_TYPES).map(([value, label]) => ({ value, label }))} />
            </Field>
            <Field label="Template" htmlFor="cy-template" error={state.fields?.templateId}>
              <Select id="cy-template" name="templateId" defaultValue={cycle?.template_id} options={templates.map((t) => ({ value: t.id, label: t.name }))} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Period start" htmlFor="cy-start" error={state.fields?.startDate}>
              <Input id="cy-start" name="startDate" type="date" required defaultValue={cycle?.start_date} />
            </Field>
            <Field label="Due" htmlFor="cy-due" error={state.fields?.dueDate}>
              <Input id="cy-due" name="dueDate" type="date" required defaultValue={cycle?.due_date} />
            </Field>
            <Field label="Department" htmlFor="cy-dept">
              <Select
                id="cy-dept"
                name="departmentId"
                defaultValue={cycle?.department_id}
                empty="All departments"
                options={departments.map((d) => ({ value: d.id, label: d.name }))}
              />
            </Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-label">Stages (manager review is always included)</legend>
            <Check name="selfReview" label="Self-review first" defaultChecked={cycle?.self_review_enabled ?? true} />
            <Check name="mentorReview" label="Mentor review (when the intern has a mentor)" defaultChecked={cycle?.mentor_review_enabled ?? true} />
            <Check name="hrReview" label="HR review and sign-off" defaultChecked={cycle?.hr_review_enabled ?? true} />
          </fieldset>
        </>
      )}
    </EditorDialog>
  )
}

// ── Development plans ───────────────────────────────────────────────────────

export function CreatePlanDialog({ internId, reviewId }: { internId: string; reviewId?: string }) {
  const router = useRouter()
  return (
    <EditorDialog
      title="New development plan"
      action={createDevelopmentPlanAction}
      onSuccess={(s) => s.data && router.push(`/performance/development/${s.data.id}`)}
      trigger={(open) => (
        <Button variant="outline" onClick={open}>
          <Plus aria-hidden /> Development plan
        </Button>
      )}
    >
      {(state) => (
        <>
          <input type="hidden" name="internId" value={internId} />
          {reviewId && <input type="hidden" name="reviewId" value={reviewId} />}
          <Field label="Title" htmlFor="dp-title" error={state.fields?.title}>
            <Input id="dp-title" name="title" required minLength={3} maxLength={200} placeholder="e.g. Final-month development plan" />
          </Field>
          {reviewId && <p className="text-caption text-muted-foreground">The intern sees this plan once the review is completed.</p>}
        </>
      )}
    </EditorDialog>
  )
}

export function PlanItemDialog({
  planId,
  item,
  owners,
  courses,
  goals,
}: {
  planId: string
  item?: { id: string; area: string; action: string; owner_id: string | null; target_date: string | null; course_id: string | null; goal_id: string | null }
  owners: Option[]
  courses: { id: string; title: string }[]
  goals: { id: string; title: string }[]
}) {
  return (
    <EditorDialog
      title={item ? 'Edit item' : 'Add focus area'}
      action={saveDevelopmentItemAction}
      trigger={(open) =>
        item ? (
          <Button size="sm" variant="ghost" onClick={open} aria-label={`Edit ${item.area}`}>
            <Pencil aria-hidden />
          </Button>
        ) : (
          <Button variant="outline" onClick={open}>
            <Plus aria-hidden /> Focus area
          </Button>
        )
      }
    >
      {(state) => (
        <>
          <input type="hidden" name="planId" value={planId} />
          {item && <input type="hidden" name="itemId" value={item.id} />}
          <Field label="Focus area" htmlFor="pi-area" error={state.fields?.area}>
            <Input id="pi-area" name="area" required maxLength={200} defaultValue={item?.area} placeholder="e.g. Written communication" />
          </Field>
          <Field label="Action" htmlFor="pi-action" error={state.fields?.action}>
            <Textarea id="pi-action" name="action" rows={3} required maxLength={2000} defaultValue={item?.action} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Owner" htmlFor="pi-owner">
              <Select id="pi-owner" name="ownerId" defaultValue={item?.owner_id} options={owners.map((o) => ({ value: o.id, label: o.name }))} />
            </Field>
            <Field label="Target date" htmlFor="pi-target" error={state.fields?.targetDate}>
              <Input id="pi-target" name="targetDate" type="date" defaultValue={item?.target_date ?? ''} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Recommended course" htmlFor="pi-course" error={state.fields?.courseId}>
              <Select id="pi-course" name="courseId" defaultValue={item?.course_id} empty="None" options={courses.map((c) => ({ value: c.id, label: c.title }))} />
            </Field>
            <Field label="Linked goal" htmlFor="pi-goal" error={state.fields?.goalId}>
              <Select id="pi-goal" name="goalId" defaultValue={item?.goal_id} empty="None" options={goals.map((g) => ({ value: g.id, label: g.title }))} />
            </Field>
          </div>
        </>
      )}
    </EditorDialog>
  )
}

export function PlanItemStatusDialog({
  item,
  allowCancel,
}: {
  item: { id: string; area: string; status: keyof typeof DEVELOPMENT_ITEM_STATUS_LABELS; evidence: string | null }
  allowCancel: boolean
}) {
  return (
    <EditorDialog
      title={`Update “${item.area}”`}
      action={developmentItemStatusAction}
      trigger={(open) => (
        <Button size="sm" variant="outline" onClick={open}>
          Update
        </Button>
      )}
    >
      {(state) => (
        <>
          <input type="hidden" name="itemId" value={item.id} />
          <Field label="Status" htmlFor="ps-status" error={state.fields?.status}>
            <Select
              id="ps-status"
              name="status"
              defaultValue={item.status}
              options={Object.entries(DEVELOPMENT_ITEM_STATUS_LABELS)
                .filter(([value]) => allowCancel || value !== 'CANCELLED')
                .map(([value, label]) => ({ value, label }))}
            />
          </Field>
          <Field label="Evidence / notes" htmlFor="ps-evidence">
            <Textarea id="ps-evidence" name="evidence" rows={3} maxLength={2000} defaultValue={item.evidence ?? ''} />
          </Field>
        </>
      )}
    </EditorDialog>
  )
}
