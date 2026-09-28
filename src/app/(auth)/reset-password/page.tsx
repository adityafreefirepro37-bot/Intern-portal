import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { ResetPasswordForm } from '@/features/auth/components/auth-forms'
import { FormMessage } from '@/features/auth/components/form-bits'
import { getAuthProvider } from '@/lib/auth/provider'
import { config } from '@/lib/config'
import { firstParam } from '@/lib/validation/list-params'

export const metadata: Metadata = { title: 'Choose a new password' }

/**
 * Reached through the reset link, which creates a short-lived recovery
 * session. Without that session the page explains that the link is invalid
 * or expired instead of showing a form that can't work.
 */
export default async function ResetPasswordPage({ searchParams }: PageProps<'/reset-password'>) {
  await connection()
  const error = firstParam(await searchParams, 'error')
  const session = error ? null : await getAuthProvider().getSession()

  if (!session) {
    return (
      <div className="grid gap-5 text-center">
        <h1 className="text-h2">Link {error === 'expired' ? 'expired' : 'not valid'}</h1>
        <FormMessage
          status="error"
          message={
            error === 'expired'
              ? 'This password reset link has expired. Reset links are valid for a limited time.'
              : 'This password reset link is invalid or was already used.'
          }
        />
        <Link href="/forgot-password" className="text-small font-medium text-primary hover:underline">
          Request a new link
        </Link>
      </div>
    )
  }

  return (
    <div className="grid gap-6">
      <div className="space-y-1.5 text-center">
        <h1 className="text-h2">Choose a new password</h1>
        <p className="text-small text-muted-foreground">
          After saving, you’ll stay signed in here and every other session will be signed out.
        </p>
      </div>
      <ResetPasswordForm minLength={config.auth.passwordMinLength} email={session.email ?? undefined} />
    </div>
  )
}
