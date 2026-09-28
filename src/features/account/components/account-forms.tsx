'use client'

import { useActionState } from 'react'
import { MonitorSmartphone } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Field, FormMessage, PasswordInput, SubmitButton } from '@/features/auth/components/form-bits'
import {
  changePasswordAction,
  revokeOtherSessionsAction,
  revokeSessionAction,
  updateProfileAction,
  uploadAvatarAction,
} from '@/server/actions/account'
import type { FormState } from '@/server/actions/form-state'

const idle = { status: 'idle' } as const

export function ProfileForm({
  profile,
}: {
  profile: {
    first_name: string
    last_name: string
    display_name: string | null
    phone: string | null
    timezone: string | null
  }
}) {
  const [state, action] = useActionState<FormState, FormData>(updateProfileAction, idle)
  const value = (key: string, fallback: string | null) => state.values?.[key] ?? fallback ?? ''
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage status={state.status} message={state.message} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="firstName" error={state.fields?.firstName}>
          <Input
            id="firstName"
            name="firstName"
            autoComplete="given-name"
            required
            defaultValue={value('firstName', profile.first_name)}
          />
        </Field>
        <Field label="Last name" htmlFor="lastName" error={state.fields?.lastName}>
          <Input
            id="lastName"
            name="lastName"
            autoComplete="family-name"
            required
            defaultValue={value('lastName', profile.last_name)}
          />
        </Field>
        <Field
          label="Display name"
          htmlFor="displayName"
          hint="Optional. Shown instead of your full name."
          error={state.fields?.displayName}
        >
          <Input
            id="displayName"
            name="displayName"
            autoComplete="nickname"
            defaultValue={value('displayName', profile.display_name)}
          />
        </Field>
        <Field label="Phone" htmlFor="phone" error={state.fields?.phone}>
          <Input id="phone" name="phone" type="tel" autoComplete="tel" defaultValue={value('phone', profile.phone)} />
        </Field>
      </div>
      <input type="hidden" name="timezone" value={profile.timezone ?? ''} />
      <div>
        <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
      </div>
    </form>
  )
}

export function AvatarForm() {
  const [state, action] = useActionState<FormState, FormData>(uploadAvatarAction, idle)
  return (
    <form action={action} className="grid gap-3" encType="multipart/form-data">
      <FormMessage status={state.status} message={state.message} />
      <Field
        label="Profile photo"
        htmlFor="avatar"
        hint="PNG, JPEG or WebP, up to the upload limit."
        error={state.fields?.avatar ?? state.fields?.file}
      >
        <Input id="avatar" name="avatar" type="file" accept="image/png,image/jpeg,image/webp" required />
      </Field>
      <div>
        <SubmitButton variant="outline" size="sm" pendingLabel="Uploading…">
          Upload photo
        </SubmitButton>
      </div>
    </form>
  )
}

export function ChangePasswordForm({ minLength, email }: { minLength: number; email: string }) {
  const [state, action] = useActionState<FormState, FormData>(changePasswordAction, idle)
  return (
    <form action={action} className="grid gap-4" noValidate key={state.status === 'success' ? 'done' : 'form'}>
      <FormMessage status={state.status} message={state.message} />
      <Field label="Current password" htmlFor="currentPassword" error={state.fields?.currentPassword}>
        <PasswordInput
          id="currentPassword"
          name="currentPassword"
          autoComplete="current-password"
          error={state.fields?.currentPassword}
        />
      </Field>
      <Field label="New password" htmlFor="password" error={state.fields?.password}>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          showStrength
          minLength={minLength}
          email={email}
          error={state.fields?.password}
        />
      </Field>
      <Field label="Confirm new password" htmlFor="confirmPassword" error={state.fields?.confirmPassword}>
        <PasswordInput
          id="confirmPassword"
          name="confirmPassword"
          autoComplete="new-password"
          error={state.fields?.confirmPassword}
        />
      </Field>
      <div>
        <SubmitButton pendingLabel="Updating…">Change password</SubmitButton>
      </div>
    </form>
  )
}

export interface SessionRow {
  id: string
  device: string
  ip_address: string | null
  created_at: string
  last_seen_at: string
  current: boolean
}

export function SessionList({ sessions }: { sessions: SessionRow[] }) {
  const [revokeState, revoke] = useActionState<FormState, FormData>(revokeSessionAction, idle)
  const [othersState, revokeOthers] = useActionState<FormState, FormData>(revokeOtherSessionsAction, idle)
  const others = sessions.filter((session) => !session.current).length
  return (
    <div className="grid gap-4">
      <FormMessage status={revokeState.status} message={revokeState.message} />
      <FormMessage status={othersState.status} message={othersState.message} />
      <ul className="divide-y rounded-lg border">
        {sessions.map((session) => (
          <li key={session.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <MonitorSmartphone className="size-5 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1 text-small">
              <p className="font-medium">
                {session.device}
                {session.current && (
                  <span className="ml-2 rounded-full bg-success/12 px-2 py-0.5 text-caption text-success">
                    This device
                  </span>
                )}
              </p>
              <p className="text-caption text-muted-foreground">
                Last active {new Date(session.last_seen_at).toLocaleString()} · Signed in{' '}
                {new Date(session.created_at).toLocaleDateString()}
                {session.ip_address ? ` · ${session.ip_address}` : ''}
              </p>
            </div>
            {!session.current && (
              <form action={revoke}>
                <input type="hidden" name="sessionId" value={session.id} />
                <SubmitButton variant="outline" size="sm" pendingLabel="Signing out…">
                  Sign out
                </SubmitButton>
              </form>
            )}
          </li>
        ))}
      </ul>
      {others > 0 && (
        <form action={revokeOthers}>
          <SubmitButton variant="outline" pendingLabel="Signing out…">
            Sign out all other sessions
          </SubmitButton>
        </form>
      )}
    </div>
  )
}
