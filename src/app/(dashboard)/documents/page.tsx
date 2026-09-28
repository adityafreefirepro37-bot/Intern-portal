import type { Metadata } from 'next'
import { FileText } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { PhasePlaceholder } from '@/components/common/phase-placeholder'
import { AccessDenied } from '@/components/common/states'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'

export const metadata: Metadata = { title: 'Documents' }

export default async function Page() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'document.read')) return <AccessDenied what="documents" />

  return (
    <>
      <PageHeader title="Documents" />
      <PhasePlaceholder
        icon={FileText}
        phase="05"
        title="Documents"
        description="Offer letters, NDAs, IDs and certificates, stored securely."
        planned={[
          'Upload with type and visibility (intern, manager, HR, admin)',
          'Signed, time-limited download links',
          'Per-intern document checklist',
          'Retention and deletion controls',
        ]}
        foundation={[
          'internship_documents table with visibility',
          'Storage service with type, signature and size validation',
          'Local and Supabase storage providers',
        ]}
      />
    </>
  )
}
