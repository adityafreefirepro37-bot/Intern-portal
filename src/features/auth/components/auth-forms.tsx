'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  acceptInvitationAction,
  completePasswordResetAction,
  requestPasswordResetAction,
  resendVerificationAction,
  signInAction,
  signOutAction,
} from '@/server/actions/auth'
import type { FormState } from '@/server/actions/form-state'
import { Field, FormMessage, PasswordInput, SubmitButton } from './form-bits'

const idle = { status: 'idle' } as const

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState<FormState<{ state: string }>, FormData>(signInAction, idle)
  const unverified = state.data?.state === 'EMAIL_UNVERIFIED'
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage status={state.status} message={state.message} />
      {unverified && (
        <p className="text-small text-muted-foreground">
          Didn’t get the email? Sign in after confirming, or ask HR to resend your invitation.
        </p>
      )}
      {next && <input type="hidden" name="next" value={next} />}
      <Field label="Email" htmlFor="email" error={state.fields?.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          autoFocus
          defaultValue={state.values?.email}
          aria-invalid={state.fields?.email ? true : undefined}
          aria-describedby={state.fields?.email ? 'email-error' : undefined}
        />
      </Field>
      <Field
        label="Password"
        htmlFor="password"
        error={state.fields?.password}
        action={
          <Link href="/forgot-password" className="text-caption font-medium text-primary hover:underline">
            Forgot password?
          </Link>
        }
      >
        <PasswordInput id="password" name="password" autoComplete="current-password" error={state.fields?.password} />
      </Field>
      <SubmitButton className="mt-1 w-full" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  )
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState<FormState, FormData>(requestPasswordResetAction, idle)
  if (state.status === 'success') {
    return (
      <div className="grid gap-4">
        <FormMessage status="success" message={state.message} />
        <Link href="/login" className="text-center text-small font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    )
  }
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage status={state.status} message={state.message} />
      <Field label="Email" htmlFor="email" error={state.fields?.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          defaultValue={state.values?.email}
        />
      </Field>
      <SubmitButton className="w-full" pendingLabel="Sending…">
        Send reset link
      </SubmitButton>
      <Link href="/login" className="text-center text-small font-medium text-primary hover:underline">
        Back to sign in
      </Link>
    </form>
  )
}

export function ResetPasswordForm({ minLength, email }: { minLength: number; email?: string }) {
  const [state, action] = useActionState<FormState, FormData>(completePasswordResetAction, idle)
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage status={state.status} message={state.message} />
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
      <SubmitButton className="w-full" pendingLabel="Saving…">
        Set new password
      </SubmitButton>
    </form>
  )
}

export function AcceptInviteForm({
  token,
  email,
  firstName,
  lastName,
  minLength,
}: {
  token: string
  email: string
  firstName: string
  lastName: string
  minLength: number
}) {
  const [state, action] = useActionState<FormState<{ email: string; verificationPending: boolean }>, FormData>(
    acceptInvitationAction,
    idle,
  )
  if (state.status === 'success') {
    return (
      <div className="grid gap-4">
        <FormMessage status="success" message={state.message} />
        <Button asChild variant="outline">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    )
  }
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage status={state.status} message={state.message} />
      <input type="hidden" name="token" value={token} />
      <Field label="Email" htmlFor="invite-email">
        <Input id="invite-email" value={email} readOnly disabled autoComplete="username" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="firstName" error={state.fields?.firstName}>
          <Input
            id="firstName"
            name="firstName"
            autoComplete="given-name"
            required
            defaultValue={state.values?.firstName ?? firstName}
          />
        </Field>
        <Field label="Last name" htmlFor="lastName" error={state.fields?.lastName}>
          <Input
            id="lastName"
            name="lastName"
            autoComplete="family-name"
            required
            defaultValue={state.values?.lastName ?? lastName}
          />
        </Field>
      </div>
      <Field label="Password" htmlFor="password" error={state.fields?.password}>
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
      <Field label="Confirm password" htmlFor="confirmPassword" error={state.fields?.confirmPassword}>
        <PasswordInput
          id="confirmPassword"
          name="confirmPassword"
          autoComplete="new-password"
          error={state.fields?.confirmPassword}
        />
      </Field>
      <SubmitButton className="w-full" pendingLabel="Creating account…">
        Create account
      </SubmitButton>
    </form>
  )
}

export function ResendVerificationForm() {
  const [state, action] = useActionState<FormState, FormData>(resendVerificationAction, idle)
  return (
    <form action={action} className="grid gap-3">
      <FormMessage status={state.status} message={state.message} />
      <SubmitButton variant="outline" className="w-full" pendingLabel="Sending…">
        Resend verification email
      </SubmitButton>
    </form>
  )
}

/** POST sign-out (a server action, so it can't be triggered cross-site). */
export function SignOutButton({ variant = 'ghost', className }: { variant?: 'ghost' | 'outline'; className?: string }) {
  return (
    <form action={signOutAction} className={className}>
      <SubmitButton variant={variant} className="w-full" pendingLabel="Signing out…">
        <LogOut aria-hidden /> Sign out
      </SubmitButton>
    </form>
  )
}
