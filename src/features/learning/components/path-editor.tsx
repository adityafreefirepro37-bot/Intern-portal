'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { useFormAction } from '@/features/interns/components/use-form-action'
import { saveRequiredRuleAction, savePathAction, setPathCoursesAction } from '@/server/actions/learning'

interface Option {
  id: string
  name: string
}

export function PathDialog({
  path,
  departments,
  positions,
}: {
  path?: { id: string; name: string; description: string | null; department_id: string | null; position_id: string | null }
  departments: Option[]
  positions: Option[]
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [state, action] = useFormAction(savePathAction, {
    onSuccess: (s) => {
      setOpen(false)
      if (!path && s.data) router.push(`/learning/paths/${s.data.id}`)
    },
  })
  return (
    <>
      {path ? (
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Pencil aria-hidden /> Edit details
        </Button>
      ) : (
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Plus aria-hidden /> New path
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{path ? 'Edit learning path' : 'New learning path'}</DialogTitle>
            <DialogDescription>An ordered set of courses, e.g. for a role. Department and position are used for recommendations.</DialogDescription>
          </DialogHeader>
          <form action={action} className="grid gap-4">
            <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
            {path && <input type="hidden" name="pathId" value={path.id} />}
            <Field label="Name" htmlFor="p-name" error={state.fields?.name}>
              <Input id="p-name" name="name" required minLength={3} maxLength={160} defaultValue={path?.name} />
            </Field>
            <Field label="Description" htmlFor="p-desc">
              <Textarea id="p-desc" name="description" rows={3} maxLength={2000} defaultValue={path?.description ?? ''} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Department" htmlFor="p-dept">
                <select id="p-dept" name="departmentId" defaultValue={path?.department_id ?? ''} className={inputClassName}>
                  <option value="">Any</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Position" htmlFor="p-pos">
                <select id="p-pos" name="positionId" defaultValue={path?.position_id ?? ''} className={inputClassName}>
                  <option value="">Any</option>
                  {positions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

interface PathItem {
  courseId: string
  title: string
  required: boolean
  requiresPrevious: boolean
  dueDays: number | null
}

/** Ordered course list for a path. Saving replaces the list; existing learner plans keep their snapshot. */
export function PathCoursesEditor({
  pathId,
  initial,
  courses,
}: {
  pathId: string
  initial: PathItem[]
  courses: { id: string; title: string }[]
}) {
  const [items, setItems] = React.useState(initial)
  const [adding, setAdding] = React.useState('')
  const [state, action] = useFormAction(setPathCoursesAction)
  const available = courses.filter((c) => !items.some((i) => i.courseId === c.id))
  const update = (index: number, patch: Partial<PathItem>) => setItems(items.map((it, i) => (i === index ? { ...it, ...patch } : it)))
  const move = (index: number, by: -1 | 1) => {
    const next = [...items]
    ;[next[index], next[index + by]] = [next[index + by], next[index]]
    setItems(next)
  }
  const payload = JSON.stringify(
    items.map((i) => ({ courseId: i.courseId, required: i.required, requiresPrevious: i.requiresPrevious, dueDays: i.dueDays })),
  )
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="pathId" value={pathId} />
      <input type="hidden" name="items" value={payload} />
      <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
      <ol className="grid gap-2">
        {items.map((item, index) => (
          <li key={item.courseId} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[auto_1fr_auto] sm:items-center">
            <span className="flex size-7 items-center justify-center rounded-full bg-muted text-caption font-medium" aria-hidden>
              {index + 1}
            </span>
            <div className="min-w-0 space-y-2">
              <p className="truncate font-medium">{item.title}</p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-small">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={item.required} onChange={(e) => update(index, { required: e.target.checked })} className="size-4" />
                  Required
                </label>
                {index > 0 && (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={item.requiresPrevious}
                      onChange={(e) => update(index, { requiresPrevious: e.target.checked })}
                      className="size-4"
                    />
                    After the previous course
                  </label>
                )}
                <label className="flex items-center gap-2">
                  Due after
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={item.dueDays ?? ''}
                    onChange={(e) => update(index, { dueDays: e.target.value ? Number(e.target.value) : null })}
                    className="h-8 w-20"
                    aria-label={`Days until ${item.title} is due`}
                  />
                  days
                </label>
              </div>
            </div>
            <div className="flex">
              <Button type="button" size="sm" variant="ghost" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Move up">
                <ArrowUp aria-hidden />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={index === items.length - 1}
                onClick={() => move(index, 1)}
                aria-label="Move down"
              >
                <ArrowDown aria-hidden />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setItems(items.filter((_, i) => i !== index))}
                aria-label={`Remove ${item.title}`}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          </li>
        ))}
        {items.length === 0 && <li className="text-small text-muted-foreground">No courses in this path yet.</li>}
      </ol>
      {available.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Add a course" htmlFor="path-add">
            <select id="path-add" value={adding} onChange={(e) => setAdding(e.target.value)} className={`${inputClassName} min-w-64`}>
              <option value="">Choose…</option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </Field>
          <Button
            type="button"
            variant="outline"
            disabled={!adding}
            onClick={() => {
              const course = courses.find((c) => c.id === adding)
              if (!course) return
              setItems([...items, { courseId: course.id, title: course.title, required: true, requiresPrevious: true, dueDays: null }])
              setAdding('')
            }}
          >
            <Plus aria-hidden /> Add
          </Button>
        </div>
      )}
      <div>
        <SubmitButton pendingLabel="Saving…">Save courses</SubmitButton>
      </div>
    </form>
  )
}

const TARGETS = [
  ['EVERYONE', 'Every intern'],
  ['DEPARTMENT', 'A department'],
  ['POSITION', 'A position'],
  ['ONBOARDING_TEMPLATE', 'Interns on an onboarding template'],
  ['INTERN', 'One intern'],
] as const

export function RequiredRuleDialog({
  courses,
  options,
}: {
  courses: { id: string; title: string }[]
  options: { DEPARTMENT: Option[]; POSITION: Option[]; ONBOARDING_TEMPLATE: Option[]; INTERN: Option[] }
}) {
  const [open, setOpen] = React.useState(false)
  const [target, setTarget] = React.useState<(typeof TARGETS)[number][0]>('EVERYONE')
  const [state, action] = useFormAction(saveRequiredRuleAction, { onSuccess: () => setOpen(false) })
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={!courses.length}>
        <Plus aria-hidden /> Required training
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add required training</DialogTitle>
            <DialogDescription>
              Matching interns are enrolled now, and new interns are enrolled automatically when they join or start onboarding.
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="grid gap-4">
            <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
            <Field label="Course" htmlFor="rr-course" error={state.fields?.courseId}>
              <select id="rr-course" name="courseId" required className={inputClassName}>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Applies to" htmlFor="rr-target">
              <select
                id="rr-target"
                name="targetType"
                value={target}
                onChange={(e) => setTarget(e.target.value as typeof target)}
                className={inputClassName}
              >
                {TARGETS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            {target !== 'EVERYONE' && (
              <Field label="Which" htmlFor="rr-id" error={state.fields?.targetId}>
                <select id="rr-id" name="targetId" required className={inputClassName}>
                  {options[target].map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Due within (days)" htmlFor="rr-due" error={state.fields?.dueDays}>
              <Input id="rr-due" name="dueDays" type="number" min={1} max={365} defaultValue={14} required className="w-28" />
            </Field>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
