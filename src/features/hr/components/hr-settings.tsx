'use client'

import * as React from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
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
import { useFormAction } from '@/features/interns/components/use-form-action'
import { formatDay, pluralize } from '@/lib/utils'
import {
  deleteHolidayAction,
  saveDocumentTypeAction,
  saveHolidayAction,
  saveHrSettingsAction,
  saveLeaveTypeAction,
} from '@/server/actions/hr'
import type { FormState } from '@/server/actions/form-state'
import { ActionButton } from './action-form'

type Action = (previous: FormState, formData: FormData) => Promise<FormState>

function SectionForm({
  section,
  children,
  submitLabel = 'Save',
}: {
  section: string
  children: (state: FormState) => React.ReactNode
  submitLabel?: string
}) {
  const [state, action] = useFormAction(saveHrSettingsAction)
  return (
    <form action={action} className="grid gap-4">
      <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
      <input type="hidden" name="section" value={section} />
      {children(state)}
      <div>
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </form>
  )
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function GeneralSettingsForm({
  endingSoonDays,
  defaultWorkMode,
  expiryWarningDays,
}: {
  endingSoonDays: number
  defaultWorkMode: string
  expiryWarningDays: number
}) {
  return (
    <SectionForm section="general">
      {(state) => (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="“Ending soon” threshold (days)" htmlFor="s-ending" error={state.fields?.endingSoonDays}>
            <Input
              id="s-ending"
              name="endingSoonDays"
              type="number"
              min={1}
              max={90}
              required
              defaultValue={endingSoonDays}
            />
          </Field>
          <Field
            label="Default work mode"
            htmlFor="s-mode"
            hint="Pre-selected for new interns"
            error={state.fields?.defaultWorkMode}
          >
            <select id="s-mode" name="defaultWorkMode" defaultValue={defaultWorkMode} className={inputClassName}>
              <option value="REMOTE">Remote</option>
              <option value="HYBRID">Hybrid</option>
              <option value="ONSITE">On-site</option>
            </select>
          </Field>
          <Field label="Warn before document expiry (days)" htmlFor="s-expiry" error={state.fields?.expiryWarningDays}>
            <Input
              id="s-expiry"
              name="expiryWarningDays"
              type="number"
              min={1}
              max={180}
              required
              defaultValue={expiryWarningDays}
            />
          </Field>
        </div>
      )}
    </SectionForm>
  )
}

export function AttendanceRulesForm({
  rules,
}: {
  rules: {
    workStart: string
    graceMinutes: number
    fullDayMinutes: number
    halfDayMinutes: number
    workingDays: number[]
  }
}) {
  return (
    <SectionForm section="attendance">
      {(state) => (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Work starts" htmlFor="r-start" error={state.fields?.workStart}>
              <Input id="r-start" name="workStart" type="time" required defaultValue={rules.workStart} />
            </Field>
            <Field label="Grace (minutes)" htmlFor="r-grace" error={state.fields?.graceMinutes}>
              <Input
                id="r-grace"
                name="graceMinutes"
                type="number"
                min={0}
                max={180}
                required
                defaultValue={rules.graceMinutes}
              />
            </Field>
            <Field
              label="Full day (minutes)"
              htmlFor="r-full"
              hint="Breaks excluded"
              error={state.fields?.fullDayMinutes}
            >
              <Input
                id="r-full"
                name="fullDayMinutes"
                type="number"
                min={60}
                max={960}
                required
                defaultValue={rules.fullDayMinutes}
              />
            </Field>
            <Field
              label="Half day (minutes)"
              htmlFor="r-half"
              hint="Less counts as absent"
              error={state.fields?.halfDayMinutes}
            >
              <Input
                id="r-half"
                name="halfDayMinutes"
                type="number"
                min={30}
                max={720}
                required
                defaultValue={rules.halfDayMinutes}
              />
            </Field>
          </div>
          <fieldset>
            <legend className="mb-2 text-label">Working days</legend>
            <div className="flex flex-wrap gap-3">
              {DAYS.map((label, index) => (
                <label key={label} className="flex items-center gap-1.5 text-small">
                  <input
                    type="checkbox"
                    name="workingDays"
                    value={index}
                    defaultChecked={rules.workingDays.includes(index)}
                    className="size-4"
                  />
                  {label}
                </label>
              ))}
            </div>
            {state.fields?.workingDays && (
              <p className="mt-1 text-caption text-destructive">{state.fields.workingDays}</p>
            )}
          </fieldset>
        </>
      )}
    </SectionForm>
  )
}

export function LeavePolicyForm({ policy }: { policy: { backdateDays: number; maxRequestDays: number } }) {
  return (
    <SectionForm section="leave">
      {(state) => (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Allow leave starting up to (days in the past)"
            htmlFor="l-back"
            error={state.fields?.backdateDays}
          >
            <Input
              id="l-back"
              name="backdateDays"
              type="number"
              min={0}
              max={60}
              required
              defaultValue={policy.backdateDays}
            />
          </Field>
          <Field label="Longest single request (calendar days)" htmlFor="l-max" error={state.fields?.maxRequestDays}>
            <Input
              id="l-max"
              name="maxRequestDays"
              type="number"
              min={1}
              max={180}
              required
              defaultValue={policy.maxRequestDays}
            />
          </Field>
        </div>
      )}
    </SectionForm>
  )
}

export function OffboardingDefaultsForm({ items }: { items: string[] }) {
  return (
    <SectionForm section="offboarding">
      {(state) => (
        <Field
          label="Checklist items (one per line)"
          htmlFor="o-items"
          hint="Used when HR starts offboarding for an intern"
          error={state.fields?.items}
        >
          <Textarea id="o-items" name="items" rows={6} defaultValue={items.join('\n')} />
        </Field>
      )}
    </SectionForm>
  )
}

/** Generic "edit in a dialog" wrapper for list settings (leave types, document types, holidays). */
function EditDialog({
  title,
  action,
  trigger,
  children,
}: {
  title: string
  action: Action
  trigger: (open: () => void) => React.ReactNode
  children: (state: FormState) => React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const [state, formAction] = useFormAction(action, { onSuccess: () => setOpen(false) })
  return (
    <>
      {trigger(() => setOpen(true))}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>Changes apply to new requests and uploads; history is kept.</DialogDescription>
          </DialogHeader>
          <form action={formAction} className="grid gap-4">
            <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
            {children(state)}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton>Save</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-center gap-2 text-small">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4" />
      {label}
    </label>
  )
}

interface LeaveType {
  id: string
  name: string
  description: string | null
  quota_days: number | null
  requires_approval: boolean
  requires_attachment: boolean
  is_active: boolean
}

function LeaveTypeFields({ type, state }: { type?: LeaveType; state: FormState }) {
  return (
    <>
      {type && <input type="hidden" name="leaveTypeId" value={type.id} />}
      <Field label="Name" htmlFor="lt-name" error={state.fields?.name}>
        <Input id="lt-name" name="name" required maxLength={60} defaultValue={type?.name} />
      </Field>
      <Field label="Description" htmlFor="lt-desc">
        <Input id="lt-desc" name="description" maxLength={300} defaultValue={type?.description ?? ''} />
      </Field>
      <Field
        label="Allowance (days)"
        htmlFor="lt-quota"
        hint="Leave empty for unlimited (tracked, not capped)"
        error={state.fields?.quotaDays}
      >
        <Input id="lt-quota" name="quotaDays" type="number" min={0} max={366} defaultValue={type?.quota_days ?? ''} />
      </Field>
      <div className="flex flex-wrap gap-4">
        <Check name="requiresApproval" label="Needs approval" defaultChecked={type?.requires_approval ?? true} />
        <Check name="requiresAttachment" label="Needs a document" defaultChecked={type?.requires_attachment ?? false} />
        <Check name="isActive" label="Active" defaultChecked={type?.is_active ?? true} />
      </div>
    </>
  )
}

export function LeaveTypesEditor({ types }: { types: (LeaveType & { _count: { leave_requests: number } })[] }) {
  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-xl border">
        {types.map((type) => (
          <li key={type.id} className="flex flex-wrap items-center gap-3 p-3 text-small">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{type.name}</span>
              <span className="text-muted-foreground">
                {' '}
                · {type.quota_days === null ? 'Unlimited' : `${type.quota_days} days`}
                {!type.requires_approval && ' · auto-approved'}
                {type.requires_attachment && ' · document needed'} · {pluralize(type._count.leave_requests, 'request')}
              </span>
            </span>
            {!type.is_active && <Badge variant="outline">Inactive</Badge>}
            <EditDialog
              title={`Edit ${type.name}`}
              action={saveLeaveTypeAction}
              trigger={(open) => (
                <Button size="icon-sm" variant="ghost" onClick={open} aria-label={`Edit ${type.name}`}>
                  <Pencil aria-hidden />
                </Button>
              )}
            >
              {(state) => <LeaveTypeFields type={type} state={state} />}
            </EditDialog>
          </li>
        ))}
      </ul>
      <EditDialog
        title="New leave type"
        action={saveLeaveTypeAction}
        trigger={(open) => (
          <Button variant="outline" onClick={open}>
            <Plus aria-hidden /> Add leave type
          </Button>
        )}
      >
        {(state) => <LeaveTypeFields state={state} />}
      </EditDialog>
    </div>
  )
}

interface DocType {
  id: string
  name: string
  description: string | null
  is_required: boolean
  is_sensitive: boolean
  has_expiry: boolean
  is_active: boolean
  legacy_type: string
  default_visibility: string
}

function DocTypeFields({
  type,
  state,
  legacyLabels,
  visibilityLabels,
}: {
  type?: DocType
  state: FormState
  legacyLabels: Record<string, string>
  visibilityLabels: Record<string, string>
}) {
  return (
    <>
      {type && <input type="hidden" name="documentTypeId" value={type.id} />}
      <Field label="Name" htmlFor="dt-name" error={state.fields?.name}>
        <Input id="dt-name" name="name" required maxLength={80} defaultValue={type?.name} />
      </Field>
      <Field label="Description" htmlFor="dt-desc">
        <Input id="dt-desc" name="description" maxLength={300} defaultValue={type?.description ?? ''} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Category" htmlFor="dt-legacy" hint="Used by onboarding checklists">
          <select
            id="dt-legacy"
            name="legacyType"
            defaultValue={type?.legacy_type ?? 'OTHER'}
            className={inputClassName}
          >
            {Object.entries(legacyLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Default visibility" htmlFor="dt-vis">
          <select
            id="dt-vis"
            name="defaultVisibility"
            defaultValue={type?.default_visibility ?? 'HR'}
            className={inputClassName}
          >
            {Object.entries(visibilityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap gap-4">
        <Check name="isRequired" label="Required from every intern" defaultChecked={type?.is_required ?? false} />
        <Check name="isSensitive" label="Sensitive (restricted)" defaultChecked={type?.is_sensitive ?? false} />
        <Check name="hasExpiry" label="Has an expiry date" defaultChecked={type?.has_expiry ?? false} />
        <Check name="isActive" label="Active" defaultChecked={type?.is_active ?? true} />
      </div>
    </>
  )
}

export function DocumentTypesEditor({
  types,
  legacyLabels,
  visibilityLabels,
}: {
  types: (DocType & { _count: { documents: number } })[]
  legacyLabels: Record<string, string>
  visibilityLabels: Record<string, string>
}) {
  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-xl border">
        {types.map((type) => (
          <li key={type.id} className="flex flex-wrap items-center gap-2 p-3 text-small">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{type.name}</span>
              <span className="text-muted-foreground"> · {pluralize(type._count.documents, 'document')}</span>
            </span>
            {type.is_required && <Badge variant="warning">Required</Badge>}
            {type.is_sensitive && <Badge variant="outline">Sensitive</Badge>}
            {type.has_expiry && <Badge variant="outline">Expires</Badge>}
            {!type.is_active && <Badge variant="neutral">Inactive</Badge>}
            <EditDialog
              title={`Edit ${type.name}`}
              action={saveDocumentTypeAction}
              trigger={(open) => (
                <Button size="icon-sm" variant="ghost" onClick={open} aria-label={`Edit ${type.name}`}>
                  <Pencil aria-hidden />
                </Button>
              )}
            >
              {(state) => (
                <DocTypeFields
                  type={type}
                  state={state}
                  legacyLabels={legacyLabels}
                  visibilityLabels={visibilityLabels}
                />
              )}
            </EditDialog>
          </li>
        ))}
      </ul>
      <EditDialog
        title="New document type"
        action={saveDocumentTypeAction}
        trigger={(open) => (
          <Button variant="outline" onClick={open}>
            <Plus aria-hidden /> Add document type
          </Button>
        )}
      >
        {(state) => <DocTypeFields state={state} legacyLabels={legacyLabels} visibilityLabels={visibilityLabels} />}
      </EditDialog>
    </div>
  )
}

interface Holiday {
  id: string
  date: Date
  name: string
  description: string | null
  is_optional: boolean
}

function HolidayFields({ holiday, state }: { holiday?: Holiday; state: FormState }) {
  return (
    <>
      {holiday && <input type="hidden" name="holidayId" value={holiday.id} />}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Date" htmlFor="h-date" error={state.fields?.date}>
          <Input
            id="h-date"
            name="date"
            type="date"
            required
            defaultValue={holiday ? holiday.date.toISOString().slice(0, 10) : ''}
          />
        </Field>
        <Field label="Name" htmlFor="h-name" error={state.fields?.name}>
          <Input id="h-name" name="name" required maxLength={120} defaultValue={holiday?.name} />
        </Field>
      </div>
      <Field label="Description" htmlFor="h-desc">
        <Input id="h-desc" name="description" maxLength={500} defaultValue={holiday?.description ?? ''} />
      </Field>
      <Check name="isOptional" label="Optional holiday" defaultChecked={holiday?.is_optional ?? false} />
    </>
  )
}

export function HolidaysEditor({ holidays, year }: { holidays: Holiday[]; year: number }) {
  return (
    <div className="space-y-3">
      {holidays.length === 0 ? (
        <p className="text-small text-muted-foreground">No holidays for {year} yet.</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {holidays.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-3 p-3 text-small">
              <span className="w-28 shrink-0 text-muted-foreground">{formatDay(h.date)}</span>
              <span className="min-w-0 flex-1 font-medium">
                {h.name}
                {h.is_optional && <span className="font-normal text-muted-foreground"> (optional)</span>}
              </span>
              <EditDialog
                title={`Edit ${h.name}`}
                action={saveHolidayAction}
                trigger={(open) => (
                  <Button size="icon-sm" variant="ghost" onClick={open} aria-label={`Edit ${h.name}`}>
                    <Pencil aria-hidden />
                  </Button>
                )}
              >
                {(state) => <HolidayFields holiday={h} state={state} />}
              </EditDialog>
              <ActionButton
                action={deleteHolidayAction}
                fields={{ holidayId: h.id }}
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove ${h.name}`}
              >
                <Trash2 aria-hidden />
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
      <EditDialog
        title="Add holiday"
        action={saveHolidayAction}
        trigger={(open) => (
          <Button variant="outline" onClick={open}>
            <Plus aria-hidden /> Add holiday
          </Button>
        )}
      >
        {(state) => <HolidayFields state={state} />}
      </EditDialog>
    </div>
  )
}
