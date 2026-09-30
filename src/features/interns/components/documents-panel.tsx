'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Download, Eye, FileText, History, Trash2, Upload } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { EmptyState } from '@/components/common/states'
import { ConfirmDialog } from '@/components/feedback/confirm-dialog'
import { useToast } from '@/components/feedback/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input, inputClassName } from '@/components/ui/input'
import { Progress } from '@/components/ui/misc'
import { Field, FormMessage, SubmitButton } from '@/features/auth/components/form-bits'
import { DocumentReviewActions } from '@/features/hr/components/document-review'
import { DOCUMENT_STATUS_LABELS } from '@/lib/hr/documents'
import { cn, formatDate, formatDay, fullName } from '@/lib/utils'
import { deleteDocumentAction, uploadDocumentAction } from '@/server/actions/interns'
import { useFormAction } from './use-form-action'

type Person = { first_name: string; last_name: string; display_name: string | null }

export interface DocumentView {
  id: string
  document_type: string
  document_type_id: string | null
  typeName: string
  file_name: string
  mime_type: string
  file_size: number
  visibility: string
  status: keyof typeof DOCUMENT_STATUS_LABELS
  version: number
  expires_at: Date | null
  rejection_reason: string | null
  verified_at: Date | null
  notes: string | null
  created_at: Date
  uploader: Person | null
  verifier: Person | null
  type: { is_sensitive: boolean } | null
  canDelete: boolean
  canVerify: boolean
}

export interface DocumentTypeOption {
  id: string
  name: string
  has_expiry: boolean
  is_sensitive: boolean
  is_required: boolean
}

export interface Requirement {
  type: DocumentTypeOption
  document: DocumentView | null
  status: keyof typeof DOCUMENT_STATUS_LABELS
}

const PREVIEWABLE = new Set(['application/pdf', 'image/png', 'image/jpeg'])

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * One intern's documents: required-document checklist with completion,
 * current documents (with review status and versions) and earlier versions.
 * The list is filtered on the server by visibility and sensitivity; downloads
 * go through /api/documents (authorized per request).
 */
export function DocumentsPanel({
  internId,
  requirements,
  documents,
  history,
  completion,
  types,
  canUpload,
  assignable,
  visibilityLabels,
  timeZone,
  highlight,
}: {
  internId: string
  requirements: Requirement[]
  documents: DocumentView[]
  history: DocumentView[]
  completion: { required: number; verified: number; percent: number; missing: number }
  types: DocumentTypeOption[]
  canUpload: boolean
  assignable: string[]
  visibilityLabels: Record<string, string>
  timeZone: string
  highlight?: string
}) {
  const [uploading, setUploading] = React.useState<{ typeId?: string } | null>(null)
  const [deleting, setDeleting] = React.useState<DocumentView | null>(null)
  const router = useRouter()
  const { toast } = useToast()

  return (
    <div className="space-y-6">
      {requirements.length > 0 && (
        <section aria-labelledby="req-title" className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id="req-title" className="text-label">
              Required documents
            </h3>
            <div className="w-full max-w-xs space-y-1 sm:w-64">
              <Progress value={completion.percent} label={`${completion.percent}% of required documents verified`} />
              <p className="text-caption text-muted-foreground">
                {completion.verified} of {completion.required} verified
                {completion.missing > 0 && ` · ${completion.missing} missing`}
              </p>
            </div>
          </div>
          <ul className="divide-y">
            {requirements.map((req) => (
              <li key={req.type.id} className="flex flex-wrap items-center gap-3 py-2 text-small">
                <span className="min-w-0 flex-1 font-medium">{req.type.name}</span>
                <StatusBadge status={req.status} label={DOCUMENT_STATUS_LABELS[req.status]} />
                {canUpload && ['REQUIRED', 'REJECTED', 'EXPIRED'].includes(req.status) && (
                  <Button size="sm" variant="outline" onClick={() => setUploading({ typeId: req.type.id })}>
                    <Upload aria-hidden /> {req.status === 'REQUIRED' ? 'Upload' : 'Upload new version'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex items-center justify-between gap-3">
        <h3 className="text-label">Documents</h3>
        {canUpload && (
          <Button onClick={() => setUploading({})}>
            <Upload aria-hidden /> Upload document
          </Button>
        )}
      </div>
      {documents.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No documents"
          description="Uploaded documents you’re allowed to see appear here."
          compact
        />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {documents.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              timeZone={timeZone}
              visibilityLabels={visibilityLabels}
              highlighted={highlight === doc.id}
              onDelete={() => setDeleting(doc)}
              onReplace={
                canUpload && doc.document_type_id ? () => setUploading({ typeId: doc.document_type_id! }) : undefined
              }
            />
          ))}
        </ul>
      )}

      {history.length > 0 && (
        <details className="rounded-xl border bg-card">
          <summary className="flex cursor-pointer items-center gap-2 p-4 text-label">
            <History className="size-4" aria-hidden /> Earlier versions ({history.length})
          </summary>
          <ul className="divide-y border-t">
            {history.map((doc) => (
              <DocumentRow key={doc.id} doc={doc} timeZone={timeZone} visibilityLabels={visibilityLabels} />
            ))}
          </ul>
        </details>
      )}

      {uploading && (
        <UploadDialog
          internId={internId}
          types={types}
          initialTypeId={uploading.typeId}
          assignable={assignable}
          visibilityLabels={visibilityLabels}
          onClose={() => setUploading(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title={`Delete ${deleting.file_name}?`}
          description="It disappears for everyone; the previous version (if any) becomes current again. If it completed an onboarding item, that item reopens."
          confirmLabel="Delete"
          destructive
          onConfirm={async () => {
            const formData = new FormData()
            formData.set('documentId', deleting.id)
            const result = await deleteDocumentAction({ status: 'idle' }, formData)
            toast({ title: result.message ?? 'Done', variant: result.status === 'error' ? 'error' : 'success' })
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

function DocumentRow({
  doc,
  timeZone,
  visibilityLabels,
  highlighted,
  onDelete,
  onReplace,
}: {
  doc: DocumentView
  timeZone: string
  visibilityLabels: Record<string, string>
  highlighted?: boolean
  onDelete?: () => void
  onReplace?: () => void
}) {
  return (
    <li
      id={`document-${doc.id}`}
      className={cn('flex flex-col gap-3 p-4 lg:flex-row lg:items-start', highlighted && 'bg-primary/5')}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 space-y-0.5">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{doc.typeName}</span>
            {doc.version > 1 && <span className="text-caption text-muted-foreground">v{doc.version}</span>}
            {doc.type?.is_sensitive && <Badge variant="outline">Sensitive</Badge>}
          </p>
          <p className="truncate text-small">{doc.file_name}</p>
          <p className="text-caption text-muted-foreground">
            {formatSize(doc.file_size)} · {formatDate(doc.created_at, timeZone)}
            {doc.uploader && ` · ${fullName(doc.uploader)}`}
            {doc.expires_at && ` · Expires ${formatDay(doc.expires_at)}`}
          </p>
          {doc.status === 'VERIFIED' && doc.verifier && (
            <p className="text-caption text-muted-foreground">
              Verified by {fullName(doc.verifier)} {doc.verified_at && `on ${formatDate(doc.verified_at, timeZone)}`}
            </p>
          )}
          {doc.rejection_reason && doc.status === 'REJECTED' && (
            <p className="text-caption text-destructive">Reason: {doc.rejection_reason}</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-8 lg:pl-0">
        <StatusBadge status={doc.status} label={DOCUMENT_STATUS_LABELS[doc.status]} />
        <Badge variant="outline">{visibilityLabels[doc.visibility] ?? doc.visibility}</Badge>
        {PREVIEWABLE.has(doc.mime_type) && (
          <a
            href={`/api/documents/${doc.id}?inline=1`}
            target="_blank"
            rel="noopener"
            aria-label={`View ${doc.file_name}`}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Eye className="size-4" aria-hidden />
          </a>
        )}
        <a
          href={`/api/documents/${doc.id}`}
          aria-label={`Download ${doc.file_name}`}
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Download className="size-4" aria-hidden />
        </a>
        {doc.canVerify && onDelete && (
          <DocumentReviewActions documentId={doc.id} status={doc.status} name={doc.typeName} />
        )}
        {onReplace && ['REJECTED', 'EXPIRED'].includes(doc.status) && (
          <Button size="sm" variant="outline" onClick={onReplace}>
            <Upload aria-hidden /> New version
          </Button>
        )}
        {doc.canDelete && onDelete && (
          <Button variant="ghost" size="icon-sm" aria-label={`Delete ${doc.file_name}`} onClick={onDelete}>
            <Trash2 aria-hidden />
          </Button>
        )}
      </div>
    </li>
  )
}

function UploadDialog({
  internId,
  types,
  initialTypeId,
  assignable,
  visibilityLabels,
  onClose,
}: {
  internId: string
  types: DocumentTypeOption[]
  initialTypeId?: string
  assignable: string[]
  visibilityLabels: Record<string, string>
  onClose: () => void
}) {
  const [state, action] = useFormAction(uploadDocumentAction, { onSuccess: onClose })
  const [typeId, setTypeId] = React.useState(initialTypeId ?? types[0]?.id ?? '')
  const type = types.find((t) => t.id === typeId)
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
          <DialogDescription>
            PDF, PNG, JPEG or DOCX. Files are stored privately and never get a public link. Uploading a type that
            already has a document adds a new version; earlier versions are kept.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="grid grid-cols-1 gap-4">
          <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
          <input type="hidden" name="internId" value={internId} />
          <Field label="Type" htmlFor="doc-type" error={state.fields?.documentTypeId}>
            <select
              id="doc-type"
              name="documentTypeId"
              value={typeId}
              onChange={(event) => setTypeId(event.target.value)}
              className={inputClassName}
            >
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.is_required ? ' (required)' : ''}
                </option>
              ))}
            </select>
          </Field>
          {type?.has_expiry && (
            <Field label="Expiry date" htmlFor="doc-expiry" error={state.fields?.expiresAt}>
              <Input id="doc-expiry" name="expiresAt" type="date" />
            </Field>
          )}
          {assignable.length > 0 && (
            <Field label="Who can see it" htmlFor="doc-visibility" error={state.fields?.visibility}>
              <select
                id="doc-visibility"
                name="visibility"
                defaultValue={assignable.includes('HR') ? 'HR' : 'MANAGER'}
                className={inputClassName}
              >
                {assignable.map((value) => (
                  <option key={value} value={value}>
                    {visibilityLabels[value] ?? value}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Note (optional)" htmlFor="doc-notes" error={state.fields?.notes}>
            <Input id="doc-notes" name="notes" maxLength={500} />
          </Field>
          <Field label="File" htmlFor="doc-file" error={state.fields?.file}>
            <Input id="doc-file" name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.docx" />
          </Field>
          <DialogFooter>
            <SubmitButton pendingLabel="Uploading…">Upload</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
