'use client'

import { Archive, ArchiveRestore, Pencil, Plus } from 'lucide-react'
import { EditorDialog, Select } from '@/components/forms/editor-dialog'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Field } from '@/features/auth/components/form-bits'
import { ConfirmActionButton } from '@/features/learning/components/confirm-action'
import { fullName } from '@/lib/utils'
import {
  saveDepartmentAction,
  savePositionAction,
  saveTeamAction,
  setDepartmentActiveAction,
  setPositionActiveAction,
  setTeamActiveAction,
} from '@/server/actions/organization'

/** Editors for departments, teams and positions (permissions are re-checked on the server). */

type Person = { id: string; first_name: string; last_name: string; display_name: string | null }
type Option = { id: string; name: string }

const people = (members: Person[]) => members.map((m) => ({ value: m.id, label: fullName(m) }))
const options = (items: Option[]) => items.map((o) => ({ value: o.id, label: o.name }))

function Trigger({ editing, label, open }: { editing: boolean; label: string; open: () => void }) {
  return editing ? (
    <Button variant="ghost" size="icon" onClick={open} aria-label={`Edit ${label}`}>
      <Pencil aria-hidden />
    </Button>
  ) : (
    <Button variant="outline" onClick={open}>
      <Plus aria-hidden /> {label}
    </Button>
  )
}

export function DepartmentDialog({
  department,
  members,
}: {
  department?: { id: string; name: string; description: string | null; head: Person | null }
  members: Person[]
}) {
  return (
    <EditorDialog
      title={department ? `Edit ${department.name}` : 'New department'}
      description="The department head can see the interns placed in this department."
      action={saveDepartmentAction}
      trigger={(open) => <Trigger editing={Boolean(department)} label={department ? department.name : 'New department'} open={open} />}
    >
      {(state) => (
        <>
          {department && <input type="hidden" name="departmentId" value={department.id} />}
          <Field label="Name" htmlFor="dept-name" error={state.fields?.name}>
            <Input id="dept-name" name="name" required minLength={2} maxLength={120} defaultValue={state.values?.name ?? department?.name} />
          </Field>
          <Field label="Description (optional)" htmlFor="dept-description" error={state.fields?.description}>
            <Textarea
              id="dept-description"
              name="description"
              rows={2}
              maxLength={500}
              defaultValue={state.values?.description ?? department?.description ?? ''}
            />
          </Field>
          <Field label="Head (optional)" htmlFor="dept-head" error={state.fields?.headUserId}>
            <Select
              id="dept-head"
              name="headUserId"
              defaultValue={state.values?.headUserId ?? department?.head?.id}
              options={people(members)}
              empty="No head"
            />
          </Field>
        </>
      )}
    </EditorDialog>
  )
}

export function TeamDialog({
  team,
  departments,
  members,
  departmentId,
}: {
  team?: { id: string; name: string; description: string | null; department_id: string | null; team_lead: Person | null }
  /** Active departments a team can belong to. */
  departments: Option[]
  members: Person[]
  /** Preselected department for a new team. */
  departmentId?: string
}) {
  return (
    <EditorDialog
      title={team ? `Edit ${team.name}` : 'New team'}
      description="The team lead can see the interns placed in this team."
      action={saveTeamAction}
      trigger={(open) => <Trigger editing={Boolean(team)} label={team ? team.name : 'New team'} open={open} />}
    >
      {(state) => (
        <>
          {team && <input type="hidden" name="teamId" value={team.id} />}
          <Field label="Name" htmlFor="team-name" error={state.fields?.name}>
            <Input id="team-name" name="name" required minLength={2} maxLength={120} defaultValue={state.values?.name ?? team?.name} />
          </Field>
          <Field label="Department" htmlFor="team-department" error={state.fields?.departmentId}>
            <Select
              id="team-department"
              name="departmentId"
              defaultValue={state.values?.departmentId ?? team?.department_id ?? departmentId}
              options={options(departments)}
              empty="Not in a department"
            />
          </Field>
          <Field label="Description (optional)" htmlFor="team-description" error={state.fields?.description}>
            <Textarea
              id="team-description"
              name="description"
              rows={2}
              maxLength={500}
              defaultValue={state.values?.description ?? team?.description ?? ''}
            />
          </Field>
          <Field label="Team lead (optional)" htmlFor="team-lead" error={state.fields?.leadUserId}>
            <Select
              id="team-lead"
              name="leadUserId"
              defaultValue={state.values?.leadUserId ?? team?.team_lead?.id}
              options={people(members)}
              empty="No lead"
            />
          </Field>
        </>
      )}
    </EditorDialog>
  )
}

export function PositionDialog({
  position,
  departments,
  departmentId,
}: {
  position?: { id: string; title: string; description: string | null; department_id: string | null }
  departments: Option[]
  departmentId?: string
}) {
  return (
    <EditorDialog
      title={position ? `Edit ${position.title}` : 'New position'}
      description="Positions are the roles interns are placed in, e.g. “Frontend Developer Intern”."
      action={savePositionAction}
      trigger={(open) => <Trigger editing={Boolean(position)} label={position ? position.title : 'New position'} open={open} />}
    >
      {(state) => (
        <>
          {position && <input type="hidden" name="positionId" value={position.id} />}
          <Field label="Title" htmlFor="position-title" error={state.fields?.title}>
            <Input
              id="position-title"
              name="title"
              required
              minLength={2}
              maxLength={120}
              defaultValue={state.values?.title ?? position?.title}
            />
          </Field>
          <Field label="Department" htmlFor="position-department" error={state.fields?.departmentId}>
            <Select
              id="position-department"
              name="departmentId"
              defaultValue={state.values?.departmentId ?? position?.department_id ?? departmentId}
              options={options(departments)}
              empty="Any department"
            />
          </Field>
          <Field label="Description (optional)" htmlFor="position-description" error={state.fields?.description}>
            <Textarea
              id="position-description"
              name="description"
              rows={2}
              maxLength={500}
              defaultValue={state.values?.description ?? position?.description ?? ''}
            />
          </Field>
        </>
      )}
    </EditorDialog>
  )
}

const ARCHIVE_ACTIONS = {
  department: setDepartmentActiveAction,
  team: setTeamActiveAction,
  position: setPositionActiveAction,
}

/** Archive (hide from pickers, keep history) or restore a department, team or position. */
export function ArchiveButton({
  kind,
  id,
  name,
  active,
}: {
  kind: keyof typeof ARCHIVE_ACTIONS
  id: string
  name: string
  active: boolean
}) {
  return active ? (
    <ConfirmActionButton
      action={ARCHIVE_ACTIONS[kind]}
      fields={{ id, active: 'false' }}
      title={`Archive ${name}?`}
      description={`It disappears from pickers but keeps its history, and you can restore it later. A ${kind} with current interns can’t be archived.`}
      confirmLabel="Archive"
      destructive
      variant="ghost"
      size="icon"
      aria-label={`Archive ${name}`}
    >
      <Archive aria-hidden />
    </ConfirmActionButton>
  ) : (
    <ConfirmActionButton
      action={ARCHIVE_ACTIONS[kind]}
      fields={{ id, active: 'true' }}
      title={`Restore ${name}?`}
      description="It becomes available in pickers again."
      confirmLabel="Restore"
      variant="outline"
      size="sm"
    >
      <ArchiveRestore aria-hidden /> Restore
    </ConfirmActionButton>
  )
}
