'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, inputClassName, Textarea } from '@/components/ui/input'
import { Field } from '@/features/auth/components/form-bits'
import { ActionButton } from '@/features/hr/components/action-form'
import { ANSWER_POLICY_LABELS, QUESTION_TYPE_LABELS } from '@/lib/learning/quiz'
import { CONTENT_TYPE_LABELS, DIFFICULTY_LABELS } from '@/lib/learning/rules'
import {
  deleteAssignmentAction,
  deleteLessonAction,
  deleteModuleAction,
  deleteQuestionAction,
  deleteQuizAction,
  moveLessonAction,
  moveModuleAction,
  saveAssignmentAction,
  saveCategoryAction,
  saveCourseAction,
  saveLessonAction,
  saveModuleAction,
  saveQuestionAction,
  saveQuizAction,
} from '@/server/actions/learning'
import { Check, EditorDialog, Select } from '@/components/forms/editor-dialog'
import { ConfirmActionButton } from './confirm-action'

/**
 * Course authoring dialogs. Every save goes through a server action whose
 * service validates the input (URLs, question shape, rubric for points) —
 * these forms only collect values.
 */

function EditButton({ open, label }: { open: () => void; label: string }) {
  return (
    <Button type="button" size="sm" variant="ghost" onClick={open} aria-label={label}>
      <Pencil aria-hidden />
    </Button>
  )
}

function AddButton({ open, children, variant = 'outline' }: { open: () => void; children: React.ReactNode; variant?: 'outline' | 'default' }) {
  return (
    <Button type="button" size="sm" variant={variant} onClick={open}>
      <Plus aria-hidden /> {children}
    </Button>
  )
}

// ── Course ─────────────────────────────────────────────────────────────────

export interface CourseFormValues {
  id: string
  title: string
  description: string | null
  category_id: string | null
  difficulty: keyof typeof DIFFICULTY_LABELS
  estimated_minutes: number | null
  is_required: boolean
  is_sequential: boolean
  require_quizzes: boolean
  require_assignments: boolean
}

export function CourseDialog({
  course,
  categories,
}: {
  course?: CourseFormValues
  categories: { id: string; name: string }[]
}) {
  const router = useRouter()
  return (
    <EditorDialog
      title={course ? 'Course details' : 'New course'}
      description="A new course starts as a draft with one module."
      action={saveCourseAction}
      onSuccess={(s) => !course && s.data && router.push(`/learning/manage/courses/${s.data.id}`)}
      trigger={(open) =>
        course ? (
          <Button variant="outline" onClick={open}>
            <Pencil aria-hidden /> Edit details
          </Button>
        ) : (
          <Button onClick={open}>
            <Plus aria-hidden /> New course
          </Button>
        )
      }
    >
      {(state) => (
        <>
          {course && <input type="hidden" name="courseId" value={course.id} />}
          <Field label="Title" htmlFor="c-title" error={state.fields?.title}>
            <Input id="c-title" name="title" required minLength={3} maxLength={160} defaultValue={course?.title} />
          </Field>
          <Field label="Description" htmlFor="c-desc" error={state.fields?.description}>
            <Textarea id="c-desc" name="description" rows={3} maxLength={2000} defaultValue={course?.description ?? ''} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Category" htmlFor="c-cat" error={state.fields?.categoryId}>
              <Select
                id="c-cat"
                name="categoryId"
                defaultValue={course?.category_id}
                empty="None"
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>
            <Field label="Difficulty" htmlFor="c-diff">
              <Select
                id="c-diff"
                name="difficulty"
                defaultValue={course?.difficulty ?? 'BEGINNER'}
                options={Object.entries(DIFFICULTY_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            <Field label="Estimated minutes" htmlFor="c-min" error={state.fields?.estimatedMinutes}>
              <Input id="c-min" name="estimatedMinutes" type="number" min={1} defaultValue={course?.estimated_minutes ?? ''} />
            </Field>
          </div>
          <fieldset className="grid gap-2.5">
            <legend className="mb-1 text-label">Rules</legend>
            <Check name="isRequired" label="Required course" defaultChecked={course?.is_required} hint="Shown as required training in the catalog." />
            <Check name="isSequential" label="Lessons unlock in order" defaultChecked={course?.is_sequential ?? true} />
            <Check name="requireQuizzes" label="Completion needs the required quizzes passed" defaultChecked={course?.require_quizzes ?? true} />
            <Check
              name="requireAssignments"
              label="Completion needs the required assignments approved"
              defaultChecked={course?.require_assignments}
            />
          </fieldset>
        </>
      )}
    </EditorDialog>
  )
}

export function CategoryDialog({ category }: { category?: { id: string; name: string; description: string | null; is_active: boolean } }) {
  return (
    <EditorDialog
      title={category ? 'Edit category' : 'New category'}
      action={saveCategoryAction}
      trigger={(open) => (category ? <EditButton open={open} label={`Edit ${category.name}`} /> : <AddButton open={open}>Category</AddButton>)}
    >
      {(state) => (
        <>
          {category && <input type="hidden" name="categoryId" value={category.id} />}
          <Field label="Name" htmlFor="cat-name" error={state.fields?.name}>
            <Input id="cat-name" name="name" required maxLength={80} defaultValue={category?.name} />
          </Field>
          <Field label="Description" htmlFor="cat-desc">
            <Input id="cat-desc" name="description" maxLength={300} defaultValue={category?.description ?? ''} />
          </Field>
          <Check name="isActive" label="Active" defaultChecked={category?.is_active ?? true} />
        </>
      )}
    </EditorDialog>
  )
}

// ── Modules and lessons ─────────────────────────────────────────────────────

export function ModuleDialog({ courseId, module }: { courseId: string; module?: { id: string; title: string; description: string | null } }) {
  return (
    <EditorDialog
      title={module ? 'Edit module' : 'New module'}
      action={saveModuleAction}
      trigger={(open) => (module ? <EditButton open={open} label={`Edit ${module.title}`} /> : <AddButton open={open}>Module</AddButton>)}
    >
      {(state) => (
        <>
          <input type="hidden" name="courseId" value={courseId} />
          {module && <input type="hidden" name="moduleId" value={module.id} />}
          <Field label="Title" htmlFor="m-title" error={state.fields?.title}>
            <Input id="m-title" name="title" required maxLength={160} defaultValue={module?.title} />
          </Field>
          <Field label="Description" htmlFor="m-desc">
            <Textarea id="m-desc" name="description" rows={2} maxLength={1000} defaultValue={module?.description ?? ''} />
          </Field>
        </>
      )}
    </EditorDialog>
  )
}

export interface LessonFormValues {
  id: string
  title: string
  description: string | null
  content_type: keyof typeof CONTENT_TYPE_LABELS
  content: string | null
  video_url: string | null
  document_url: string | null
  link_url: string | null
  estimated_minutes: number | null
  is_required: boolean
}

export function LessonDialog({ moduleId, lesson }: { moduleId: string; lesson?: LessonFormValues }) {
  const [type, setType] = React.useState<string>(lesson?.content_type ?? 'TEXT')
  return (
    <EditorDialog
      wide
      title={lesson ? 'Edit lesson' : 'New lesson'}
      description="Text supports “# ” headings and “- ” bullet lists. Links must be https://."
      action={saveLessonAction}
      trigger={(open) => (lesson ? <EditButton open={open} label={`Edit ${lesson.title}`} /> : <AddButton open={open}>Lesson</AddButton>)}
    >
      {(state) => (
        <>
          <input type="hidden" name="moduleId" value={moduleId} />
          {lesson && <input type="hidden" name="lessonId" value={lesson.id} />}
          <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
            <Field label="Title" htmlFor="l-title" error={state.fields?.title}>
              <Input id="l-title" name="title" required maxLength={160} defaultValue={lesson?.title} />
            </Field>
            <Field label="Type" htmlFor="l-type">
              <select id="l-type" name="contentType" value={type} onChange={(e) => setType(e.target.value)} className={inputClassName}>
                {Object.entries(CONTENT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Summary" htmlFor="l-desc">
            <Input id="l-desc" name="description" maxLength={500} defaultValue={lesson?.description ?? ''} />
          </Field>
          {type === 'VIDEO' && (
            <Field label="Video link" htmlFor="l-video" error={state.fields?.videoUrl}>
              <Input id="l-video" name="videoUrl" type="url" placeholder="https://" defaultValue={lesson?.video_url ?? ''} />
            </Field>
          )}
          {type === 'DOCUMENT' && (
            <Field label="Document link" htmlFor="l-doc" error={state.fields?.documentUrl}>
              <Input id="l-doc" name="documentUrl" type="url" placeholder="https://" defaultValue={lesson?.document_url ?? ''} />
            </Field>
          )}
          {type === 'LINK' && (
            <Field label="Resource link" htmlFor="l-link" error={state.fields?.linkUrl}>
              <Input id="l-link" name="linkUrl" type="url" placeholder="https://" defaultValue={lesson?.link_url ?? ''} />
            </Field>
          )}
          <Field label={type === 'TEXT' ? 'Lesson text' : 'Notes (optional)'} htmlFor="l-content" error={state.fields?.content}>
            <Textarea id="l-content" name="content" rows={10} maxLength={50000} defaultValue={lesson?.content ?? ''} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Estimated minutes" htmlFor="l-min" error={state.fields?.estimatedMinutes}>
              <Input id="l-min" name="estimatedMinutes" type="number" min={1} max={1000} defaultValue={lesson?.estimated_minutes ?? ''} />
            </Field>
            <div className="self-end pb-2">
              <Check name="isRequired" label="Required for completion" defaultChecked={lesson?.is_required ?? true} />
            </div>
          </div>
        </>
      )}
    </EditorDialog>
  )
}

export function MoveButtons({ kind, id, first, last }: { kind: 'module' | 'lesson'; id: string; first: boolean; last: boolean }) {
  const action = kind === 'module' ? moveModuleAction : moveLessonAction
  const key = kind === 'module' ? 'moduleId' : 'lessonId'
  return (
    <span className="inline-flex">
      <ActionButton action={action} fields={{ [key]: id, direction: 'up' }} size="sm" variant="ghost" disabled={first} aria-label="Move up">
        <ArrowUp aria-hidden />
      </ActionButton>
      <ActionButton action={action} fields={{ [key]: id, direction: 'down' }} size="sm" variant="ghost" disabled={last} aria-label="Move down">
        <ArrowDown aria-hidden />
      </ActionButton>
    </span>
  )
}

const DELETE = {
  module: { action: deleteModuleAction, key: 'moduleId', what: 'module' },
  lesson: { action: deleteLessonAction, key: 'lessonId', what: 'lesson' },
  quiz: { action: deleteQuizAction, key: 'quizId', what: 'quiz' },
  question: { action: deleteQuestionAction, key: 'questionId', what: 'question' },
  assignment: { action: deleteAssignmentAction, key: 'assignmentId', what: 'assignment' },
} as const

export function DeleteButton({ kind, id, name }: { kind: keyof typeof DELETE; id: string; name: string }) {
  const { action, key, what } = DELETE[kind]
  return (
    <ConfirmActionButton
      action={action}
      fields={{ [key]: id }}
      title={`Delete this ${what}?`}
      description={`“${name}” will be removed. This isn’t possible once learners have used it.`}
      confirmLabel="Delete"
      destructive
      size="sm"
      variant="ghost"
      aria-label={`Delete ${name}`}
    >
      <Trash2 aria-hidden />
    </ConfirmActionButton>
  )
}

// ── Quizzes ─────────────────────────────────────────────────────────────────

export interface QuizFormValues {
  id: string
  module_id: string | null
  title: string
  description: string | null
  passing_score: number
  attempt_limit: number | null
  time_limit_minutes: number | null
  answer_policy: keyof typeof ANSWER_POLICY_LABELS
  is_required: boolean
}

export function QuizDialog({
  courseId,
  modules,
  quiz,
}: {
  courseId: string
  modules: { id: string; title: string }[]
  quiz?: QuizFormValues
}) {
  return (
    <EditorDialog
      title={quiz ? 'Quiz settings' : 'New quiz'}
      description="New quizzes start as drafts; publish them once they have questions."
      action={saveQuizAction}
      trigger={(open) => (quiz ? <EditButton open={open} label={`Edit ${quiz.title}`} /> : <AddButton open={open}>Quiz</AddButton>)}
    >
      {(state) => (
        <>
          <input type="hidden" name="courseId" value={courseId} />
          {quiz && <input type="hidden" name="quizId" value={quiz.id} />}
          <Field label="Title" htmlFor="q-title" error={state.fields?.title}>
            <Input id="q-title" name="title" required maxLength={160} defaultValue={quiz?.title} />
          </Field>
          <Field label="Description" htmlFor="q-desc">
            <Input id="q-desc" name="description" maxLength={1000} defaultValue={quiz?.description ?? ''} />
          </Field>
          <Field label="Module" htmlFor="q-module">
            <Select
              id="q-module"
              name="moduleId"
              defaultValue={quiz?.module_id}
              empty="Course level (final assessment)"
              options={modules.map((m) => ({ value: m.id, label: m.title }))}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Pass mark (%)" htmlFor="q-pass" error={state.fields?.passingScore}>
              <Input id="q-pass" name="passingScore" type="number" min={0} max={100} required defaultValue={quiz?.passing_score ?? 70} />
            </Field>
            <Field label="Attempts" htmlFor="q-attempts" hint="Empty = unlimited" error={state.fields?.attemptLimit}>
              <Input id="q-attempts" name="attemptLimit" type="number" min={1} max={20} defaultValue={quiz?.attempt_limit ?? ''} />
            </Field>
            <Field label="Time limit (min)" htmlFor="q-time" hint="Empty = none" error={state.fields?.timeLimitMinutes}>
              <Input id="q-time" name="timeLimitMinutes" type="number" min={1} max={600} defaultValue={quiz?.time_limit_minutes ?? ''} />
            </Field>
          </div>
          <Field label="Show correct answers" htmlFor="q-policy">
            <Select
              id="q-policy"
              name="answerPolicy"
              defaultValue={quiz?.answer_policy ?? 'AFTER_SUBMISSION'}
              options={Object.entries(ANSWER_POLICY_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </Field>
          <Check name="isRequired" label="Required for completion" defaultChecked={quiz?.is_required ?? true} />
        </>
      )}
    </EditorDialog>
  )
}

export interface QuestionFormValues {
  id: string
  question: string
  question_type: keyof typeof QUESTION_TYPE_LABELS
  points: number
  explanation: string | null
  accepted_answers: string[]
  options: { option_text: string; is_correct: boolean }[]
}

export function QuestionDialog({ quizId, question }: { quizId: string; question?: QuestionFormValues }) {
  const [type, setType] = React.useState<string>(question?.question_type ?? 'MULTIPLE_CHOICE')
  const initial = question?.options.length ? question.options : [{ option_text: '', is_correct: false }, { option_text: '', is_correct: false }]
  const [options, setOptions] = React.useState(initial)
  const tfCorrect = question?.question_type === 'TRUE_FALSE' ? (question.options.findIndex((o) => o.is_correct) === 1 ? 1 : 0) : 0
  return (
    <EditorDialog
      wide
      title={question ? 'Edit question' : 'New question'}
      description="Correct answers stay on the server; learners never receive them before submitting."
      action={saveQuestionAction}
      trigger={(open) => (question ? <EditButton open={open} label="Edit question" /> : <AddButton open={open}>Question</AddButton>)}
    >
      {(state) => (
        <>
          <input type="hidden" name="quizId" value={quizId} />
          {question && <input type="hidden" name="questionId" value={question.id} />}
          <Field label="Question" htmlFor="qq-text" error={state.fields?.question}>
            <Textarea id="qq-text" name="question" rows={2} required maxLength={1000} defaultValue={question?.question} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="qq-type">
              <select id="qq-type" name="type" value={type} onChange={(e) => setType(e.target.value)} className={inputClassName}>
                {Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Points" htmlFor="qq-points" error={state.fields?.points}>
              <Input id="qq-points" name="points" type="number" min={1} max={100} required defaultValue={question?.points ?? 1} />
            </Field>
          </div>
          {type === 'TRUE_FALSE' && (
            <fieldset className="grid gap-2 text-small">
              <legend className="mb-1 text-label">Correct answer</legend>
              {['True', 'False'].map((label, index) => (
                <label key={label} className="flex items-center gap-2">
                  <input type="radio" name="correctOptions" value={index} defaultChecked={tfCorrect === index} />
                  {label}
                </label>
              ))}
            </fieldset>
          )}
          {type === 'MULTIPLE_CHOICE' && (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-label">Options — tick every correct one</legend>
              {options.map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="correctOptions"
                    value={index}
                    defaultChecked={option.is_correct}
                    aria-label={`Option ${index + 1} is correct`}
                    className="size-4"
                  />
                  <Input name="options" defaultValue={option.option_text} maxLength={300} aria-label={`Option ${index + 1}`} />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={options.length <= 2}
                    onClick={() => setOptions(options.filter((_, i) => i !== index))}
                    aria-label={`Remove option ${index + 1}`}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              ))}
              {options.length < 8 && (
                <div>
                  <Button type="button" size="sm" variant="outline" onClick={() => setOptions([...options, { option_text: '', is_correct: false }])}>
                    <Plus aria-hidden /> Option
                  </Button>
                </div>
              )}
              {state.fields?.options && <p className="text-caption text-destructive">{state.fields.options}</p>}
            </fieldset>
          )}
          {type === 'SHORT_ANSWER' && (
            <Field
              label="Accepted answers"
              htmlFor="qq-accepted"
              hint="One per line. Matching ignores case and extra spaces."
              error={state.fields?.acceptedAnswers}
            >
              <AcceptedAnswers initial={question?.accepted_answers ?? []} />
            </Field>
          )}
          <Field label="Explanation (shown with the answers)" htmlFor="qq-expl">
            <Textarea id="qq-expl" name="explanation" rows={2} maxLength={1000} defaultValue={question?.explanation ?? ''} />
          </Field>
        </>
      )}
    </EditorDialog>
  )
}

/** One textarea, sent as repeated acceptedAnswers fields. */
function AcceptedAnswers({ initial }: { initial: string[] }) {
  const [value, setValue] = React.useState(initial.join('\n'))
  const lines = value
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  return (
    <>
      <Textarea id="qq-accepted" rows={3} value={value} onChange={(e) => setValue(e.target.value)} />
      {lines.map((line, i) => (
        <input key={i} type="hidden" name="acceptedAnswers" value={line} />
      ))}
    </>
  )
}

// ── Assignments ─────────────────────────────────────────────────────────────

export interface AssignmentFormValues {
  id: string
  module_id: string | null
  title: string
  description: string | null
  instructions: string | null
  due_days: number | null
  max_points: number | null
  rubric: string | null
  is_required: boolean
}

export function AssignmentDialog({
  courseId,
  modules,
  assignment,
}: {
  courseId: string
  modules: { id: string; title: string }[]
  assignment?: AssignmentFormValues
}) {
  return (
    <EditorDialog
      wide
      title={assignment ? 'Edit assignment' : 'New assignment'}
      description="Learners submit work (text and files); a manager or mentor reviews it."
      action={saveAssignmentAction}
      trigger={(open) =>
        assignment ? <EditButton open={open} label={`Edit ${assignment.title}`} /> : <AddButton open={open}>Assignment</AddButton>
      }
    >
      {(state) => (
        <>
          <input type="hidden" name="courseId" value={courseId} />
          {assignment && <input type="hidden" name="assignmentId" value={assignment.id} />}
          <Field label="Title" htmlFor="a-title" error={state.fields?.title}>
            <Input id="a-title" name="title" required maxLength={160} defaultValue={assignment?.title} />
          </Field>
          <Field label="Summary" htmlFor="a-desc">
            <Input id="a-desc" name="description" maxLength={1000} defaultValue={assignment?.description ?? ''} />
          </Field>
          <Field label="Instructions" htmlFor="a-instr" error={state.fields?.instructions}>
            <Textarea id="a-instr" name="instructions" rows={6} maxLength={10000} defaultValue={assignment?.instructions ?? ''} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Module" htmlFor="a-module">
              <Select
                id="a-module"
                name="moduleId"
                defaultValue={assignment?.module_id}
                empty="Course level"
                options={modules.map((m) => ({ value: m.id, label: m.title }))}
              />
            </Field>
            <Field label="Due (days after enrolling)" htmlFor="a-due" error={state.fields?.dueDays}>
              <Input id="a-due" name="dueDays" type="number" min={1} max={365} defaultValue={assignment?.due_days ?? ''} />
            </Field>
            <Field label="Points (optional)" htmlFor="a-points" error={state.fields?.maxPoints}>
              <Input id="a-points" name="maxPoints" type="number" min={1} max={1000} defaultValue={assignment?.max_points ?? ''} />
            </Field>
          </div>
          <Field label="Rubric (required when scored)" htmlFor="a-rubric" error={state.fields?.rubric}>
            <Textarea id="a-rubric" name="rubric" rows={4} maxLength={5000} defaultValue={assignment?.rubric ?? ''} />
          </Field>
          <Check name="isRequired" label="Required for completion" defaultChecked={assignment?.is_required ?? true} />
        </>
      )}
    </EditorDialog>
  )
}
