import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { AcceptInviteForm } from '@/features/auth/components/auth-forms'
import { FormMessage } from '@/features/auth/components/form-bits'
import { config } from '@/lib/config'
import { invitationService } from '@/server/services/invitation.service'

export const metadata: Metadata = { title: 'Accept invitation', referrer: 'no-referrer' }

const REASONS = {
  invalid: 'This invitation link is invalid.',
  expired: 'This invitation has expired. Ask HR to send a new one.',
  used: 'This invitation was already used. Sign in instead.',
  revoked: 'This invitation was withdrawn. Ask HR if you still need access.',
} as const

export default async function AcceptInvitationPage({ params }: PageProps<'/invite/[token]'>) {
  await connection()
  const { token } = await params
  const preview = await invitationService.preview(token)

  if (!preview.valid) {
    return (
      <div className="grid gap-5 text-center">
        <h1 className="text-h2">Invitation unavailable</h1>
        <FormMessage status="error" message={REASONS[preview.reason]} />
        <Link href="/login" className="text-small font-medium text-primary hover:underline">
          Go to sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="grid gap-6">
      <div className="space-y-1.5 text-center">
        <h1 className="text-h2">Join {preview.organizationName}</h1>
        <p className="text-small text-muted-foreground">
          You’ve been invited as <strong className="text-foreground">{preview.roleName}</strong>. Create a password to
          set up your account.
        </p>
      </div>
      <AcceptInviteForm
        token={token}
        email={preview.email}
        firstName={preview.firstName}
        lastName={preview.lastName}
        minLength={config.auth.passwordMinLength}
      />
    </div>
  )
}
