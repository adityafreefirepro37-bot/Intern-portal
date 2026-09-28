import type { Metadata } from 'next'
import Link from 'next/link'
import { LayoutTemplate } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { NewTemplateButton } from '@/features/interns/components/template-editor'
import { pluralize } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { onboardingTemplateService } from '@/server/services/onboarding-template.service'

export const metadata: Metadata = { title: 'Onboarding templates' }

export default async function TemplatesPage() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'onboarding.manage')) return <AccessDenied what="onboarding templates" />
  const [templates, options] = await Promise.all([onboardingTemplateService.list(ctx), onboardingTemplateService.options(ctx)])

  return (
    <>
      <PageHeader
        title="Onboarding templates"
        description="Blueprints for new interns’ checklists. Each intern gets their own copy, so editing a template never changes existing checklists."
        breadcrumbs={[{ label: 'Onboarding', href: '/onboarding' }, { label: 'Templates' }]}
        actions={<NewTemplateButton options={options} />}
      />
      {templates.length === 0 ? (
        <EmptyState icon={LayoutTemplate} title="No templates yet" description="Create one to start onboarding interns." />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => (
            <li key={template.id}>
              <Card className="relative h-full space-y-3 p-5 transition-colors hover:border-ring/40">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/onboarding/templates/${template.id}`} className="font-medium after:absolute after:inset-0">
                    {template.name}
                  </Link>
                  {template.is_default && <Badge variant="primary">Default</Badge>}
                  {!template.is_active && <Badge variant="outline">Inactive</Badge>}
                </div>
                {template.description && <p className="line-clamp-2 text-small text-muted-foreground">{template.description}</p>}
                <p className="text-caption text-muted-foreground">
                  {pluralize(template._count.items, 'item')} · used {pluralize(template._count.onboardings, 'time')}
                  {template.department && ` · ${template.department.name}`}
                  {template.position && ` · ${template.position.title}`}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
