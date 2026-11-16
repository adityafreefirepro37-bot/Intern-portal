import Link from 'next/link'
import { Award, Download } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { EmptyState } from '@/components/common/states'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CERTIFICATE_TYPE_LABELS, formatCertificateDate, type CertificateTypeValue } from '@/lib/certificates/content'
import { humanizeEnum } from '@/lib/utils'
import type { RequestContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { certificateService } from '@/server/services/certificate.service'
import { NewCertificate } from './certificate-forms'

/** An intern's certificates on their profile (HR prepares new ones here too). */
export async function CertificatesTab({ ctx, internId }: { ctx: RequestContext; internId: string }) {
  const certificates = await certificateService.forIntern(ctx, internId)
  const canCreate = Boolean(authorizationService.scopeOf(ctx, 'certificate.create'))
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>Certificates</CardTitle>
        {canCreate && <NewCertificate interns={[]} internId={internId} label="Prepare certificate" size="sm" variant="outline" />}
      </CardHeader>
      <CardContent>
        {certificates.length === 0 ? (
          <EmptyState icon={Award} title="No certificates" description="Issued certificates and course certificates appear here." compact />
        ) : (
          <ul className="divide-y">
            {certificates.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <Link href={`/certificates/${c.id}`} className="font-medium hover:underline">
                    {c.course ? `Course: ${c.course.title}` : `${CERTIFICATE_TYPE_LABELS[c.certificate_type as CertificateTypeValue]} certificate`}
                  </Link>
                  <p className="text-caption text-muted-foreground">
                    {c.status === 'DRAFT' ? 'Draft' : c.certificate_number}
                    {c.issued_at && ` · Issued ${formatCertificateDate(c.issued_at)}`}
                  </p>
                </div>
                <StatusBadge status={c.status} label={humanizeEnum(c.status)} />
                {c.status === 'ISSUED' && (
                  <a href={`/api/certificates/${c.id}/pdf`} className={buttonVariants({ variant: 'ghost', size: 'sm' })} download>
                    <Download aria-hidden /> PDF
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
