'use client'

import * as React from 'react'
import {
  Ban,
  CheckCircle2,
  Circle,
  CircleDashed,
  FileCheck2,
  FileText,
  MoreHorizontal,
  OctagonAlert,
  RotateCcw,
  SkipForward,
  Play,
} from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input, Textarea } from '@/components/ui/input'
import { Field, FormMessage, SubmitButton } from '@/features/auth/components/form-bits'
import { cn, formatDay, fullName, humanizeEnum } from '@/lib/utils'
import {
  acknowledgePolicyAction,
  completeOnboardingItemAction,
  setOnboardingItemStatusAction,
  uploadDocumentAction,
} from '@/server/actions/interns'
import { useFormAction } from './use-form-action'

type Person = { first_name: string; last_name: string; display_name: string | null }

export interface ChecklistItemView {
  id: string
  title: string
  description: string | null
  item_type: string
  required: boolean
  status: string
  due_date: Date | null
  assigned_role: string
  completed_at: Date | null
  blocked_reason: string | null
  required_document_type: string | null
  assignee: (Person & { id: string }) | null
  completer: Person | null
  policy: { id: string; title: string; version: number; body: string } | null
  document: { id: string; file_name: string; deleted_at: Date | null } | null
  overdue: boolean
  canComplete: boolean
  canManage: boolean
  acknowledged: boolean
}

const DONE = new Set(['COMPLETED', 'SKIPPED'])

function StatusIcon({ item }: { item: ChecklistItemView }) {
  if (item.status === 'COMPLETED') return <CheckCircle2 className="size-5 text-success" aria-hidden />
  if (item.status === 'SKIPPED') return <SkipForward className="size-5 text-muted-foreground" aria-hidden />
  if (item.status === 'BLOCKED') return <Ban className="size-5 text-destructive" aria-hidden />
  if (item.status === 'IN_PROGRESS') return <CircleDashed className="size-5 text-primary" aria-hidden />
  return <Circle className="size-5 text-muted-foreground" aria-hidden />
}

/**
 * An intern's onboarding checklist. Buttons reflect the per-item permissions
 * the server computed; every action is authorized again on the server.
 */
export function OnboardingChecklist({
  internId,
  items,
  isSelf,
  documentTypeLabels,
}: {
  internId: string
  items: ChecklistItemView[]
  isSelf: boolean
  documentTypeLabels: Record<string, string>
}) {
  const [filter, setFilter] = React.useState<'all' | 'open' | 'mine'>('all')
  const visible = items.filter((item) =>
    filter === 'open' ? !DONE.has(item.status) : filter === 'mine' ? item.canComplete && !DONE.has(item.status) : true,
  )

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Show items" className="flex flex-wrap gap-2">
        {(
          [
            ['all', `All (${items.length})`],
            ['open', 'Open'],
            ['mine', isSelf ? 'My to-dos' : 'Actionable'],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            role="radio"
            aria-checked={filter === value}
            variant={filter === value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-small text-muted-foreground">
          Nothing here.
        </p>
      ) : (
        <ol className="divide-y rounded-xl border bg-card">
          {visible.map((item) => (
            <ChecklistRow
              key={item.id}
              item={item}
              internId={internId}
              isSelf={isSelf}
              documentTypeLabels={documentTypeLabels}
            />
          ))}
        </ol>
      )}
    </div>
  )
}

function ChecklistRow({
  item,
  internId,
  isSelf,
  documentTypeLabels,
}: {
  item: ChecklistItemView
  internId: string
  isSelf: boolean
  documentTypeLabels: Record<string, string>
}) {
  const [dialog, setDialog] = React.useState<null | 'ack' | 'upload' | 'block' | 'skip'>(null)
  const [, complete] = useFormAction(completeOnboardingItemAction)
  const [, command] = useFormAction(setOnboardingItemStatusAction)
  const done = DONE.has(item.status)
  const canUpload = item.item_type === 'DOCUMENT' && item.canComplete && !done
  const canAck = item.item_type === 'ACKNOWLEDGEMENT' && isSelf && !done && item.policy
  const canMark = item.canComplete && !done && item.item_type !== 'DOCUMENT' && item.item_type !== 'ACKNOWLEDGEMENT'

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 gap-3">
        <span className="mt-0.5">
          <StatusIcon item={item} />
        </span>
        <div className="min-w-0 space-y-1">
          <p className={cn('font-medium', done && 'text-muted-foreground line-through decoration-1')}>{item.title}</p>
          <div className="flex flex-wrap items-center gap-1.5 text-caption text-muted-foreground">
            <Badge variant="outline">{humanizeEnum(item.item_type)}</Badge>
            {item.required ? <Badge variant="neutral">Required</Badge> : <Badge variant="outline">Optional</Badge>}
            {!done && item.status !== 'PENDING' && <StatusBadge status={item.status} />}
            {item.overdue && (
              <Badge variant="destructive">
                <OctagonAlert aria-hidden /> Overdue
              </Badge>
            )}
            {item.due_date && <span>Due {formatDay(item.due_date)}</span>}
            <span>· {item.assignee ? fullName(item.assignee) : humanizeEnum(item.assigned_role)}</span>
          </div>
          {item.description && <p className="text-small text-muted-foreground">{item.description}</p>}
          {item.status === 'BLOCKED' && item.blocked_reason && (
            <p className="text-small text-destructive">Blocked: {item.blocked_reason}</p>
          )}
          {item.document && !item.document.deleted_at && (
            <a
              href={`/api/documents/${item.document.id}`}
              className="inline-flex items-center gap-1 text-small text-primary hover:underline"
            >
              <FileCheck2 className="size-4" aria-hidden /> {item.document.file_name}
            </a>
          )}
          {item.policy && (
            <p className="text-caption text-muted-foreground">
              {item.policy.title} v{item.policy.version}
              {item.acknowledged && ' · acknowledged'}
            </p>
          )}
          {item.status === 'COMPLETED' && item.completer && item.completed_at && (
            <p className="text-caption text-muted-foreground">
              Done by {fullName(item.completer)} on {formatDay(item.completed_at)}
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 pl-8 sm:pl-0">
        {canMark && (
          <form action={complete}>
            <input type="hidden" name="itemId" value={item.id} />
            <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">
              <CheckCircle2 aria-hidden /> Mark complete
            </SubmitButton>
          </form>
        )}
        {canUpload && (
          <Button size="sm" variant="outline" onClick={() => setDialog('upload')}>
            <FileText aria-hidden /> Upload
          </Button>
        )}
        {canAck && (
          <Button size="sm" onClick={() => setDialog('ack')}>
            Read & acknowledge
          </Button>
        )}
        {item.canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`HR actions for ${item.title}`}>
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {item.status === 'PENDING' && (
                <DropdownMenuItem onSelect={() => runCommand(command, item.id, 'start')}>
                  <Play aria-hidden /> Mark in progress
                </DropdownMenuItem>
              )}
              {item.status !== 'PENDING' && (
                <DropdownMenuItem onSelect={() => runCommand(command, item.id, 'reopen')}>
                  <RotateCcw aria-hidden /> Reopen
                </DropdownMenuItem>
              )}
              {!done && (
                <DropdownMenuItem onSelect={() => setDialog('skip')}>
                  <SkipForward aria-hidden /> {item.required ? 'Waive…' : 'Skip'}
                </DropdownMenuItem>
              )}
              {!done && item.status !== 'BLOCKED' && (
                <DropdownMenuItem onSelect={() => setDialog('block')}>
                  <Ban aria-hidden /> Mark blocked…
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {dialog === 'ack' && item.policy && <AcknowledgeDialog item={item} onClose={() => setDialog(null)} />}
      {dialog === 'upload' && (
        <UploadForItemDialog
          item={item}
          internId={internId}
          documentTypeLabels={documentTypeLabels}
          onClose={() => setDialog(null)}
        />
      )}
      {(dialog === 'block' || dialog === 'skip') && (
        <ReasonDialog item={item} mode={dialog} onClose={() => setDialog(null)} />
      )}
    </li>
  )
}

function runCommand(command: (formData: FormData) => void, itemId: string, action: string) {
  const formData = new FormData()
  formData.set('itemId', itemId)
  formData.set('action', action)
  React.startTransition(() => command(formData))
}

function AcknowledgeDialog({ item, onClose }: { item: ChecklistItemView; onClose: () => void }) {
  const [state, action] = useFormAction(acknowledgePolicyAction, { onSuccess: onClose })
  const [agreed, setAgreed] = React.useState(false)
  const policy = item.policy!
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {policy.title} <span className="text-muted-foreground">v{policy.version}</span>
          </DialogTitle>
          <DialogDescription>
            Read the policy, then confirm. Your acknowledgement is recorded with the version and time.
          </DialogDescription>
        </DialogHeader>
        <div
          tabIndex={0}
          className="max-h-[50dvh] overflow-y-auto whitespace-pre-line rounded-lg border bg-muted/40 p-4 text-small"
        >
          {policy.body}
        </div>
        <form action={action} className="grid grid-cols-1 gap-4">
          <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
          <input type="hidden" name="itemId" value={item.id} />
          <label className="flex items-start gap-3 text-small">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              className="mt-1 size-4 accent-primary"
            />
            I have read and agree to the {policy.title} (version {policy.version}).
          </label>
          <DialogFooter>
            <SubmitButton pendingLabel="Saving…" disabled={!agreed}>
              Acknowledge
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function UploadForItemDialog({
  item,
  internId,
  documentTypeLabels,
  onClose,
}: {
  item: ChecklistItemView
  internId: string
  documentTypeLabels: Record<string, string>
  onClose: () => void
}) {
  const [state, action] = useFormAction(uploadDocumentAction, { onSuccess: onClose })
  const type = item.required_document_type ?? 'OTHER'
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload: {item.title}</DialogTitle>
          <DialogDescription>
            {documentTypeLabels[type] ?? humanizeEnum(type)} · PDF, PNG, JPEG or DOCX. Stored privately; uploading
            completes this item.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="grid grid-cols-1 gap-4">
          <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
          <input type="hidden" name="internId" value={internId} />
          <input type="hidden" name="onboardingItemId" value={item.id} />
          <input type="hidden" name="documentType" value={type} />
          <Field label="File" htmlFor={`upload-${item.id}`} error={state.fields?.file}>
            <Input id={`upload-${item.id}`} name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.docx" />
          </Field>
          <DialogFooter>
            <SubmitButton pendingLabel="Uploading…">Upload</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ReasonDialog({
  item,
  mode,
  onClose,
}: {
  item: ChecklistItemView
  mode: 'block' | 'skip'
  onClose: () => void
}) {
  const [state, action] = useFormAction(setOnboardingItemStatusAction, { onSuccess: onClose })
  const reasonRequired = mode === 'block' || item.required
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === 'block' ? 'Mark as blocked' : item.required ? 'Waive required item' : 'Skip item'}
          </DialogTitle>
          <DialogDescription>{item.title}</DialogDescription>
        </DialogHeader>
        <form action={action} className="grid grid-cols-1 gap-4">
          <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="action" value={mode} />
          <Field
            label={reasonRequired ? 'Reason' : 'Reason (optional)'}
            htmlFor={`reason-${item.id}`}
            error={state.fields?.reason}
          >
            <Textarea id={`reason-${item.id}`} name="reason" rows={3} required={reasonRequired} />
          </Field>
          <DialogFooter>
            <SubmitButton pendingLabel="Saving…" variant={mode === 'block' ? 'destructive' : 'default'}>
              {mode === 'block' ? 'Mark blocked' : item.required ? 'Waive item' : 'Skip item'}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
