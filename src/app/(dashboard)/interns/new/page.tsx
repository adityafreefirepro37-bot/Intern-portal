import type { Metadata } from 'next'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { CreateInternForm } from '@/features/interns/components/intern-form'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { internService } from '@/server/services/intern.service'

export const metadata: Metadata = { title: 'Add intern' }

export default async function NewInternPage() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'intern.create')) return <AccessDenied what="adding interns" />
  const options = await internService.formOptions(ctx)

  return (
    <>
      <PageHeader
        title="Add intern"
        description="Creates their account, profile, internship and (optionally) onboarding checklist in one step."
        breadcrumbs={[{ label: 'Interns', href: '/interns' }, { label: 'Add intern' }]}
      />
      <CreateInternForm options={options} canInvite={authorizationService.can(ctx, 'user.invite')} />
    </>
  )
}
