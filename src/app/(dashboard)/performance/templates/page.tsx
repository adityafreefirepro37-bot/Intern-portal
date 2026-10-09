import type { Metadata } from 'next'
import Link from 'next/link'
import { FileText } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { DataTable } from '@/components/tables/data-table'
import { Badge } from '@/components/ui/badge'
import { TemplateDialog } from '@/features/performance/components/setup-forms'
import { formatDay } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { performanceReviewService } from '@/server/services/performance-review.service'

export const metadata: Metadata = { title: 'Review templates' }

export default async function TemplatesPage() {
  const ctx = await requirePageContext()
  if (authorizationService.scopeOf(ctx, 'performance_template.manage') !== 'ORGANIZATION') return <AccessDenied what="review templates" />
  const templates = await performanceReviewService.templates(ctx)
  return (
    <>
      <PageHeader
        title="Review templates"
        breadcrumbs={[{ label: 'Performance', href: '/performance' }, { label: 'Templates' }]}
        description="Sections and questions used by reviews. Templates in use are locked — duplicate one to change it."
        actions={<TemplateDialog />}
      />
      <DataTable
        caption="Review templates"
        rows={templates}
        getRowId={(t) => t.id}
        empty={<EmptyState icon={FileText} title="No templates yet" description="Create a template with sections and questions." />}
        columns={[
          {
            key: 'name',
            header: 'Template',
            cell: (t) => (
              <Link href={`/performance/templates/${t.id}`} className="font-medium hover:underline">
                {t.name}
              </Link>
            ),
          },
          { key: 'active', header: 'Status', cell: (t) => (t.is_active ? <Badge variant="success">Active</Badge> : <Badge variant="outline">Inactive</Badge>) },
          { key: 'sections', header: 'Sections', cell: (t) => t._count.sections, align: 'right', hideBelow: 'sm' },
          { key: 'reviews', header: 'Reviews', cell: (t) => t._count.reviews, align: 'right' },
          { key: 'updated', header: 'Updated', cell: (t) => formatDay(t.updated_at), hideBelow: 'md' },
        ]}
      />
    </>
  )
}
