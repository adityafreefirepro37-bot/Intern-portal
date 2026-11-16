import type { Metadata } from 'next'
import Link from 'next/link'
import { BadgeCheck, CircleX, SearchX } from 'lucide-react'
import { CERTIFICATE_TYPE_LABELS, formatCertificateDate } from '@/lib/certificates/content'
import { getRequestMeta } from '@/lib/http/request-meta'
import { certificateService } from '@/server/services/certificate.service'
import { RateLimitedError } from '@/server/services/rate-limit.service'

export const metadata: Metadata = { title: 'Certificate verification', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

/** Public result of a certificate check: valid, revoked or not found — only what the certificate states. */
export default async function VerifyResultPage({ params }: PageProps<'/verify/[code]'>) {
  const { code } = await params
  let result: Awaited<ReturnType<typeof certificateService.verify>>
  try {
    result = await certificateService.verify(decodeURIComponent(code), (await getRequestMeta()).ipAddress)
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return (
        <div className="grid gap-3 text-center">
          <h1 className="text-h2">Too many checks</h1>
          <p className="text-small text-muted-foreground">Please wait a few minutes and try again.</p>
        </div>
      )
    }
    throw error
  }

  if (!result) {
    return (
      <div className="grid gap-4 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <SearchX className="size-6" aria-hidden />
        </span>
        <h1 className="text-h2">No certificate found</h1>
        <p className="text-small text-muted-foreground">
          No certificate matches this code. Check it against the certificate — codes have 12 letters and numbers.
        </p>
        <Link href="/verify" className="text-small font-medium text-primary hover:underline">
          Try another code
        </Link>
      </div>
    )
  }

  const period =
    result.periodStart && result.periodEnd
      ? `${formatCertificateDate(result.periodStart)} – ${formatCertificateDate(result.periodEnd)}`
      : result.periodEnd
        ? formatCertificateDate(result.periodEnd)
        : null
  const rows: [string, string | null][] = [
    ['Awarded to', result.recipientName],
    ['Certificate', result.courseTitle ? `Course completion — ${result.courseTitle}` : CERTIFICATE_TYPE_LABELS[result.type]],
    ['Role', result.courseTitle ? null : result.programTitle],
    ['Team', result.departmentName],
    ['Issued by', result.organizationName],
    ['Period', period],
    ['Issued on', result.issuedAt ? formatCertificateDate(result.issuedAt) : null],
    ['Certificate number', result.number],
  ]

  return (
    <div className="grid gap-5">
      {result.valid ? (
        <div className="flex items-center gap-3 rounded-xl bg-success/12 p-4 text-success">
          <BadgeCheck className="size-8 shrink-0" aria-hidden />
          <div>
            <h1 className="text-h3">Valid certificate</h1>
            <p className="text-small">Issued by {result.organizationName} and not revoked.</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl bg-destructive/10 p-4 text-destructive">
          <CircleX className="size-8 shrink-0" aria-hidden />
          <div>
            <h1 className="text-h3">This certificate was revoked</h1>
            <p className="text-small">
              {result.organizationName} revoked it
              {result.revokedAt ? ` on ${formatCertificateDate(result.revokedAt)}` : ''}. It is no longer valid.
            </p>
          </div>
        </div>
      )}
      <dl className="divide-y rounded-lg border">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[10rem_1fr]">
              <dt className="text-caption text-muted-foreground">{label}</dt>
              <dd className="text-small font-medium">{value}</dd>
            </div>
          ))}
      </dl>
      <p className="text-center text-caption text-muted-foreground">
        Verification code <span className="font-mono">{result.code}</span> ·{' '}
        <Link href="/verify" className="text-primary hover:underline">
          Check another
        </Link>
      </p>
    </div>
  )
}
