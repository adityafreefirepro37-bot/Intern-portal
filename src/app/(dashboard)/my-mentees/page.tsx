import type { Metadata } from 'next'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { RelatedInternGrid } from '@/features/interns/components/related-interns'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { internService } from '@/server/services/intern.service'

export const metadata: Metadata = { title: 'My Mentees' }

/** Interns the signed-in user mentors (mentor_id = me). */
export default async function MyMenteesPage() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'intern.read')) return <AccessDenied what="interns" />
  const interns = await internService.related(ctx, 'mentored')
  return (
    <>
      <PageHeader title="My Mentees" description="Interns you mentor — their progress and onboarding at a glance." />
      <RelatedInternGrid interns={interns} relation="mentored" />
    </>
  )
}
