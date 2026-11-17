import type { Metadata } from 'next'
import Link from 'next/link'
import { Award, Download } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { inputClassName } from '@/components/ui/input'
import { CertificateSettingsForm, CopyLinkButton, NewCertificate } from '@/features/certificates/components/certificate-forms'
import { SignatureUpload } from '@/features/certificates/components/signature-upload'
import { SubTabs } from '@/features/hr/components/hr-nav'
import { CERTIFICATE_TYPE_LABELS, CERTIFICATE_TYPES, formatCertificateDate, type CertificateTypeValue } from '@/lib/certificates/content'
import { cn, formatDate, humanizeEnum } from '@/lib/utils'
import { firstParam } from '@/lib/validation/list-params'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { certificateService, type CertificateView } from '@/server/services/certificate.service'

export const metadata: Metadata = { title: 'Certificates' }

function typeLabel(c: CertificateView) {
  return c.course ? `Course: ${c.course.title}` : CERTIFICATE_TYPE_LABELS[c.certificate_type as CertificateTypeValue]
}

/**
 * HR: every certificate (filters), who is due one, and settings.
 * Interns: their own issued certificates with download and verification link.
 */
export default async function CertificatesPage({ searchParams }: PageProps<'/certificates'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'certificate.read')) return <AccessDenied what="certificates" />
  const params = await searchParams
  const canCreate = Boolean(authorizationService.scopeOf(ctx, 'certificate.create'))
  const tz = ctx.organization.timezone

  if (!canCreate) {
    const mine = await certificateService.mine(ctx)
    return (
      <>
        <PageHeader title="My certificates" description="Download your certificates and share their verification links." />
        {mine.length === 0 ? (
          <EmptyState
            icon={Award}
            title="No certificates yet"
            description="Certificates appear here when HR issues them, or when you complete a course."
          />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {mine.map((c) => (
              <li key={c.id}>
                <Card className="h-full">
                  <CardContent className="flex h-full flex-col gap-3 p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Award className="size-5 text-primary" aria-hidden />
                      <Link href={`/certificates/${c.id}`} className="text-h3 hover:underline">
                        {typeLabel(c)}
                      </Link>
                      {c.status === 'REVOKED' && <Badge variant="destructive">Revoked</Badge>}
                    </div>
                    <p className="text-small text-muted-foreground">
                      {c.certificate_number}
                      {c.issued_at && ` · Issued ${formatCertificateDate(c.issued_at)}`}
                    </p>
                    {c.status === 'ISSUED' && (
                      <div className="mt-auto flex flex-wrap gap-2">
                        <a href={`/api/certificates/${c.id}/pdf`} className={buttonVariants({ size: 'sm' })} download>
                          <Download aria-hidden /> Download PDF
                        </a>
                        {c.verificationUrl && <CopyLinkButton url={c.verificationUrl} />}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </>
    )
  }

  const view = (['ready', 'settings'] as const).find((v) => v === firstParam(params, 'view')) ?? 'all'
  const filters = { status: firstParam(params, 'status'), type: firstParam(params, 'type'), q: firstParam(params, 'q') }
  const [list, counts, candidates, interns, settings] = await Promise.all([
    view === 'all' ? certificateService.list(ctx, filters) : Promise.resolve([]),
    certificateService.counts(ctx),
    certificateService.candidates(ctx),
    certificateService.internOptions(ctx),
    view === 'settings' ? certificateService.settings(ctx) : Promise.resolve(null),
  ])

  return (
    <>
      <PageHeader
        title="Certificates"
        description="Prepare, issue and revoke certificates. Each issued certificate has a public verification link."
        actions={<NewCertificate interns={interns} />}
      />
      <SubTabs
        label="Certificate views"
        active={view}
        items={[
          { key: 'all', href: '/certificates', label: 'All certificates', count: counts.DRAFT + counts.ISSUED + counts.REVOKED },
          { key: 'ready', href: '/certificates?view=ready', label: 'Ready to issue', count: candidates.length },
          { key: 'settings', href: '/certificates?view=settings', label: 'Settings' },
        ]}
      />

      {view === 'settings' && settings && (
        <Card>
          <CardHeader>
            <CardTitle>Certificate settings</CardTitle>
          </CardHeader>
          <CardContent className="grid max-w-xl gap-6">
            <CertificateSettingsForm settings={settings} />
            <SignatureUpload hasSignature={Boolean(settings.signaturePath)} signatoryName={settings.signatoryName} />
          </CardContent>
        </Card>
      )}

      {view === 'ready' &&
        (candidates.length === 0 ? (
          <EmptyState
            icon={Award}
            title="Everyone’s covered"
            description="Interns who have completed (or end within 30 days) without a completion or experience certificate appear here."
          />
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {candidates.map((c) => (
              <li key={c.internId} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <Link href={`/interns/${c.internId}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                  <p className="text-caption text-muted-foreground">
                    {[c.position, c.department].filter(Boolean).join(' · ')}
                    {c.endDate && ` · ${c.status === 'COMPLETED' || c.status === 'ALUMNI' ? 'Ended' : 'Ends'} ${formatDate(c.endDate, tz)}`}
                  </p>
                </div>
                <StatusBadge status={c.status} label={humanizeEnum(c.status)} />
                <NewCertificate interns={[]} internId={c.internId} internName={c.name} label="Prepare" size="sm" variant="outline" />
              </li>
            ))}
          </ul>
        ))}

      {view === 'all' && (
        <>
          <form className="mb-4 flex flex-wrap gap-2" role="search">
            <input
              type="search"
              name="q"
              defaultValue={filters.q ?? ''}
              placeholder="Search name, number or role…"
              aria-label="Search certificates"
              className={cn(inputClassName, 'w-64')}
            />
            <select name="status" defaultValue={filters.status ?? ''} aria-label="Status" className={cn(inputClassName, 'w-36')}>
              <option value="">Any status</option>
              <option value="DRAFT">Draft ({counts.DRAFT})</option>
              <option value="ISSUED">Issued ({counts.ISSUED})</option>
              <option value="REVOKED">Revoked ({counts.REVOKED})</option>
            </select>
            <select name="type" defaultValue={filters.type ?? ''} aria-label="Type" className={cn(inputClassName, 'w-40')}>
              <option value="">Any type</option>
              {CERTIFICATE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CERTIFICATE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <button type="submit" className={buttonVariants({ variant: 'outline' })}>
              Filter
            </button>
          </form>
          {list.length === 0 ? (
            <EmptyState
              icon={Award}
              title="No certificates"
              description="Prepare one with “New certificate”, or from “Ready to issue”."
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full text-small">
                <thead className="border-b bg-muted/50 text-left text-caption text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">Recipient</th>
                    <th scope="col" className="px-4 py-2 font-medium">Certificate</th>
                    <th scope="col" className="px-4 py-2 font-medium">Number</th>
                    <th scope="col" className="px-4 py-2 font-medium">Status</th>
                    <th scope="col" className="px-4 py-2 font-medium">Issued</th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">Checks</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {list.map((c) => (
                    <tr key={c.id} className="hover:bg-accent/40">
                      <td className="px-4 py-2.5">
                        <Link href={`/certificates/${c.id}`} className="font-medium hover:underline">
                          {c.recipient_name}
                        </Link>
                        {c.program_title && !c.course && <span className="block text-caption text-muted-foreground">{c.program_title}</span>}
                      </td>
                      <td className="px-4 py-2.5">{typeLabel(c)}</td>
                      <td className="px-4 py-2.5 font-mono text-caption">{c.status === 'DRAFT' ? '—' : c.certificate_number}</td>
                      <td className="px-4 py-2.5">
                        <StatusBadge status={c.status} label={humanizeEnum(c.status)} />
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{c.issued_at ? formatDate(c.issued_at, tz) : '—'}</td>
                      <td className="tabular px-4 py-2.5 text-right text-muted-foreground">{c.verificationCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  )
}
