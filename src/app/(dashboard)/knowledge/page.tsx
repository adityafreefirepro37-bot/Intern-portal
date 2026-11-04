import type { Metadata } from 'next'
import Link from 'next/link'
import { BookOpen, Search } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, inputClassName } from '@/components/ui/input'
import { AddDocumentDialog, ProcessingWatcher } from '@/features/ai/components/knowledge-controls'
import { FILE_TYPE_LABELS, KNOWLEDGE_CATEGORIES, KNOWLEDGE_VISIBILITIES, STATUS_LABELS, VISIBILITY_LABELS } from '@/features/ai/components/knowledge-labels'
import { formatDay, humanizeEnum } from '@/lib/utils'
import { firstParam } from '@/lib/validation/list-params'
import { requirePageContext } from '@/server/context'
import { knowledgeService } from '@/server/ai/knowledge.service'
import { authorizationService } from '@/server/services/authorization.service'
import { organizationService } from '@/server/services/content.service'

export const metadata: Metadata = { title: 'Knowledge base' }

const categoryLabel = (c: string) => (c === 'HR' || c === 'SOP' ? c : humanizeEnum(c))
const STATUS_VARIANT = { READY: 'success', FAILED: 'destructive', PROCESSING: 'neutral', PENDING: 'neutral', ARCHIVED: 'outline' } as const

export default async function KnowledgePage({ searchParams }: PageProps<'/knowledge'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'knowledge.read')) return <AccessDenied what="the knowledge base" />

  const raw = await searchParams
  const query = {
    q: firstParam(raw, 'q') ?? '',
    category: firstParam(raw, 'category') ?? '',
    departmentId: firstParam(raw, 'department') ?? '',
    type: firstParam(raw, 'type') ?? '',
    visibility: firstParam(raw, 'visibility') ?? '',
    status: firstParam(raw, 'status') ?? '',
    updatedSince: firstParam(raw, 'updated') ?? '',
  }
  const manage = authorizationService.can(ctx, 'knowledge.manage')
  const [documents, options, departments] = await Promise.all([
    knowledgeService.list(ctx, query),
    manage ? knowledgeService.formOptions(ctx) : Promise.resolve(null),
    authorizationService.can(ctx, 'department.read') ? organizationService.listDepartments(ctx) : Promise.resolve([]),
  ])
  const rows = documents ?? []
  const processing = rows.some((d) => d.status === 'PENDING' || d.status === 'PROCESSING')
  const filtered = Boolean(query.q || query.category || query.departmentId || query.type || query.visibility || query.updatedSince || query.status)

  return (
    <>
      <ProcessingWatcher active={processing} />
      <PageHeader
        title="Knowledge base"
        description="Company handbooks, policies and SOPs. You see the documents you’re allowed to, and AYAVA AI cites them in its answers."
        actions={options ? <AddDocumentDialog options={options} /> : undefined}
      />

      <form action="/knowledge" role="search" className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto]">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input name="q" type="search" aria-label="Search knowledge" placeholder="Search knowledge…" defaultValue={query.q} className="pl-8" />
        </div>
        <select name="category" aria-label="Category" defaultValue={query.category} className={inputClassName}>
          <option value="">All categories</option>
          {KNOWLEDGE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
            </option>
          ))}
        </select>
        <select name="department" aria-label="Department" defaultValue={query.departmentId} className={inputClassName}>
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select name="type" aria-label="Document type" defaultValue={query.type} className={inputClassName}>
          <option value="">All types</option>
          {Object.entries(FILE_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
          <option value="TEXT">Typed text</option>
        </select>
        <Input name="updated" type="date" aria-label="Updated since" title="Updated since" defaultValue={query.updatedSince} />
        {manage && (
          <select name="visibility" aria-label="Visibility" defaultValue={query.visibility} className={inputClassName}>
            <option value="">All audiences</option>
            {KNOWLEDGE_VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {VISIBILITY_LABELS[v]}
              </option>
            ))}
          </select>
        )}
        {manage && (
          <select name="status" aria-label="Show" defaultValue={query.status} className={inputClassName}>
            <option value="">Active documents</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        )}
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={filtered ? 'No documents match' : 'No documents yet'}
          description={filtered ? 'Try a different search or fewer filters.' : manage ? 'Add a handbook or policy to get started.' : 'Documents shared with you will appear here.'}
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {rows.map((document) => (
            <li key={document.id}>
              <Card className="h-full p-4">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/knowledge/${document.id}`} className="min-w-0 font-medium underline-offset-2 hover:underline">
                    {document.title}
                  </Link>
                  {manage && (
                    <Badge variant={document.archived_at ? 'outline' : STATUS_VARIANT[document.status]} className="shrink-0">
                      {document.archived_at ? 'Archived' : STATUS_LABELS[document.status]}
                    </Badge>
                  )}
                </div>
                {document.description && <p className="mt-1 line-clamp-2 text-small text-muted-foreground">{document.description}</p>}
                {document.status === 'FAILED' && document.error_message && (
                  <p className="mt-1 text-caption text-destructive">{document.error_message}</p>
                )}
                <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
                  <Badge variant="neutral">{categoryLabel(document.category)}</Badge>
                  {document.version > 1 && <span>Version {document.version}</span>}
                  {document.mime_type && <span>{FILE_TYPE_LABELS[document.mime_type] ?? 'File'}</span>}
                  <span>Updated {formatDay(document.updated_at)}</span>
                  {manage && <span>· {document.department?.name ?? document.team?.name ?? document.role?.name ?? document.project?.name ?? VISIBILITY_LABELS[document.visibility]}</span>}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
