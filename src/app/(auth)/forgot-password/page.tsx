import type { Metadata } from 'next'
import { ForgotPasswordForm } from '@/features/auth/components/auth-forms'

export const metadata: Metadata = { title: 'Reset your password' }

export default function ForgotPasswordPage() {
  return (
    <div className="grid gap-6">
      <div className="space-y-1.5 text-center">
        <h1 className="text-h2">Reset your password</h1>
        <p className="text-small text-muted-foreground">Enter your work email and we’ll send you a reset link.</p>
      </div>
      <ForgotPasswordForm />
    </div>
  )
}
