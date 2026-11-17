import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Download, ExternalLink } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CertificatePreview } from '@/features/certificates/components/certificate-preview'
import {
  CopyLinkButton,
  DeleteDraftButton,
  DraftEditor,
  IssueCertificateButton,
  RevokeCertificateButton,
} from '@/features/certificates/components/certificate-forms'
import { CERTIFICATE_TYPE_LABELS, formatCertificateDate, type CertificateTypeValue } from '@/lib/certificates/content'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { formatDateOnly } from '@/lib/interns/dates'
import { formatDate, fullName, humanizeEnum } from '@/lib/utils'
import { idSchema } from '@/lib/validation'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { certificateService, type CertificateView } from '@/server/services/certificate.service'

export const metadata: Metadata = { title: 'Certificate' }

export default async function CertificatePage({ params }: PageProps<'/certificates/[id]'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  if (!idSchema.safeParse(id).success) notFound()
  let c: CertificateView
  try {
    c = await certificateService.get(ctx, id)
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    if (error instanceof ForbiddenError) return <AccessDenied what="certificates" />
    throw error
  }
  const partnerLogos = await certificateService.partnerLogos(ctx)
  const tz = ctx.organization.timezone
  const isHr = Boolean(authorizationService.scopeOf(ctx, 'certificate.create'))
  const title = c.course ? `Course certificate — ${c.course.title}` : `${CERTIFICATE_TYPE_LABELS[c.certificate_type as CertificateTypeValue]} certificate`
  const canDownload = c.status !== 'REVOKED' || authorizationService.can(ctx, 'certificate.revoke')

  return (
    <>
      <PageHeader
        title={c.recipient_name || 'Certificate'}
        breadcrumbs={[{ label: isHr ? 'Certificates' : 'My certificates', href: '/certificates' }, { label: c.status === 'DRAFT' ? 'Draft' : c.certificate_number }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={c.status} label={humanizeEnum(c.status)} />
            {title}
            {c.issued_at && ` · Issued ${formatCertificateDate(c.issued_at)}`}
          </span>
        }
        actions={
          <>
            {canDownload && (
              <a href={`/api/certificates/${c.id}/pdf`} className={buttonVariants({ variant: c.status === 'ISSUED' ? 'default' : 'outline' })} download>
                <Download aria-hidden /> {c.status === 'DRAFT' ? 'Download draft PDF' : 'Download PDF'}
              </a>
            )}
            {c.canIssue && <IssueCertificateButton certificateId={c.id} recipientName={c.recipient_name} />}
            {c.canEdit && <DeleteDraftButton certificateId={c.id} />}
            {c.canRevoke && <RevokeCertificateButton certificateId={c.id} number={c.certificate_number} />}
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <CertificatePreview
            text={{
              type: c.certificate_type as CertificateTypeValue,
              recipientName: c.recipient_name,
              programTitle: c.program_title,
              departmentName: c.department_name,
              organizationName: c.organization_name,
              courseTitle: c.course?.title ?? null,
              periodStart: c.period_start,
              periodEnd: c.period_end,
              citation: c.citation,
            }}
            number={c.status === 'DRAFT' ? 'DRAFT' : c.certificate_number}
            issuedAt={c.issued_at}
            signatoryName={c.signatory_name}
            signatoryTitle={c.signatory_title}
            watermark={c.status === 'DRAFT' ? 'DRAFT' : c.status === 'REVOKED' ? 'REVOKED' : null}
            partnerLogos={partnerLogos}
            signatureUrl={c.hasSignature ? `/api/certificates/${c.id}/signature` : null}
          />
          {c.canEdit && (
            <Card>
              <CardHeader>
                <CardTitle>Edit before issuing</CardTitle>
                <p className="text-caption text-muted-foreground">Once issued, the text is frozen. The preview updates when you save.</p>
              </CardHeader>
              <CardContent>
                <DraftEditor
                  draft={{
                    id: c.id,
                    type: c.certificate_type,
                    recipientName: c.recipient_name,
                    programTitle: c.program_title,
                    departmentName: c.department_name,
                    periodStart: c.period_start ? formatDateOnly(c.period_start) : '',
                    periodEnd: c.period_end ? formatDateOnly(c.period_end) : '',
                    citation: c.citation,
                    signatoryName: c.signatory_name,
                    signatoryTitle: c.signatory_title,
                    isCourse: Boolean(c.course),
                    hasSignature: c.hasSignature,
                  }}
                />
              </CardContent>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          {c.status !== 'DRAFT' && (
            <Card>
              <CardHeader>
                <CardTitle>Verification</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-small">
                {c.status === 'REVOKED' ? (
                  <p>
                    Revoked {c.revoked_at && formatDate(c.revoked_at, tz)}
                    {c.revoker && ` by ${fullName(c.revoker)}`}. Anyone checking it sees that it is no longer valid.
                    {isHr && c.revoke_reason && <span className="mt-2 block text-muted-foreground">Reason: {c.revoke_reason}</span>}
                  </p>
                ) : (
                  <p>Anyone can confirm this certificate is genuine by scanning its QR code or opening the link.</p>
                )}
                {c.verificationCode && (
                  <p>
                    Code <span className="font-mono font-medium">{c.verificationCode}</span>
                  </p>
                )}
                {c.verificationUrl && (
                  <div className="flex flex-wrap gap-2">
                    <CopyLinkButton url={c.verificationUrl} label="Copy link" />
                    <a href={c.verificationUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'ghost' })}>
                      <ExternalLink aria-hidden /> Open
                    </a>
                  </div>
                )}
                {isHr && (
                  <p className="text-caption text-muted-foreground">
                    Checked {c.verificationCount} time{c.verificationCount === 1 ? '' : 's'}
                    {c.lastVerifiedAt && `, last ${formatDate(c.lastVerifiedAt, tz)}`}.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          {isHr && (
            <Card>
              <CardHeader>
                <CardTitle>Record</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-small">
                <p>
                  Intern:{' '}
                  <Link href={`/interns/${c.intern.id}`} className="font-medium text-primary hover:underline">
                    {c.recipient_name} ({c.intern.employee_code})
                  </Link>
                </p>
                {c.issuer && <p className="text-muted-foreground">Issued by {fullName(c.issuer)}</p>}
                {!c.issuer && c.status !== 'DRAFT' && c.course && <p className="text-muted-foreground">Issued automatically on course completion</p>}
                <p className="text-muted-foreground">Created {formatDate(c.created_at, tz)}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
