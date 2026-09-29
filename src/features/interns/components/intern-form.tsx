'use client'

import * as React from 'react'
import { useActionState } from 'react'
import Link from 'next/link'
import { Check, Copy, TriangleAlert } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, inputClassName, Textarea } from '@/components/ui/input'
import { Field, FormMessage, SubmitButton } from '@/features/auth/components/form-bits'
import { createInternAction, type CreateInternResult } from '@/server/actions/interns'
import type { FormState } from '@/server/actions/form-state'
import { useUnsavedChanges } from './use-unsaved-changes'

export interface InternFormOptions {
  departments: { id: string; name: string }[]
  teams: { id: string; name: string; department_id: string | null }[]
  positions: { id: string; title: string; department_id: string | null }[]
  staff: { id: string; name: string; roles: string }[]
  templates: { id: string; name: string; isDefault: boolean; departmentId: string | null; positionId: string | null }[]
}

const idle: FormState<CreateInternResult> = { status: 'idle' }

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</CardContent>
    </Card>
  )
}

/** HR "Add intern" form. Every rule is re-checked by internService.create on the server. */
export function CreateInternForm({ options, canInvite }: { options: InternFormOptions; canInvite: boolean }) {
  const [state, action] = useActionState(createInternAction, idle)
  const [dirty, setDirty] = React.useState(false)
  const [departmentId, setDepartmentId] = React.useState(state.values?.departmentId ?? '')
  const [startOnboarding, setStartOnboarding] = React.useState(
    state.values ? state.values.startOnboarding === 'on' : true,
  )
  const [copied, setCopied] = React.useState(false)
  useUnsavedChanges(dirty && state.status !== 'success')

  if (state.status === 'success' && state.data) {
    const result = state.data
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Intern added</CardTitle>
          <CardDescription>
            Employee code <span className="font-mono font-medium text-foreground">{result.employeeCode}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4">
          <FormMessage status="success" message={state.message} />
          {result.warnings.map((warning) => (
            <p
              key={warning}
              role="alert"
              className="flex gap-2 rounded-lg bg-warning/12 px-3 py-2.5 text-small text-warning"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {warning}
            </p>
          ))}
          {result.inviteUrl && (
            <div className="grid gap-2">
              <p className="text-small text-muted-foreground">
                Email delivery isn’t configured in this environment. Share this one-time invitation link with the intern
                — it won’t be shown again.
              </p>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={result.inviteUrl}
                  aria-label="Invitation link"
                  className="font-mono text-caption"
                />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Copy invitation link"
                  onClick={async () => {
                    await navigator.clipboard.writeText(result.inviteUrl!)
                    setCopied(true)
                  }}
                >
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                </Button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Link href={`/interns/${result.internId}`} className={buttonVariants()}>
              Open profile
            </Link>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Add another intern
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const v = state.values ?? {}
  const f = state.fields ?? {}
  const teams = options.teams.filter(
    (team) => !departmentId || !team.department_id || team.department_id === departmentId,
  )
  const positions = options.positions.filter(
    (p) => !departmentId || !p.department_id || p.department_id === departmentId,
  )

  return (
    <form action={action} onChange={() => setDirty(true)} className="grid max-w-4xl gap-6" noValidate>
      <FormMessage status={state.status} message={state.message} />

      <Section title="Personal details">
        <Field label="First name" htmlFor="firstName" error={f.firstName}>
          <Input id="firstName" name="firstName" required autoComplete="off" defaultValue={v.firstName} />
        </Field>
        <Field label="Last name" htmlFor="lastName" error={f.lastName}>
          <Input id="lastName" name="lastName" required autoComplete="off" defaultValue={v.lastName} />
        </Field>
        <Field label="Email" htmlFor="email" error={f.email} hint="They’ll sign in with this address.">
          <Input id="email" name="email" type="email" required autoComplete="off" defaultValue={v.email} />
        </Field>
        <Field label="Phone (optional)" htmlFor="phone" error={f.phone}>
          <Input id="phone" name="phone" type="tel" defaultValue={v.phone} />
        </Field>
        <Field label="Photo (optional)" htmlFor="photo" error={f.file} hint="PNG, JPEG or WebP.">
          <Input id="photo" name="photo" type="file" accept="image/png,image/jpeg,image/webp" />
        </Field>
      </Section>

      <Section title="Placement">
        <Field label="Department" htmlFor="departmentId" error={f.departmentId}>
          <select
            id="departmentId"
            name="departmentId"
            required
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
            className={inputClassName}
          >
            <option value="" disabled>
              Choose a department
            </option>
            {options.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Position" htmlFor="positionId" error={f.positionId}>
          <select
            id="positionId"
            name="positionId"
            required
            defaultValue={v.positionId ?? ''}
            className={inputClassName}
          >
            <option value="" disabled>
              Choose a position
            </option>
            {positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Team (optional)" htmlFor="teamId" error={f.teamId}>
          <select id="teamId" name="teamId" defaultValue={v.teamId ?? ''} className={inputClassName}>
            <option value="">No team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Work mode" htmlFor="workMode" error={f.workMode}>
          <select id="workMode" name="workMode" defaultValue={v.workMode ?? 'HYBRID'} className={inputClassName}>
            <option value="ONSITE">On-site</option>
            <option value="HYBRID">Hybrid</option>
            <option value="REMOTE">Remote</option>
          </select>
        </Field>
        <Field label="Manager (optional)" htmlFor="managerId" error={f.managerId}>
          <select id="managerId" name="managerId" defaultValue={v.managerId ?? ''} className={inputClassName}>
            <option value="">Assign later</option>
            {options.staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.roles && `(${s.roles})`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Mentor (optional)" htmlFor="mentorId" error={f.mentorId}>
          <select id="mentorId" name="mentorId" defaultValue={v.mentorId ?? ''} className={inputClassName}>
            <option value="">Assign later</option>
            {options.staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.roles && `(${s.roles})`}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Internship">
        <Field label="Joining date" htmlFor="joiningDate" error={f.joiningDate}>
          <Input id="joiningDate" name="joiningDate" type="date" required defaultValue={v.joiningDate} />
        </Field>
        <Field label="Expected end date" htmlFor="expectedEndDate" error={f.expectedEndDate}>
          <Input id="expectedEndDate" name="expectedEndDate" type="date" required defaultValue={v.expectedEndDate} />
        </Field>
        <Field
          label="Title (optional)"
          htmlFor="internshipTitle"
          error={f.internshipTitle}
          hint="Defaults to “<Position> internship”."
        >
          <Input id="internshipTitle" name="internshipTitle" defaultValue={v.internshipTitle} />
        </Field>
        <Field label="Location (optional)" htmlFor="location" error={f.location}>
          <Input id="location" name="location" defaultValue={v.location} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description (optional)" htmlFor="description" error={f.description}>
            <Textarea id="description" name="description" rows={3} defaultValue={v.description} />
          </Field>
        </div>
      </Section>

      <Section title="Education (optional)">
        <Field label="Institution" htmlFor="institution" error={f.institution}>
          <Input id="institution" name="institution" defaultValue={v.institution} />
        </Field>
        <Field label="Field of study" htmlFor="fieldOfStudy" error={f.fieldOfStudy}>
          <Input id="fieldOfStudy" name="fieldOfStudy" defaultValue={v.fieldOfStudy} />
        </Field>
        <Field label="Level" htmlFor="educationLevel" error={f.educationLevel}>
          <Input
            id="educationLevel"
            name="educationLevel"
            placeholder="e.g. B.Des, final year"
            defaultValue={v.educationLevel}
          />
        </Field>
        <Field label="Graduation year" htmlFor="graduationYear" error={f.graduationYear}>
          <Input id="graduationYear" name="graduationYear" inputMode="numeric" defaultValue={v.graduationYear} />
        </Field>
      </Section>

      <Section
        title="Emergency contact (optional)"
        description="If you add one, give the name, relationship and phone."
      >
        <Field label="Name" htmlFor="emergencyName" error={f.emergencyName}>
          <Input id="emergencyName" name="emergencyName" defaultValue={v.emergencyName} />
        </Field>
        <Field label="Relationship" htmlFor="emergencyRelationship" error={f.emergencyRelationship}>
          <Input id="emergencyRelationship" name="emergencyRelationship" defaultValue={v.emergencyRelationship} />
        </Field>
        <Field label="Phone" htmlFor="emergencyPhone" error={f.emergencyPhone}>
          <Input id="emergencyPhone" name="emergencyPhone" type="tel" defaultValue={v.emergencyPhone} />
        </Field>
        <Field label="Email" htmlFor="emergencyEmail" error={f.emergencyEmail}>
          <Input id="emergencyEmail" name="emergencyEmail" type="email" defaultValue={v.emergencyEmail} />
        </Field>
      </Section>

      <Section title="Onboarding & access">
        <label className="flex items-start gap-3 sm:col-span-2">
          <input
            type="checkbox"
            name="startOnboarding"
            checked={startOnboarding}
            onChange={(event) => setStartOnboarding(event.target.checked)}
            className="mt-1 size-4 accent-primary"
          />
          <span className="text-small">
            <span className="font-medium">Start onboarding now</span>
            <span className="block text-muted-foreground">
              Creates their checklist from a template and sets the status to Onboarding. Otherwise they stay Selected.
            </span>
          </span>
        </label>
        {startOnboarding && (
          <Field
            label="Onboarding template"
            htmlFor="templateId"
            error={f.templateId}
            hint="Leave on automatic to pick the best match for the position or department."
          >
            <select id="templateId" name="templateId" defaultValue={v.templateId ?? ''} className={inputClassName}>
              <option value="">Automatic</option>
              {options.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </Field>
        )}
        {canInvite && (
          <label className="flex items-start gap-3 sm:col-span-2">
            <input
              type="checkbox"
              name="sendInvitation"
              defaultChecked={v.sendInvitation === 'on'}
              className="mt-1 size-4 accent-primary"
            />
            <span className="text-small">
              <span className="font-medium">Send an invitation to Intern OS</span>
              <span className="block text-muted-foreground">
                They’ll set their own password. You can also invite them later from their profile.
              </span>
            </span>
          </label>
        )}
      </Section>

      <div className="flex flex-wrap gap-2">
        <SubmitButton pendingLabel="Creating…">Create intern</SubmitButton>
        <Link href="/interns" className={buttonVariants({ variant: 'outline' })}>
          Cancel
        </Link>
      </div>
    </form>
  )
}
