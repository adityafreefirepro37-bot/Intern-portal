'use client'

import * as React from 'react'
import { Download, Eye, FileText, Trash2, Upload } from 'lucide-react'
import { ConfirmDialog } from '@/components/feedback/confirm-dialog'
import { useToast } from '@/components/feedback/toast'
import { EmptyState } from '@/components/common/states'
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
import { Field, FormMessage, SubmitButton } from '@/features/auth/components/form-bits'
import { formatDate, fullName } from '@/lib/utils'
import { deleteDocumentAction, uploadDocumentAction } from '@/server/actions/interns'
import { useRouter } from 'next/navigation'
import { useFormAction } from './use-form-action'

export interface DocumentView {
  id: string
  document_type: string
  file_name: string
  mime_type: string
  file_size: number
  visibility: string
  created_at: Date
  uploader: { first_name: string; last_name: string; display_name: string | null } | null
  canDelete: boolean
}

const PREVIEWABLE = new Set(['application/pdf', 'image/png', 'image/jpeg'])

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Documents for one intern — list filtered by visibility on the server; downloads go through /api/documents. */
export function DocumentsPanel({
  internId,
  documents,
  canUpload,
  assignable,
  typeLabels,
  visibilityLabels,
  timeZone,
}: {
  internId: string
  documents: DocumentView[]
  canUpload: boolean
  assignable: string[]
  typeLabels: Record<string, string>
  visibilityLabels: Record<string, string>
  timeZone: string
}) {
  const [uploading, setUploading] = React.useState(false)
  const [deleting, setDeleting] = React.useState<DocumentView | null>(null)
  const router = useRouter()
  const { toast } = useToast()

  return (
    <div className="space-y-4">
      {canUpload && (
        <div className="flex justify-end">
          <Button onClick={() => setUploading(true)}>
            <Upload aria-hidden /> Upload document
          </Button>
        </div>
      )}
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
            <li key={doc.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate font-medium">{doc.file_name}</p>
                  <p className="text-caption text-muted-foreground">
                    {typeLabels[doc.document_type] ?? doc.document_type} · {formatSize(doc.file_size)} ·{' '}
                    {formatDate(doc.created_at, timeZone)}
                    {doc.uploader && ` · ${fullName(doc.uploader)}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 pl-8 sm:pl-0">
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
                {doc.canDelete && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${doc.file_name}`}
                    onClick={() => setDeleting(doc)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {uploading && (
        <UploadDialog
          internId={internId}
          assignable={assignable}
          typeLabels={typeLabels}
          visibilityLabels={visibilityLabels}
          onClose={() => setUploading(false)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          title={`Delete ${deleting.file_name}?`}
          description="It disappears for everyone. If it completed an onboarding item, that item reopens."
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

function UploadDialog({
  internId,
  assignable,
  typeLabels,
  visibilityLabels,
  onClose,
}: {
  internId: string
  assignable: string[]
  typeLabels: Record<string, string>
  visibilityLabels: Record<string, string>
  onClose: () => void
}) {
  const [state, action] = useFormAction(uploadDocumentAction, { onSuccess: onClose })
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
          <DialogDescription>
            PDF, PNG, JPEG or DOCX. Files are stored privately and never get a public link.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="grid grid-cols-1 gap-4">
          <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
          <input type="hidden" name="internId" value={internId} />
          <Field label="Type" htmlFor="doc-type" error={state.fields?.documentType}>
            <select id="doc-type" name="documentType" defaultValue="OTHER" className={inputClassName}>
              {Object.entries(typeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
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
