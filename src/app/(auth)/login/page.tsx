import type { Metadata } from 'next'
import { FormMessage } from '@/features/auth/components/form-bits'
import { LoginForm } from '@/features/auth/components/auth-forms'
import { safeNextPath } from '@/lib/auth/redirect'
import { config } from '@/lib/config'
import { firstParam } from '@/lib/validation/list-params'

export const metadata: Metadata = { title: 'Sign in' }

const NOTICES: Record<string, { status: 'success' | 'error'; message: string }> = {
  session_expired: { status: 'error', message: 'Your session has expired. Please sign in again.' },
  signed_out: { status: 'success', message: 'You’ve been signed out.' },
  link_expired: { status: 'error', message: 'That link has expired. Sign in, or request a new link.' },
  link_invalid: { status: 'error', message: 'That link is invalid or was already used.' },
}

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const params = await searchParams
  const next = safeNextPath(firstParam(params, 'next'), '')
  const noticeKey =
    firstParam(params, 'reason') ?? (firstParam(params, 'signed_out') ? 'signed_out' : firstParam(params, 'error'))
  const notice = noticeKey ? NOTICES[noticeKey] : undefined

  return (
    <div className="grid gap-6">
      <div className="space-y-1.5 text-center">
        <h1 className="text-h2">Welcome back</h1>
        <p className="text-small text-muted-foreground">Sign in to Ayava Creatives Intern OS</p>
      </div>
      {notice && <FormMessage status={notice.status} message={notice.message} />}
      {config.auth.configured ? (
        <LoginForm next={next || undefined} />
      ) : (
        <p role="status" className="rounded-lg border bg-muted/50 p-3 text-small text-muted-foreground">
          Sign-in isn’t configured for this environment. An administrator needs to set the Supabase keys (SUPABASE_URL,
          SUPABASE_PUBLISHABLE_KEY).
        </p>
      )}
    </div>
  )
}
