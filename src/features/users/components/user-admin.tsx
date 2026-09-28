'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, MoreHorizontal, UserPlus } from 'lucide-react'
import { ConfirmDialog } from '@/components/feedback/confirm-dialog'
import { useToast } from '@/components/feedback/toast'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input, inputClassName } from '@/components/ui/input'
import { Field, FormMessage, SubmitButton } from '@/features/auth/components/form-bits'
import type { FormState } from '@/server/actions/form-state'
import { changeRoleAction, inviteUserAction, revokeInvitationAction, setUserStatusAction } from '@/server/actions/users'

const idle = { status: 'idle' } as const

export interface RoleOption {
  id: string
  name: string
}

/** Invite dialog. In development without email delivery, shows the one-time link. */
export function InviteUserDialog({ roles }: { roles: RoleOption[] }) {
  const [open, setOpen] = React.useState(false)
  const [state, action] = useActionState<FormState<{ inviteUrl: string | null; delivery: 'email' | 'link' }>, FormData>(
    inviteUserAction,
    idle,
  )
  const [copied, setCopied] = React.useState(false)
  const done = state.status === 'success'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden /> Invite user
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite someone</DialogTitle>
          <DialogDescription>
            They’ll set their own password when they accept. Links expire and work once.
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="grid gap-4">
            <FormMessage status="success" message={state.message} />
            {state.data?.inviteUrl && (
              <div className="grid gap-2">
                <p className="text-small text-muted-foreground">
                  Email delivery isn’t configured in this development environment. Share this one-time link directly —
                  it won’t be shown again.
                </p>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={state.data.inviteUrl}
                    aria-label="Invitation link"
                    className="font-mono text-caption"
                  />
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
              </div>
            )}
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form action={action} className="grid gap-4" noValidate>
            <FormMessage status={state.status} message={state.message} />
            <Field label="Email" htmlFor="invite-email" error={state.fields?.email}>
              <Input id="invite-email" name="email" type="email" required defaultValue={state.values?.email} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name" htmlFor="invite-first" error={state.fields?.firstName}>
                <Input id="invite-first" name="firstName" required defaultValue={state.values?.firstName} />
              </Field>
              <Field label="Last name" htmlFor="invite-last" error={state.fields?.lastName}>
                <Input id="invite-last" name="lastName" required defaultValue={state.values?.lastName} />
              </Field>
            </div>
            <Field
              label="Role"
              htmlFor="invite-role"
              error={state.fields?.roleId}
              hint="Only roles below your own can be assigned."
            >
              <select
                id="invite-role"
                name="roleId"
                required
                defaultValue={state.values?.roleId ?? ''}
                className={inputClassName}
              >
                <option value="" disabled>
                  Choose a role
                </option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </Field>
            <DialogFooter>
              <SubmitButton pendingLabel="Sending…">Send invitation</SubmitButton>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Per-user actions. Options reflect the viewer's permissions; the server re-checks everything. */
export function UserRowActions({
  user,
  roles,
  can,
}: {
  user: { id: string; name: string; status: string; roleId: string | null }
  roles: RoleOption[]
  can: { assignRole: boolean; suspend: boolean; deactivate: boolean }
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [roleOpen, setRoleOpen] = React.useState(false)
  const [confirm, setConfirm] = React.useState<null | 'SUSPENDED' | 'INACTIVE' | 'ACTIVE'>(null)
  const [roleState, roleAction] = useActionState<FormState, FormData>(async (prev, formData) => {
    const result = await changeRoleAction(prev, formData)
    if (result.status === 'success') {
      setRoleOpen(false)
      toast({ title: result.message ?? 'Role updated', variant: 'success' })
      router.refresh()
    }
    return result
  }, idle)

  const options = [can.assignRole, can.suspend, can.deactivate].some(Boolean)
  if (!options || user.status === 'INVITED') return null

  async function changeStatus(status: 'SUSPENDED' | 'INACTIVE' | 'ACTIVE') {
    const formData = new FormData()
    formData.set('userId', user.id)
    formData.set('status', status)
    const result = await setUserStatusAction(idle, formData)
    toast({ title: result.message ?? 'Done', variant: result.status === 'error' ? 'error' : 'success' })
    router.refresh()
  }

  const confirmCopy = {
    SUSPENDED: {
      title: `Suspend ${user.name}?`,
      body: 'They’ll be signed out everywhere and can’t sign in until reactivated.',
      label: 'Suspend',
    },
    INACTIVE: {
      title: `Deactivate ${user.name}?`,
      body: 'Use this when someone leaves. They lose access; their records are kept.',
      label: 'Deactivate',
    },
    ACTIVE: {
      title: `Reactivate ${user.name}?`,
      body: 'They’ll be able to sign in again with their existing roles.',
      label: 'Reactivate',
    },
  } as const

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${user.name}`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {can.assignRole && <DropdownMenuItem onSelect={() => setRoleOpen(true)}>Change role…</DropdownMenuItem>}
          {(can.suspend || can.deactivate) && can.assignRole && <DropdownMenuSeparator />}
          {can.suspend && user.status === 'ACTIVE' && (
            <DropdownMenuItem onSelect={() => setConfirm('SUSPENDED')}>Suspend…</DropdownMenuItem>
          )}
          {can.suspend && user.status !== 'ACTIVE' && (
            <DropdownMenuItem onSelect={() => setConfirm('ACTIVE')}>Reactivate…</DropdownMenuItem>
          )}
          {can.deactivate && user.status !== 'INACTIVE' && (
            <DropdownMenuItem className="text-destructive" onSelect={() => setConfirm('INACTIVE')}>
              Deactivate…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={roleOpen} onOpenChange={setRoleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change role</DialogTitle>
            <DialogDescription>{user.name}’s permissions change on their next request.</DialogDescription>
          </DialogHeader>
          <form action={roleAction} className="grid gap-4">
            <FormMessage status={roleState.status === 'error' ? 'error' : 'idle'} message={roleState.message} />
            <input type="hidden" name="userId" value={user.id} />
            <Field label="Role" htmlFor={`role-${user.id}`}>
              <select
                id={`role-${user.id}`}
                name="roleId"
                defaultValue={user.roleId ?? ''}
                className={inputClassName}
                required
              >
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </Field>
            <DialogFooter>
              <SubmitButton pendingLabel="Saving…">Save role</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirm(null)}
          title={confirmCopy[confirm].title}
          description={confirmCopy[confirm].body}
          confirmLabel={confirmCopy[confirm].label}
          destructive={confirm !== 'ACTIVE'}
          onConfirm={() => changeStatus(confirm)}
        />
      )}
    </>
  )
}

export function RevokeInvitationButton({ invitationId, email }: { invitationId: string; email: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Revoke
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Revoke invitation?"
        description={`The link sent to ${email} will stop working.`}
        confirmLabel="Revoke"
        destructive
        onConfirm={async () => {
          const formData = new FormData()
          formData.set('invitationId', invitationId)
          const result = await revokeInvitationAction(idle, formData)
          toast({ title: result.message ?? 'Done', variant: result.status === 'error' ? 'error' : 'success' })
          router.refresh()
        }}
      />
    </>
  )
}
