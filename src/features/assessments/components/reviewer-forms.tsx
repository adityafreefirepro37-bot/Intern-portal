'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Sparkles, Trash2 } from 'lucide-react'
import { useToast } from '@/components/feedback/toast'
import { Button } from '@/components/ui/button'
import { Input, inputClassName, Textarea } from '@/components/ui/input'
import { ActionButton, ReasonDialog } from '@/features/hr/components/action-form'
import { cn } from '@/lib/utils'
import {
  approveAssessmentAction,
  gradeAssessmentAction,
  regenerateAssessmentAction,
  saveAssessmentQuestionsAction,
  waiveAssessmentAction,
} from '@/server/actions/assessments'

type Kind = 'MULTIPLE_CHOICE' | 'SHORT_ANSWER'
export interface EditableQuestion {
  kind: Kind
  prompt: string
  options: string[]
  correct: number
  points: number
  rubric: string
}

const blank = (kind: Kind): EditableQuestion =>
  kind === 'MULTIPLE_CHOICE'
    ? { kind, prompt: '', options: ['', '', '', ''], correct: 0, points: 1, rubric: '' }
    : { kind, prompt: '', options: [], correct: 0, points: 3, rubric: '' }

/** Edit, save and approve the questions (before the intern can take the assessment). */
export function QuestionEditor({
  assessmentId,
  initial,
  settings,
  aiAvailable,
}: {
  assessmentId: string
  initial: EditableQuestion[]
  settings: { timeLimitMinutes: number; passPercent: number; maxViolations: number }
  aiAvailable: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [questions, setQuestions] = React.useState(initial)
  const [s, setS] = React.useState(settings)
  const [saving, setSaving] = React.useState(false)
  const [dirty, setDirty] = React.useState(false)

  function update(i: number, patch: Partial<EditableQuestion>) {
    setDirty(true)
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)))
  }

  async function save() {
    setSaving(true)
    const result = await saveAssessmentQuestionsAction({
      assessmentId,
      timeLimitMinutes: s.timeLimitMinutes,
      passPercent: s.passPercent,
      maxViolations: s.maxViolations,
      questions: questions.map((q) =>
        q.kind === 'MULTIPLE_CHOICE'
          ? { kind: q.kind, prompt: q.prompt, options: q.options, correct: q.correct, points: q.points }
          : { kind: q.kind, prompt: q.prompt, rubric: q.rubric || undefined, points: q.points },
      ),
    })
    setSaving(false)
    toast({ title: result.message ?? (result.status === 'success' ? 'Saved' : 'Could not save'), variant: result.status === 'success' ? 'success' : 'error' })
    if (result.status === 'success') {
      setDirty(false)
      router.refresh()
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-caption text-muted-foreground">
          Time limit (minutes)
          <Input type="number" min={5} max={120} value={s.timeLimitMinutes} onChange={(e) => (setDirty(true), setS({ ...s, timeLimitMinutes: Number(e.target.value) }))} />
        </label>
        <label className="grid gap-1 text-caption text-muted-foreground">
          Pass mark (%)
          <Input type="number" min={0} max={100} value={s.passPercent} onChange={(e) => (setDirty(true), setS({ ...s, passPercent: Number(e.target.value) }))} />
        </label>
        <label className="grid gap-1 text-caption text-muted-foreground">
          Violations before auto-submit
          <Input type="number" min={0} max={20} value={s.maxViolations} onChange={(e) => (setDirty(true), setS({ ...s, maxViolations: Number(e.target.value) }))} />
        </label>
      </div>

      <ol className="space-y-4">
        {questions.map((q, i) => (
          <li key={i} className="space-y-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-small font-medium">Question {i + 1}</span>
              <span className="rounded bg-muted px-1.5 text-caption">{q.kind === 'MULTIPLE_CHOICE' ? 'Multiple choice' : 'Short answer'}</span>
              <label className="ml-auto flex items-center gap-1 text-caption text-muted-foreground">
                Points
                <Input type="number" min={1} max={20} value={q.points} onChange={(e) => update(i, { points: Number(e.target.value) })} className="h-8 w-16" />
              </label>
              <Button variant="ghost" size="icon-sm" aria-label={`Remove question ${i + 1}`} onClick={() => (setDirty(true), setQuestions((qs) => qs.filter((_, j) => j !== i)))}>
                <Trash2 aria-hidden />
              </Button>
            </div>
            <Textarea rows={2} value={q.prompt} onChange={(e) => update(i, { prompt: e.target.value })} aria-label={`Question ${i + 1}`} />
            {q.kind === 'MULTIPLE_CHOICE' ? (
              <div className="grid gap-2" role="radiogroup" aria-label="Options (select the correct one)">
                {q.options.map((option, oi) => (
                  <label key={oi} className={cn('flex items-center gap-2 rounded-md border p-1.5', q.correct === oi && 'border-success bg-success/5')}>
                    <input type="radio" name={`correct-${i}`} checked={q.correct === oi} onChange={() => update(i, { correct: oi })} className="accent-primary" aria-label={`Option ${oi + 1} is correct`} />
                    <input
                      value={option}
                      onChange={(e) => update(i, { options: q.options.map((o, k) => (k === oi ? e.target.value : o)) })}
                      className={cn(inputClassName, 'h-8 flex-1')}
                      aria-label={`Option ${oi + 1}`}
                    />
                  </label>
                ))}
                <p className="text-caption text-muted-foreground">Select the correct option. Interns never see which one it is.</p>
              </div>
            ) : (
              <label className="grid gap-1 text-caption text-muted-foreground">
                What a good answer covers (rubric, used for grading)
                <Textarea rows={2} value={q.rubric} onChange={(e) => update(i, { rubric: e.target.value })} />
              </label>
            )}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => (setDirty(true), setQuestions((qs) => [...qs, blank('MULTIPLE_CHOICE')]))}>
          <Plus aria-hidden /> Multiple choice
        </Button>
        <Button variant="outline" size="sm" onClick={() => (setDirty(true), setQuestions((qs) => [...qs, blank('SHORT_ANSWER')]))}>
          <Plus aria-hidden /> Short answer
        </Button>
        {aiAvailable && (
          <ActionButton action={regenerateAssessmentAction} fields={{ assessmentId }} variant="ghost" size="sm">
            <Sparkles aria-hidden /> Redraft with AI
          </ActionButton>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save questions'}
        </Button>
        <ActionButton action={approveAssessmentAction} fields={{ assessmentId }} disabled={dirty || questions.length === 0}>
          Approve and send to intern
        </ActionButton>
        {dirty && <span className="text-caption text-muted-foreground">Save your changes before approving.</span>}
      </div>
    </div>
  )
}

/** Final points for short answers (AI suggestions pre-filled); multiple choice is already marked. */
export function GradingForm({
  assessmentId,
  answers,
}: {
  assessmentId: string
  answers: { answerId: string; max: number; suggested: number | null; current: number | null }[]
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [points, setPoints] = React.useState<Record<string, number>>(
    Object.fromEntries(answers.map((a) => [a.answerId, a.current ?? a.suggested ?? 0])),
  )
  const [busy, setBusy] = React.useState(false)
  async function submit() {
    setBusy(true)
    const result = await gradeAssessmentAction({ assessmentId, points })
    setBusy(false)
    toast({ title: result.message ?? 'Done', variant: result.status === 'success' ? 'success' : 'error' })
    if (result.status === 'success') router.refresh()
  }
  return (
    <div className="space-y-3">
      {answers.map((a, i) => (
        <label key={a.answerId} className="flex items-center gap-2 text-small" data-answer={a.answerId}>
          Short answer {i + 1}
          <Input
            type="number"
            min={0}
            max={a.max}
            step={0.5}
            value={points[a.answerId] ?? 0}
            onChange={(e) => setPoints((p) => ({ ...p, [a.answerId]: Number(e.target.value) }))}
            className="h-8 w-20"
          />
          <span className="text-caption text-muted-foreground">
            / {a.max}
            {a.suggested !== null && ` · AI suggests ${a.suggested}`}
          </span>
        </label>
      ))}
      <Button onClick={submit} disabled={busy}>
        {busy ? 'Saving…' : 'Save grade'}
      </Button>
    </div>
  )
}

export function WaiveButton({ assessmentId }: { assessmentId: string }) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setOpen(true)}>
        Waive assessment
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title="Waive this assessment?"
        description="The task can then be approved without it. The reason is recorded in the audit trail."
        action={waiveAssessmentAction}
        fields={{ assessmentId }}
        reasonName="reason"
        confirmLabel="Waive"
        destructive
      />
    </>
  )
}
