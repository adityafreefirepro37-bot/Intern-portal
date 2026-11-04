import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Download, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AskAyava } from '@/features/ai/components/ask-ayava'
import { DocumentActions, EditDocumentDialog, NewVersionDialog, ProcessingWatcher } from '@/features/ai/components/knowledge-controls'
import { STATUS_LABELS, VISIBILITY_LABELS } from '@/features/ai/components/knowledge-labels'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { formatDay, fullName, humanizeEnum } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { knowledgeService } from '@/server/ai/knowledge.service'
import { aiOffered, CONTEXT_PROMPTS } from '@/server/ai/suggestions'

export const metadata: Metadata = { title: 'Knowledge document' }

export default async function KnowledgeDocumentPage({ params }: PageProps<'/knowledge/[id]'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  let view: Awaited<ReturnType<typeof knowledgeService.get>>
  try {
    view = await knowledgeService.get(ctx, id)
  } catch (error) {
    // Hidden, missing and malformed look the same.
    if (error instanceof NotFoundError || error instanceof ValidationError) notFound()
    throw error
  }
  const { document, versions, can } = view
  const options = can.manage ? await knowledgeService.formOptions(ctx) : null
  const category = document.category === 'HR' || document.category === 'SOP' ? document.category : humanizeEnum(document.category)
  const updater = document.updater ?? document.uploader
  const audience = document.department?.name ?? document.team?.name ?? document.role?.name ?? document.project?.name

  return (
    <>
      <ProcessingWatcher active={document.status === 'PENDING' || document.status === 'PROCESSING'} />
      <PageHeader
        title={document.title}
        breadcrumbs={[{ label: 'Knowledge base', href: '/knowledge' }, { label: document.title }]}
        description={document.description ?? undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            {aiOffered(ctx) && document.status === 'READY' && (
              <AskAyava contextType="DOCUMENT" contextId={document.id} label={document.title} suggestions={CONTEXT_PROMPTS.DOCUMENT ?? []} />
            )}
            {document.storage_path && (
              <Button asChild variant="outline">
                <a href={`/api/knowledge/${document.id}`}>
                  <Download aria-hidden /> Download
                </a>
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
        <Badge variant="neutral">{category}</Badge>
        <span>Version {document.version}</span>
        {document.effective_date && <span>· Effective {formatDay(document.effective_date)}</span>}
        <span>· Updated {formatDay(document.updated_at)}{updater ? ` by ${fullName(updater)}` : ''}</span>
        {can.manage && (
          <>
            <span>· {audience ? `${VISIBILITY_LABELS[document.visibility]}: ${audience}` : VISIBILITY_LABELS[document.visibility]}</span>
            <Badge variant={document.status === 'FAILED' ? 'destructive' : document.status === 'READY' ? 'success' : 'neutral'}>
              {document.archived_at ? 'Archived' : STATUS_LABELS[document.status]}
            </Badge>
            {document.status === 'READY' && (
              <span>
                · {document.chunk_count} sections · {document.embedding_model ? 'semantic + keyword search' : 'keyword search only'}
              </span>
            )}
          </>
        )}
      </div>

      {can.manage && options && (
        <div className="mb-4 flex flex-wrap gap-2">
          <EditDocumentDialog
            options={options}
            document={{
              id: document.id,
              title: document.title,
              description: document.description,
              category: document.category,
              visibility: document.visibility,
              department_id: document.department_id,
              team_id: document.team_id,
              role_id: document.role_id,
              project_id: document.project_id,
              effective_date: document.effective_date?.toISOString().slice(0, 10) ?? null,
            }}
          />
          <NewVersionDialog documentId={document.id} title={document.title} />
          <DocumentActions id={document.id} title={document.title} archived={Boolean(document.archived_at)} />
        </div>
      )}

      {document.error_message && (
        <p role="alert" className={`mb-4 flex items-start gap-2 rounded-lg px-3 py-2 text-small ${document.status === 'FAILED' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'}`}>
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {document.error_message}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <Card>
          <CardContent className="pt-6">
            {document.content ? (
              <div className="max-h-[70vh] overflow-y-auto whitespace-pre-wrap text-small leading-relaxed [overflow-wrap:anywhere]" tabIndex={0}>
                {document.content}
              </div>
            ) : (
              <p className="text-small text-muted-foreground">
                {document.status === 'PROCESSING' || document.status === 'PENDING' ? 'Processing this document…' : 'No text is available for this document.'}
              </p>
            )}
          </CardContent>
        </Card>
        {versions.length > 1 && (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Versions</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-1.5 text-small">
                {versions.map((version) => (
                  <li key={version.id} className="flex items-center justify-between gap-2">
                    <Link href={`/knowledge/${version.id}`} aria-current={version.id === document.id ? 'page' : undefined} className="underline-offset-2 hover:underline">
                      Version {version.version}
                    </Link>
                    <span className="text-caption text-muted-foreground">
                      {version.is_current ? 'Current' : STATUS_LABELS[version.status]} · {formatDay(version.created_at)}
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}
