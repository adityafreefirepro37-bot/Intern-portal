import type { Metadata } from 'next'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { RelatedInternGrid } from '@/features/interns/components/related-interns'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { internService } from '@/server/services/intern.service'

export const metadata: Metadata = { title: 'My Interns' }

/** Interns the signed-in user manages (manager_id = me). */
export default async function MyInternsPage() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'intern.read')) return <AccessDenied what="interns" />
  const interns = await internService.related(ctx, 'managed')
  return (
    <>
      <PageHeader title="My Interns" description="Interns you manage — their progress and onboarding at a glance." />
      <RelatedInternGrid interns={interns} relation="managed" />
    </>
  )
}
