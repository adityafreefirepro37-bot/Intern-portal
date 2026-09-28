'use client'

import * as React from 'react'
import type { InternStatus } from '@prisma/client'
import { Check, Copy, Pencil, RefreshCw, Send, UserCog } from 'lucide-react'
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
import { requiresReason, STATUS_LABELS, STATUS_TRANSITIONS } from '@/lib/interns/lifecycle'
import {
  assignInternAction,
  resendInternInvitationAction,
  transitionInternAction,
  updateInternAction,
} from '@/server/actions/interns'
import type { InternFormOptions } from './intern-form'
import { useFormAction } from './use-form-action'
import { useUnsavedChanges } from './use-unsaved-changes'

export interface EditableIntern {
  id: string
  name: string
  status: InternStatus
  firstName: string
  lastName: string
  phone: string | null
  departmentId: string | null
  teamId: string | null
  positionId: string | null
  managerId: string | null
  mentorId: string | null
  joiningDate: string
  expectedEndDate: string
  workMode: string | null
  location: string | null
  internshipTitle: string | null
  description: string | null
  education: { level: string | null; institution: string | null; fieldOfStudy: string | null; graduationYear: number | null } | null
  onboardingComplete: boolean | null
  accountInvited: boolean
}

/** HR/Admin controls on the profile header. Each dialog's action is re-authorized on the server. */
export function ProfileActions({
  intern,
  options,
  can,
}: {
  intern: EditableIntern
  options: InternFormOptions
  can: { edit: boolean; assign: boolean; transition: boolean; close: boolean; invite: boolean }
}) {
  const [open, setOpen] = React.useState<null | 'edit' | 'manager' | 'mentor' | 'status' | 'invite'>(null)
  const close = () => setOpen(null)
  const nextStatuses = STATUS_TRANSITIONS[intern.status].filter((to) =>
    ['COMPLETED', 'ALUMNI', 'TERMINATED'].includes(to) ? can.close : can.transition,
  )

  return (
    <div className="flex flex-wrap gap-2">
      {can.edit && (
        <Button variant="outline" onClick={() => setOpen('edit')}>
          <Pencil aria-hidden /> Edit
        </Button>
      )}
      {can.assign && (
        <>
          <Button variant="outline" onClick={() => setOpen('manager')}>
            <UserCog aria-hidden /> Manager
          </Button>
          <Button variant="outline" onClick={() => setOpen('mentor')}>
            <UserCog aria-hidden /> Mentor
          </Button>
        </>
      )}
      {nextStatuses.length > 0 && (
        <Button onClick={() => setOpen('status')}>
          <RefreshCw aria-hidden /> Change status
        </Button>
      )}
      {can.invite && intern.accountInvited && (
        <Button variant="outline" onClick={() => setOpen('invite')}>
          <Send aria-hidden /> Resend invitation
        </Button>
      )}

      {open === 'edit' && <EditDialog intern={intern} options={options} onClose={close} />}
      {(open === 'manager' || open === 'mentor') && (
        <AssignDialog intern={intern} role={open} staff={options.staff} onClose={close} />
      )}
      {open === 'status' && <StatusDialog intern={intern} targets={nextStatuses} templates={options.templates} onClose={close} />}
      {open === 'invite' && <InviteDialog intern={intern} onClose={close} />}
    </div>
  )
}

function EditDialog({ intern, options, onClose }: { intern: EditableIntern; options: InternFormOptions; onClose: () => void }) {
  const [state, action] = useFormAction(updateInternAction, { onSuccess: onClose })
  const [dirty, setDirty] = React.useState(false)
  useUnsavedChanges(dirty)
  const v = state.values
  const f = state.fields ?? {}
  const e = intern.education

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && (!dirty || window.confirm('Discard your changes?'))) onClose()
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit {intern.name}</DialogTitle>
          <DialogDescription>Changes to dates are recorded on the timeline.</DialogDescription>
        </DialogHeader>
        <form
          action={action}
          onChange={() => setDirty(true)}
          onSubmit={(event) => {
            // Moving internship dates shifts progress and "ending soon" — confirm it.
            const data = new FormData(event.currentTarget)
            const datesChanged = data.get('joiningDate') !== intern.joiningDate || data.get('expectedEndDate') !== intern.expectedEndDate
            if (
              datesChanged &&
              !window.confirm('You’re changing the internship dates. Progress, due dates shown to the intern and the “ending soon” status follow the new dates. Continue?')
            ) {
              event.preventDefault()
            }
          }}
          className="grid gap-4 sm:grid-cols-2"
          noValidate
        >
          <div className="sm:col-span-2">
            <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
          </div>
          <input type="hidden" name="internId" value={intern.id} />
          <Field label="First name" htmlFor="e-first" error={f.firstName}>
            <Input id="e-first" name="firstName" defaultValue={v?.firstName ?? intern.firstName} required />
          </Field>
          <Field label="Last name" htmlFor="e-last" error={f.lastName}>
            <Input id="e-last" name="lastName" defaultValue={v?.lastName ?? intern.lastName} required />
          </Field>
          <Field label="Phone" htmlFor="e-phone" error={f.phone}>
            <Input id="e-phone" name="phone" type="tel" defaultValue={v?.phone ?? intern.phone ?? ''} />
          </Field>
          <Field label="Work mode" htmlFor="e-mode" error={f.workMode}>
            <select id="e-mode" name="workMode" defaultValue={v?.workMode ?? intern.workMode ?? 'HYBRID'} className={inputClassName}>
              <option value="ONSITE">On-site</option>
              <option value="HYBRID">Hybrid</option>
              <option value="REMOTE">Remote</option>
            </select>
          </Field>
          <Field label="Department" htmlFor="e-dept" error={f.departmentId}>
            <select id="e-dept" name="departmentId" defaultValue={v?.departmentId ?? intern.departmentId ?? ''} className={inputClassName} required>
              <option value="" disabled>
                Choose
              </option>
              {options.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Position" htmlFor="e-pos" error={f.positionId}>
            <select id="e-pos" name="positionId" defaultValue={v?.positionId ?? intern.positionId ?? ''} className={inputClassName} required>
              <option value="" disabled>
                Choose
              </option>
              {options.positions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Team" htmlFor="e-team" error={f.teamId}>
            <select id="e-team" name="teamId" defaultValue={v?.teamId ?? intern.teamId ?? ''} className={inputClassName}>
              <option value="">No team</option>
              {options.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Location" htmlFor="e-loc" error={f.location}>
            <Input id="e-loc" name="location" defaultValue={v?.location ?? intern.location ?? ''} />
          </Field>
          <Field label="Joining date" htmlFor="e-join" error={f.joiningDate}>
            <Input id="e-join" name="joiningDate" type="date" defaultValue={v?.joiningDate ?? intern.joiningDate} required />
          </Field>
          <Field label="Expected end date" htmlFor="e-end" error={f.expectedEndDate}>
            <Input id="e-end" name="expectedEndDate" type="date" defaultValue={v?.expectedEndDate ?? intern.expectedEndDate} required />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Internship title" htmlFor="e-title" error={f.internshipTitle}>
              <Input id="e-title" name="internshipTitle" defaultValue={v?.internshipTitle ?? intern.internshipTitle ?? ''} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Description" htmlFor="e-desc" error={f.description}>
              <Textarea id="e-desc" name="description" rows={3} defaultValue={v?.description ?? intern.description ?? ''} />
            </Field>
          </div>
          <Field label="Institution" htmlFor="e-inst" error={f.institution}>
            <Input id="e-inst" name="institution" defaultValue={v?.institution ?? e?.institution ?? ''} />
          </Field>
          <Field label="Field of study" htmlFor="e-field" error={f.fieldOfStudy}>
            <Input id="e-field" name="fieldOfStudy" defaultValue={v?.fieldOfStudy ?? e?.fieldOfStudy ?? ''} />
          </Field>
          <Field label="Education level" htmlFor="e-level" error={f.educationLevel}>
            <Input id="e-level" name="educationLevel" defaultValue={v?.educationLevel ?? e?.level ?? ''} />
          </Field>
          <Field label="Graduation year" htmlFor="e-grad" error={f.graduationYear}>
            <Input id="e-grad" name="graduationYear" inputMode="numeric" defaultValue={v?.graduationYear ?? e?.graduationYear?.toString() ?? ''} />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AssignDialog({
  intern,
  role,
  staff,
  onClose,
}: {
  intern: EditableIntern
  role: 'manager' | 'mentor'
  staff: InternFormOptions['staff']
  onClose: () => void
}) {
  const [state, action] = useFormAction(assignInternAction, { onSuccess: onClose })
  const current = role === 'manager' ? intern.managerId : intern.mentorId
  const label = role === 'manager' ? 'Manager' : 'Mentor'
  const [selected, setSelected] = React.useState(current ?? '')
  const [confirmed, setConfirmed] = React.useState(false)
  // Replacing or removing someone already assigned is a high-risk change: confirm it.
  const replacing = Boolean(current) && selected !== current
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign {label.toLowerCase()}</DialogTitle>
          <DialogDescription>
            {role === 'manager'
              ? 'The manager oversees the intern’s work, leave and attendance.'
              : 'The mentor guides the intern and reviews their work.'}{' '}
            Open onboarding items owned by the previous {label.toLowerCase()} move to the new one.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
          <input type="hidden" name="internId" value={intern.id} />
          <input type="hidden" name="role" value={role} />
          <Field label={label} htmlFor="assign-user" error={state.fields?.userId}>
            <select
              id="assign-user"
              name="userId"
              value={selected}
              onChange={(event) => {
                setSelected(event.target.value)
                setConfirmed(false)
              }}
              className={inputClassName}
            >
              <option value="">No {label.toLowerCase()}</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.roles && `(${s.roles})`}
                </option>
              ))}
            </select>
          </Field>
          {replacing && (
            <label className="flex items-start gap-2 text-small">
              <input
                type="checkbox"
                className="mt-1"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                {selected
                  ? `I want to replace the current ${label.toLowerCase()}. They lose access to this intern unless they have another role for them.`
                  : `I want to remove the ${label.toLowerCase()}. The intern will have no ${label.toLowerCase()} until one is assigned.`}
              </span>
            </label>
          )}
          <DialogFooter>
            <SubmitButton pendingLabel="Saving…" disabled={replacing && !confirmed}>
              Save
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const HIGH_RISK: InternStatus[] = ['TERMINATED', 'COMPLETED', 'ALUMNI']

function StatusDialog({
  intern,
  targets,
  templates,
  onClose,
}: {
  intern: EditableIntern
  targets: InternStatus[]
  templates: InternFormOptions['templates']
  onClose: () => void
}) {
  const [state, action] = useFormAction(transitionInternAction, { onSuccess: onClose })
  const [to, setTo] = React.useState<InternStatus>(targets[0])
  const [confirmed, setConfirmed] = React.useState(false)
  const needsReason = requiresReason(intern.status, to)
  const activating = intern.status === 'ONBOARDING' && to === 'ACTIVE'
  const needsOverride = activating && intern.onboardingComplete === false
  const highRisk = HIGH_RISK.includes(to)

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change status</DialogTitle>
          <DialogDescription>
            {intern.name} is currently <strong>{STATUS_LABELS[intern.status]}</strong>.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
          <input type="hidden" name="internId" value={intern.id} />
          <Field label="New status" htmlFor="status-to" error={state.fields?.to}>
            <select
              id="status-to"
              name="to"
              value={to}
              onChange={(event) => {
                setTo(event.target.value as InternStatus)
                setConfirmed(false)
              }}
              className={inputClassName}
            >
              {targets.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </Field>
          {intern.status === 'SELECTED' && to === 'ONBOARDING' && (
            <Field label="Onboarding template" htmlFor="status-template" error={state.fields?.templateId} hint="Used only if no checklist exists yet.">
              <select id="status-template" name="templateId" defaultValue="" className={inputClassName}>
                <option value="">Automatic</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {needsOverride && (
            <label className="flex items-start gap-3 rounded-lg bg-warning/12 p-3 text-small">
              <input type="checkbox" name="override" className="mt-1 size-4 accent-primary" />
              <span>
                Onboarding isn’t complete. <strong>Activate anyway</strong> (a reason is required and recorded).
              </span>
            </label>
          )}
          <Field
            label={needsReason || needsOverride ? 'Reason' : 'Reason (optional)'}
            htmlFor="status-reason"
            error={state.fields?.reason}
          >
            <Textarea id="status-reason" name="reason" rows={3} required={needsReason} />
          </Field>
          {highRisk && (
            <label className="flex items-start gap-3 rounded-lg bg-destructive/10 p-3 text-small text-destructive">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-1 size-4 accent-destructive"
              />
              <span>
                I understand this {to === 'TERMINATED' ? 'ends the internship early and ' : ''}closes the internship. It
                can’t be undone from here.
              </span>
            </label>
          )}
          <DialogFooter>
            <SubmitButton
              pendingLabel="Saving…"
              variant={to === 'TERMINATED' ? 'destructive' : 'default'}
              disabled={highRisk && !confirmed}
            >
              Change to {STATUS_LABELS[to]}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function InviteDialog({ intern, onClose }: { intern: EditableIntern; onClose: () => void }) {
  const [state, action] = useFormAction(resendInternInvitationAction)
  const [copied, setCopied] = React.useState(false)
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite {intern.name}</DialogTitle>
          <DialogDescription>Any earlier invitation link stops working.</DialogDescription>
        </DialogHeader>
        {state.status === 'success' ? (
          <div className="grid gap-4">
            <FormMessage status="success" message={state.message} />
            {state.data?.inviteUrl && (
              <div className="flex gap-2">
                <Input readOnly value={state.data.inviteUrl} aria-label="Invitation link" className="font-mono text-caption" />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Copy invitation link"
                  onClick={async () => {
                    await navigator.clipboard.writeText(state.data!.inviteUrl!)
                    setCopied(true)
                  }}
                >
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                </Button>
              </div>
            )}
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form action={action} className="grid gap-4">
            <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
            <input type="hidden" name="internId" value={intern.id} />
            <DialogFooter>
              <SubmitButton pendingLabel="Sending…">Send invitation</SubmitButton>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
