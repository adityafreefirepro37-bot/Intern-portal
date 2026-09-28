import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Ban, CircleOff, UserX } from 'lucide-react'
import { SignOutButton } from '@/features/auth/components/auth-forms'
import { getAuthState, redirectPathFor } from '@/server/context'

export const metadata: Metadata = { title: 'Account status' }

/**
 * Explains why a signed-in person can't use the app. The state is always
 * re-derived on the server — the URL parameter is never trusted.
 */
const CONTENT = {
  ACCOUNT_SUSPENDED: {
    icon: Ban,
    title: 'Account suspended',
    body: 'Your access to Intern OS has been suspended. Contact an administrator if you think this is a mistake.',
  },
  ACCOUNT_INACTIVE: {
    icon: CircleOff,
    title: 'Account inactive',
    body: 'This account is no longer active. Contact HR if you need access again.',
  },
  PROFILE_INCOMPLETE: {
    icon: UserX,
    title: 'Profile not set up',
    body: 'You’re signed in, but there’s no Intern OS profile for this account yet. Ask HR to invite you or link your account.',
  },
} as const

export default async function AccountStatusPage() {
  const state = await getAuthState()
  if (state.status === 'AUTHENTICATED') redirect('/')
  if (!(state.status in CONTENT)) redirect(redirectPathFor(state))
  const content = CONTENT[state.status as keyof typeof CONTENT]
  const Icon = content.icon

  return (
    <div className="grid gap-5 text-center">
      <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-warning/14 text-warning">
        <Icon className="size-5" aria-hidden />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-h2">{content.title}</h1>
        <p className="text-small text-muted-foreground">{content.body}</p>
      </div>
      <SignOutButton variant="outline" />
    </div>
  )
}
