import type { Metadata } from 'next'
import { Award } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { PhasePlaceholder } from '@/components/common/phase-placeholder'
import { AccessDenied } from '@/components/common/states'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'

export const metadata: Metadata = { title: 'Certificates' }

export default async function Page() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'certificate.read')) return <AccessDenied what="certificates" />

  return (
    <>
      <PageHeader title="Certificates" />
      <PhasePlaceholder
        icon={Award}
        phase="08"
        title="Certificates"
        description="Completion and experience certificates with public verification."
        planned={[
          'Certificate generation from templates',
          'Unique certificate numbers and verification codes',
          'Public verification page',
          'Revocation',
        ]}
        foundation={[
          'certificates and certificate_verifications tables',
          'Unique certificate numbers enforced by the database',
          'certificate.create / verify / revoke permissions',
        ]}
      />
    </>
  )
}
