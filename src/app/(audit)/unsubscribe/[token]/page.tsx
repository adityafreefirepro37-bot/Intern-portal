import type { Metadata } from 'next'
import { UnsubscribeButton } from '@/features/growth/components/audit-page-client'

export const metadata: Metadata = { title: 'Unsubscribe', robots: { index: false, follow: false } }

/** The footer link of every outreach email: one button, no sign-in. */
export default async function UnsubscribePage({ params }: PageProps<'/unsubscribe/[token]'>) {
  const { token } = await params
  return (
    <div className="mx-auto max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
      <h1 className="text-h2">Stop these emails?</h1>
      <p className="mt-2 text-small text-muted-foreground">We’ll remove your email address from our list and won’t email you again.</p>
      <div className="mt-6">
        <UnsubscribeButton token={token} />
      </div>
    </div>
  )
}
