'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/feedback/confirm-dialog'
import { useToast } from '@/components/feedback/toast'
import { Badge } from '@/components/ui/badge'
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
import { fullName, humanizeEnum } from '@/lib/utils'
import { saveTemplateAction, saveTemplateItemAction, templateItemCommandAction } from '@/server/actions/interns'
import { useFormAction } from './use-form-action'
import { useUnsavedChanges } from './use-unsaved-changes'

export interface TemplateOptions {
  departments: { id: string; name: string }[]
  positions: { id: string; title: string }[]
  policies: { id: string; title: string; version: number }[]
  hrStaff: { id: string; first_name: string; last_name: string; display_name: string | null }[]
  itemTypes: { value: string; label: string }[]
  documentTypes: { value: string; label: string }[]
}

export interface TemplateView {
  id: string
  name: string
  description: string | null
  is_active: boolean
  is_default: boolean
  department_id: string | null
  position_id: string | null
  items: {
    id: string
    title: string
    description: string | null
    category: string
    required: boolean
    due_days_after_start: number
    assigned_role: string
    assigned_user_id: string | null
    required_document_type: string | null
    policy_id: string | null
    assigned_user: { first_name: string; last_name: string; display_name: string | null } | null
    policy: { title: string; version: number } | null
  }[]
}

/** Template name/placement/default settings. Used for both "new" and "edit". */
export function TemplateSettingsForm({
  template,
  options,
  onSaved,
}: {
  template?: TemplateView
  options: Pick<TemplateOptions, 'departments' | 'positions'>
  onSaved?: (id: string) => void
}) {
  const [dirty, setDirty] = React.useState(false)
  const [state, action] = useFormAction(saveTemplateAction, {
    onSuccess: (result) => {
      setDirty(false)
      if (result.data) onSaved?.(result.data.id)
    },
  })
  useUnsavedChanges(dirty)
  const v = state.values
  const f = state.fields ?? {}
  return (
    <form action={action} onChange={() => setDirty(true)} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2">
        <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
      </div>
      {template && <input type="hidden" name="templateId" value={template.id} />}
      <Field label="Name" htmlFor="tpl-name" error={f.name}>
        <Input id="tpl-name" name="name" required defaultValue={v?.name ?? template?.name} />
      </Field>
      <Field
        label="Department (optional)"
        htmlFor="tpl-dept"
        error={f.departmentId}
        hint="Auto-selected for interns in this department."
      >
        <select
          id="tpl-dept"
          name="departmentId"
          defaultValue={v?.departmentId ?? template?.department_id ?? ''}
          className={inputClassName}
        >
          <option value="">Any department</option>
          {options.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Position (optional)"
        htmlFor="tpl-pos"
        error={f.positionId}
        hint="A position match wins over a department match."
      >
        <select
          id="tpl-pos"
          name="positionId"
          defaultValue={v?.positionId ?? template?.position_id ?? ''}
          className={inputClassName}
        >
          <option value="">Any position</option>
          {options.positions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex flex-col justify-end gap-2 text-small">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={template ? template.is_active : true}
            className="size-4 accent-primary"
          />{' '}
          Active
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="isDefault"
            defaultChecked={template?.is_default ?? false}
            className="size-4 accent-primary"
          />
          Default template (used when nothing more specific matches)
        </label>
      </div>
      <div className="sm:col-span-2">
        <Field label="Description (optional)" htmlFor="tpl-desc" error={f.description}>
          <Textarea
            id="tpl-desc"
            name="description"
            rows={2}
            defaultValue={v?.description ?? template?.description ?? ''}
          />
        </Field>
      </div>
      <div>
        <SubmitButton pendingLabel="Saving…">{template ? 'Save template' : 'Create template'}</SubmitButton>
      </div>
    </form>
  )
}

export function NewTemplateButton({ options }: { options: Pick<TemplateOptions, 'departments' | 'positions'> }) {
  const [open, setOpen] = React.useState(false)
  const router = useRouter()
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden /> New template
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New onboarding template</DialogTitle>
            <DialogDescription>You’ll add checklist items next.</DialogDescription>
          </DialogHeader>
          <TemplateSettingsForm options={options} onSaved={(id) => router.push(`/onboarding/templates/${id}`)} />
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Ordered item list with add/edit/move/delete. */
export function TemplateItems({ template, options }: { template: TemplateView; options: TemplateOptions }) {
  const [editing, setEditing] = React.useState<TemplateView['items'][number] | 'new' | null>(null)
  const [deleting, setDeleting] = React.useState<TemplateView['items'][number] | null>(null)
  const router = useRouter()
  const { toast } = useToast()

  async function command(itemId: string, name: 'up' | 'down' | 'delete') {
    const formData = new FormData()
    formData.set('itemId', itemId)
    formData.set('command', name)
    const result = await templateItemCommandAction({ status: 'idle' }, formData)
    if (result.status === 'error') toast({ title: result.message ?? 'Failed', variant: 'error' })
    router.refresh()
  }

  return (
    <div className="space-y-3">
      {template.items.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-small text-muted-foreground">
          No items yet.
        </p>
      ) : (
        <ol className="divide-y rounded-xl border bg-card">
          {template.items.map((item, index) => (
            <li key={item.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  <span className="tabular mr-2 text-muted-foreground">{index + 1}.</span>
                  {item.title}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5 text-caption text-muted-foreground">
                  <Badge variant="outline">{humanizeEnum(item.category)}</Badge>
                  {item.required ? (
                    <Badge variant="neutral">Required</Badge>
                  ) : (
                    <Badge variant="outline">Optional</Badge>
                  )}
                  <span>
                    Due day {item.due_days_after_start >= 0 ? '+' : ''}
                    {item.due_days_after_start}
                  </span>
                  <span>· {item.assigned_user ? fullName(item.assigned_user) : humanizeEnum(item.assigned_role)}</span>
                  {item.policy && (
                    <span>
                      · {item.policy.title} v{item.policy.version}
                    </span>
                  )}
                  {item.required_document_type && <span>· {humanizeEnum(item.required_document_type)}</span>}
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${item.title} up`}
                  disabled={index === 0}
                  onClick={() => command(item.id, 'up')}
                >
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${item.title} down`}
                  disabled={index === template.items.length - 1}
                  onClick={() => command(item.id, 'down')}
                >
                  <ArrowDown aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Edit ${item.title}`}
                  onClick={() => setEditing(item)}
                >
                  <Pencil aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${item.title}`}
                  onClick={() => setDeleting(item)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <Button variant="outline" onClick={() => setEditing('new')}>
        <Plus aria-hidden /> Add item
      </Button>

      {editing && (
        <ItemDialog
          templateId={template.id}
          item={editing === 'new' ? undefined : editing}
          options={options}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title={`Remove “${deleting.title}”?`}
          description="Checklists already generated for interns keep their copy of this item."
          confirmLabel="Remove"
          destructive
          onConfirm={() => command(deleting.id, 'delete')}
        />
      )}
    </div>
  )
}

function ItemDialog({
  templateId,
  item,
  options,
  onClose,
}: {
  templateId: string
  item?: TemplateView['items'][number]
  options: TemplateOptions
  onClose: () => void
}) {
  const [state, action] = useFormAction(saveTemplateItemAction, { onSuccess: onClose })
  const [category, setCategory] = React.useState(state.values?.category ?? item?.category ?? 'TASK')
  const [role, setRole] = React.useState(state.values?.assignedRole ?? item?.assigned_role ?? 'INTERN')
  const v = state.values
  const f = state.fields ?? {}
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{item ? 'Edit item' : 'Add item'}</DialogTitle>
          <DialogDescription>Changes apply to new checklists only.</DialogDescription>
        </DialogHeader>
        <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
          <div className="sm:col-span-2">
            <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
          </div>
          <input type="hidden" name="templateId" value={templateId} />
          {item && <input type="hidden" name="itemId" value={item.id} />}
          <div className="sm:col-span-2">
            <Field label="Title" htmlFor="item-title" error={f.title}>
              <Input id="item-title" name="title" required defaultValue={v?.title ?? item?.title} />
            </Field>
          </div>
          <Field label="Type" htmlFor="item-type" error={f.category}>
            <select
              id="item-type"
              name="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputClassName}
            >
              {options.itemTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Due (days after start)"
            htmlFor="item-due"
            error={f.dueDaysAfterStart}
            hint="Negative = before the start date."
          >
            <Input
              id="item-due"
              name="dueDaysAfterStart"
              type="number"
              min={-365}
              max={365}
              defaultValue={v?.dueDaysAfterStart ?? item?.due_days_after_start ?? 0}
            />
          </Field>
          <Field label="Responsible" htmlFor="item-role" error={f.assignedRole}>
            <select
              id="item-role"
              name="assignedRole"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className={inputClassName}
            >
              <option value="INTERN">Intern</option>
              <option value="MANAGER">Their manager</option>
              <option value="MENTOR">Their mentor</option>
              <option value="HR">A specific HR person</option>
            </select>
          </Field>
          {role === 'HR' ? (
            <Field label="HR person" htmlFor="item-user" error={f.assignedUserId}>
              <select
                id="item-user"
                name="assignedUserId"
                defaultValue={v?.assignedUserId ?? item?.assigned_user_id ?? ''}
                className={inputClassName}
              >
                <option value="" disabled>
                  Choose
                </option>
                {options.hrStaff.map((p) => (
                  <option key={p.id} value={p.id}>
                    {fullName(p)}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <div />
          )}
          {category === 'DOCUMENT' && (
            <Field label="Required document" htmlFor="item-doc" error={f.requiredDocumentType}>
              <select
                id="item-doc"
                name="requiredDocumentType"
                defaultValue={v?.requiredDocumentType ?? item?.required_document_type ?? ''}
                className={inputClassName}
              >
                <option value="">Any type</option>
                {options.documentTypes.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {category === 'ACKNOWLEDGEMENT' && (
            <Field label="Policy" htmlFor="item-policy" error={f.policyId}>
              <select
                id="item-policy"
                name="policyId"
                defaultValue={v?.policyId ?? item?.policy_id ?? ''}
                className={inputClassName}
              >
                <option value="" disabled>
                  Choose a policy
                </option>
                {options.policies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} (v{p.version})
                  </option>
                ))}
              </select>
            </Field>
          )}
          <label className="flex items-center gap-2 text-small sm:col-span-2">
            <input
              type="checkbox"
              name="required"
              defaultChecked={item ? item.required : true}
              className="size-4 accent-primary"
            />
            Required to complete onboarding
          </label>
          <div className="sm:col-span-2">
            <Field label="Instructions (optional)" htmlFor="item-desc" error={f.description}>
              <Textarea
                id="item-desc"
                name="description"
                rows={3}
                defaultValue={v?.description ?? item?.description ?? ''}
              />
            </Field>
          </div>
          <DialogFooter className="sm:col-span-2">
            <SubmitButton pendingLabel="Saving…">{item ? 'Save item' : 'Add item'}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
