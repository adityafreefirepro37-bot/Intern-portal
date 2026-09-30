import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { DocumentsPanel } from '@/features/interns/components/documents-panel'
import { firstParam } from '@/lib/validation/list-params'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { documentService, VISIBILITY_LABELS } from '@/server/services/document.service'
import { internService } from '@/server/services/intern.service'

export const metadata: Metadata = { title: 'Documents' }

/** An intern's own documents and required-document checklist. HR reviews at /hr/documents. */
export default async function DocumentsPage({ searchParams }: PageProps<'/documents'>) {
  const ctx = await requirePageContext()
  const internId = await internService.myInternId(ctx)
  if (!internId) {
    if (authorizationService.can(ctx, 'document.verify')) redirect('/hr/documents')
    return <AccessDenied what="documents" />
  }
  if (!authorizationService.can(ctx, 'document.read')) return <AccessDenied what="documents" />
  const data = await documentService.listForIntern(ctx, internId)
  return (
    <>
      <PageHeader
        title="Documents"
        description="Upload the documents HR needs. You’ll be notified when each one is verified or needs replacing."
      />
      <DocumentsPanel
        internId={internId}
        requirements={data.requirements}
        documents={data.documents}
        history={data.history}
        completion={data.completion}
        types={data.types}
        canUpload={data.canUpload}
        assignable={data.assignable}
        visibilityLabels={VISIBILITY_LABELS}
        timeZone={ctx.organization.timezone}
        highlight={firstParam(await searchParams, 'highlight')}
      />
    </>
  )
}
