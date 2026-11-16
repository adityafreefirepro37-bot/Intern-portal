'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Archive, Hash, MessageSquarePlus, Plus, Settings, UserMinus } from 'lucide-react'
import { PeoplePicker, type PickerOption } from '@/components/common/people-picker'
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
import { ActionButton } from '@/features/hr/components/action-form'
import { useFormAction } from '@/features/interns/components/use-form-action'
import { cn } from '@/lib/utils'
import {
  addChannelMembersAction,
  archiveChannelAction,
  createChannelAction,
  openDirectMessageAction,
  removeChannelMemberAction,
  updateChannelAction,
} from '@/server/actions/communication'

/** Start (or reopen) a direct conversation with one person. */
export function NewDirectMessage({ people }: { people: PickerOption[] }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [state, action] = useFormAction(openDirectMessageAction, {
    toast: false,
    onSuccess: (result) => {
      setOpen(false)
      if (result.data?.slug) router.push(`/messages/${result.data.slug}`)
    },
  })
  const q = query.trim().toLowerCase()
  const shown = people.filter((p) => !q || p.name.toLowerCase().includes(q)).slice(0, 50)
  return (
    <>
      <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)} aria-label="New direct message">
        <MessageSquarePlus aria-hidden />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New direct message</DialogTitle>
            <DialogDescription>Only the two of you can read a direct conversation.</DialogDescription>
          </DialogHeader>
          <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people…"
            aria-label="Search people"
            autoFocus
          />
          <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
            {shown.length === 0 && <li className="p-3 text-small text-muted-foreground">Nobody matches.</li>}
            {shown.map((p) => (
              <li key={p.id}>
                <form action={action}>
                  <input type="hidden" name="userId" value={p.id} />
                  <button type="submit" className="flex w-full items-center justify-between px-3 py-2 text-left text-small hover:bg-accent">
                    {p.name}
                    {p.detail && <span className="text-caption text-muted-foreground">{p.detail}</span>}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  )
}

export interface ChannelOptions {
  teams: { id: string; name: string }[]
  departments: { id: string; name: string }[]
  projects: { id: string; name: string }[]
  people: { id: string; name: string }[]
}

const TYPE_HINT: Record<string, string> = {
  GENERAL: 'Everyone in the organization can read and post.',
  TEAM: 'Only members. Add a whole team below, plus anyone else.',
  DEPARTMENT: 'Only members. Add a whole department below, plus anyone else.',
  PROJECT: 'Only members. Add everyone on a project below, plus anyone else.',
}

export function NewChannel({ options }: { options: ChannelOptions }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [type, setType] = React.useState('TEAM')
  const [state, action] = useFormAction(createChannelAction, {
    onSuccess: (result) => {
      setOpen(false)
      if (result.data?.slug) router.push(`/messages/${result.data.slug}`)
    },
  })
  const id = React.useId()
  const source =
    type === 'TEAM'
      ? { name: 'teamId', label: 'Add everyone from team', items: options.teams }
      : type === 'DEPARTMENT'
        ? { name: 'departmentId', label: 'Add everyone from department', items: options.departments }
        : type === 'PROJECT'
          ? { name: 'projectId', label: 'Add everyone on project', items: options.projects }
          : null
  return (
    <>
      <Button variant="ghost" size="icon-sm" onClick={() => setOpen(true)} aria-label="New channel">
        <Plus aria-hidden />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New channel</DialogTitle>
            <DialogDescription>{TYPE_HINT[type]}</DialogDescription>
          </DialogHeader>
          <form action={action} className="grid gap-4">
            <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
            <Field label="Name" htmlFor={`${id}-name`} error={state.fields?.name}>
              <Input id={`${id}-name`} name="name" required minLength={2} maxLength={60} placeholder="design-team" />
            </Field>
            <Field label="Purpose (optional)" htmlFor={`${id}-description`} error={state.fields?.description}>
              <Textarea id={`${id}-description`} name="description" rows={2} maxLength={300} />
            </Field>
            <Field label="Type" htmlFor={`${id}-type`} error={state.fields?.channelType}>
              <select
                id={`${id}-type`}
                name="channelType"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className={inputClassName}
              >
                <option value="TEAM">Team</option>
                <option value="DEPARTMENT">Department</option>
                <option value="PROJECT">Project</option>
                <option value="GENERAL">Company-wide</option>
              </select>
            </Field>
            {source && (
              <>
                <Field label={`${source.label} (optional)`} htmlFor={`${id}-source`}>
                  <select id={`${id}-source`} name={source.name} defaultValue="" className={inputClassName}>
                    <option value="">—</option>
                    {source.items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Members" htmlFor={`${id}-members`} hint="You're added automatically." error={state.fields?.memberIds}>
                  <PeoplePicker id={`${id}-members`} name="memberIds" label="Members" options={options.people} />
                </Field>
              </>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton pendingLabel="Creating…">Create channel</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Channel details for managers (rename, members, archive) and a "Leave" for members. */
export function ChannelSettings({
  channel,
  members,
  people,
  canManage,
  meId,
}: {
  channel: { id: string; name: string; description: string | null; type: string; archived: boolean }
  members: { id: string; name: string }[]
  people: { id: string; name: string }[]
  canManage: boolean
  meId: string
}) {
  const [open, setOpen] = React.useState(false)
  const [details, saveDetails] = useFormAction(updateChannelAction)
  const [adding, addMembers] = useFormAction(addChannelMembersAction)
  const id = React.useId()
  const hasMembers = channel.type !== 'GENERAL'
  const memberIds = new Set(members.map((m) => m.id))
  const candidates = people.filter((p) => !memberIds.has(p.id))
  const isMember = memberIds.has(meId)
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label="Channel details">
        <Settings aria-hidden />
        <span className="hidden sm:inline">{hasMembers ? `${members.length} members` : 'Details'}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <Hash className="size-4" aria-hidden /> {channel.name}
            </DialogTitle>
            <DialogDescription>
              {channel.type === 'GENERAL' ? 'Company-wide: everyone can read and post.' : 'Only members can read and post.'}
            </DialogDescription>
          </DialogHeader>
          {canManage && !channel.archived && (
            <form action={saveDetails} className="grid gap-3 rounded-lg border p-3">
              <input type="hidden" name="channelId" value={channel.id} />
              <FormMessage status={details.status === 'error' ? 'error' : 'idle'} message={details.message} />
              <Field label="Name" htmlFor={`${id}-name`} error={details.fields?.name}>
                <Input id={`${id}-name`} name="name" required minLength={2} maxLength={60} defaultValue={channel.name} />
              </Field>
              <Field label="Purpose" htmlFor={`${id}-desc`} error={details.fields?.description}>
                <Textarea id={`${id}-desc`} name="description" rows={2} maxLength={300} defaultValue={channel.description ?? ''} />
              </Field>
              <SubmitButton size="sm" className="justify-self-start">
                Save
              </SubmitButton>
            </form>
          )}
          {!canManage && channel.description && <p className="text-small">{channel.description}</p>}
          {hasMembers && (
            <section className="space-y-2">
              <h3 className="text-small font-semibold">Members</h3>
              <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">
                {members.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-small">
                    <span className="truncate">
                      {m.name}
                      {m.id === meId && <span className="text-muted-foreground"> (you)</span>}
                    </span>
                    {canManage && m.id !== meId && !channel.archived && (
                      <ActionButton
                        action={removeChannelMemberAction}
                        fields={{ channelId: channel.id, userId: m.id }}
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${m.name}`}
                      >
                        <UserMinus aria-hidden />
                      </ActionButton>
                    )}
                  </li>
                ))}
              </ul>
              {canManage && !channel.archived && candidates.length > 0 && (
                <form action={addMembers} className="grid gap-2">
                  <input type="hidden" name="channelId" value={channel.id} />
                  <FormMessage status={adding.status === 'error' ? 'error' : 'idle'} message={adding.message} />
                  <PeoplePicker id={`${id}-add`} name="memberIds" label="Add people" options={candidates} />
                  <SubmitButton size="sm" variant="outline" className="justify-self-start">
                    Add selected
                  </SubmitButton>
                </form>
              )}
            </section>
          )}
          <DialogFooter className={cn('gap-2', !canManage && 'sm:justify-start')}>
            {hasMembers && isMember && !channel.archived && (
              <ActionButton action={removeChannelMemberAction} fields={{ channelId: channel.id, userId: meId }} variant="outline">
                Leave channel
              </ActionButton>
            )}
            {canManage && (
              <ActionButton
                action={archiveChannelAction}
                fields={{ channelId: channel.id, archived: String(!channel.archived) }}
                variant="outline"
              >
                <Archive aria-hidden /> {channel.archived ? 'Restore channel' : 'Archive channel'}
              </ActionButton>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
