import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TemplateItems, TemplateSettingsForm } from '@/features/interns/components/template-editor'
import { NotFoundError } from '@/lib/errors'
import { idSchema } from '@/lib/validation'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { DOCUMENT_TYPE_LABELS } from '@/server/services/document.service'
import { ITEM_TYPE_LABELS, ONBOARDING_ITEM_TYPES, onboardingTemplateService } from '@/server/services/onboarding-template.service'

export const metadata: Metadata = { title: 'Edit template' }

export default async function TemplatePage({ params }: PageProps<'/onboarding/templates/[id]'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'onboarding.manage')) return <AccessDenied what="onboarding templates" />
  const { id } = await params
  if (!idSchema.safeParse(id).success) notFound()

  let template: Awaited<ReturnType<typeof onboardingTemplateService.get>>
  try {
    template = await onboardingTemplateService.get(ctx, id)
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    throw error
  }
  const options = await onboardingTemplateService.options(ctx)
  const itemOptions = {
    ...options,
    itemTypes: ONBOARDING_ITEM_TYPES.map((value) => ({ value, label: ITEM_TYPE_LABELS[value] })),
    documentTypes: Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => ({ value, label })),
  }

  return (
    <>
      <PageHeader
        title={template.name}
        breadcrumbs={[
          { label: 'Onboarding', href: '/onboarding' },
          { label: 'Templates', href: '/onboarding/templates' },
          { label: template.name },
        ]}
      />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
          </CardHeader>
          <CardContent>
            <TemplateSettingsForm template={template} options={options} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Checklist items</CardTitle>
            <CardDescription>Due dates are counted from each intern’s start date.</CardDescription>
          </CardHeader>
          <CardContent>
            <TemplateItems template={template} options={itemOptions} />
          </CardContent>
        </Card>
      </div>
    </>
  )
}
