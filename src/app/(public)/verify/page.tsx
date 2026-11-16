import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { normalizeVerificationCode } from '@/lib/certificates/content'
import { firstParam } from '@/lib/validation/list-params'

export const metadata: Metadata = { title: 'Verify a certificate', robots: { index: false, follow: false } }

/** Enter the code printed on a certificate (its QR code links straight to the result). */
export default async function VerifyPage({ searchParams }: PageProps<'/verify'>) {
  const raw = firstParam(await searchParams, 'code')
  const code = raw ? normalizeVerificationCode(raw) : null
  if (code) redirect(`/verify/${code}`)
  return (
    <div className="grid gap-5">
      <div className="space-y-2 text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ShieldCheck className="size-5" aria-hidden />
        </span>
        <h1 className="text-h2">Verify a certificate</h1>
        <p className="text-small text-muted-foreground">
          Enter the verification code printed on the certificate, for example{' '}
          <span className="font-mono">7KQP-M4XZ-9TRB</span>.
        </p>
      </div>
      <form method="get" className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="code">Verification code</Label>
          <Input
            id="code"
            name="code"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="XXXX-XXXX-XXXX"
            defaultValue={raw ?? ''}
            aria-describedby={raw ? 'code-error' : undefined}
          />
          {raw && (
            <p id="code-error" role="alert" className="text-caption font-medium text-destructive">
              That doesn’t look like a verification code. Codes have 12 letters and numbers.
            </p>
          )}
        </div>
        <Button type="submit">Check certificate</Button>
      </form>
    </div>
  )
}
