import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { MailCheck } from 'lucide-react'
import { ResendVerificationForm, SignOutButton } from '@/features/auth/components/auth-forms'
import { getAuthState, redirectPathFor } from '@/server/context'

export const metadata: Metadata = { title: 'Verify your email' }

export default async function VerifyEmailPage() {
  const state = await getAuthState()
  if (state.status === 'AUTHENTICATED') redirect('/')
  if (state.status !== 'EMAIL_UNVERIFIED') redirect(redirectPathFor(state))

  return (
    <div className="grid gap-5 text-center">
      <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <MailCheck className="size-5" aria-hidden />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-h2">Verify your email</h1>
        <p className="text-small text-muted-foreground">
          We sent a confirmation link to <strong className="text-foreground">{state.email}</strong>. Open it to finish
          setting up your account.
        </p>
      </div>
      <ResendVerificationForm />
      <SignOutButton />
    </div>
  )
}
