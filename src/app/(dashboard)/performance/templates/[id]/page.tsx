import type { Metadata } from 'next'
import { Lock } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { RatingScaleHelp } from '@/features/performance/components/review-forms'
import { DuplicateTemplateButton, ReviewQuestionDialog, SectionDialog, SetupRowActions, TemplateDialog } from '@/features/performance/components/setup-forms'
import { RESPONDENT_LABELS } from '@/lib/performance/rules'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { performanceReviewService } from '@/server/services/performance-review.service'

export const metadata: Metadata = { title: 'Review template' }

const TYPE_LABELS = { TEXT: 'Written', RATING: 'Rating 1–5', BOOLEAN: 'Yes / no', MULTI_SELECT: 'Choose several' } as const

export default async function TemplatePage({ params }: PageProps<'/performance/templates/[id]'>) {
  const ctx = await requirePageContext()
  if (authorizationService.scopeOf(ctx, 'performance_template.manage') !== 'ORGANIZATION') return <AccessDenied what="review templates" />
  const { id } = await params
  const { template, sections, locked } = await performanceReviewService.template(ctx, id)

  return (
    <>
      <PageHeader
        title={template.name}
        breadcrumbs={[
          { label: 'Performance', href: '/performance' },
          { label: 'Templates', href: '/performance/templates' },
          { label: template.name },
        ]}
        description={template.description ?? undefined}
        actions={
          <>
            {!template.is_active && <Badge variant="outline">Inactive</Badge>}
            <TemplateDialog template={template} />
            <DuplicateTemplateButton templateId={template.id} />
            {!locked && <SectionDialog templateId={template.id} />}
          </>
        }
      />
      {locked && (
        <p className="mb-4 flex items-center gap-2 rounded-md bg-muted p-3 text-small">
          <Lock className="size-4" aria-hidden /> Reviews already have answers for this template, so its sections and questions are locked. Duplicate it to make changes.
        </p>
      )}
      <div className="mb-6">
        <RatingScaleHelp />
      </div>
      <div className="space-y-4">
        {sections.map((section, index) => (
          <Card key={section.id} className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 flex-1 text-h3">{section.title}</h2>
              {section.respondents.map((r) => (
                <Badge key={r} variant={r === 'SELF' ? 'info' : 'neutral'}>
                  {RESPONDENT_LABELS[r]}
                </Badge>
              ))}
              {!locked && (
                <>
                  <SectionDialog templateId={template.id} section={section} />
                  <SetupRowActions kind="section" id={section.id} first={index === 0} last={index === sections.length - 1} name={section.title} />
                </>
              )}
            </div>
            {section.description && <p className="mt-1 text-small text-muted-foreground">{section.description}</p>}
            <ol className="mt-3 divide-y rounded-lg border">
              {section.questions.map((q, i) => (
                <li key={q.id} className="flex flex-wrap items-start gap-2 px-3 py-2.5 text-small">
                  <div className="min-w-0 flex-1">
                    <p>{q.prompt}</p>
                    <p className="text-caption text-muted-foreground">
                      {TYPE_LABELS[q.question_type]}
                      {q.options.length ? ` · ${q.options.join(', ')}` : ''}
                      {q.is_required ? ' · required' : ''}
                      {q.requires_evidence ? ' · evidence required' : ''}
                    </p>
                    {q.guidance && <p className="mt-1 text-caption">Good looks like: {q.guidance}</p>}
                  </div>
                  {!locked && (
                    <>
                      <ReviewQuestionDialog sectionId={section.id} question={q} />
                      <SetupRowActions kind="question" id={q.id} first={i === 0} last={i === section.questions.length - 1} name={q.prompt.slice(0, 40)} />
                    </>
                  )}
                </li>
              ))}
              {section.questions.length === 0 && <li className="px-3 py-2.5 text-small text-muted-foreground">No questions yet.</li>}
            </ol>
            {!locked && (
              <div className="mt-2">
                <ReviewQuestionDialog sectionId={section.id} />
              </div>
            )}
          </Card>
        ))}
        {sections.length === 0 && <p className="text-small text-muted-foreground">Add a section to start building this template.</p>}
      </div>
    </>
  )
}
