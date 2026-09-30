'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { BadgeCheck, MoreHorizontal } from 'lucide-react'
import { useToast } from '@/components/feedback/toast'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { canDecide, type DocumentDecision } from '@/lib/hr/documents'
import { reviewDocumentAction } from '@/server/actions/hr'
import { ActionButton, ReasonDialog } from './action-form'

/** Verify / reject / request replacement for one document (document.verify; never your own). */
export function DocumentReviewActions({
  documentId,
  status,
  name,
}: {
  documentId: string
  status: 'UPLOADED' | 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED' | 'EXPIRED' | 'REQUIRED'
  name: string
}) {
  const [decision, setDecision] = React.useState<'REJECT' | 'REQUEST_REPLACEMENT' | null>(null)
  const router = useRouter()
  const { toast } = useToast()
  if (status === 'REQUIRED') return null
  const can = (d: DocumentDecision) => canDecide(d, status)
  if (!can('VERIFY') && !can('REJECT') && !can('REQUEST_REPLACEMENT')) return null
  return (
    <>
      {can('VERIFY') && (
        <ActionButton
          action={reviewDocumentAction}
          fields={{ documentId, decision: 'VERIFY' }}
          size="sm"
          aria-label={`Verify ${name}`}
        >
          <BadgeCheck aria-hidden /> Verify
        </ActionButton>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-sm" aria-label={`More review actions for ${name}`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {can('START_REVIEW') && (
            <DropdownMenuItem
              onSelect={async () => {
                const data = new FormData()
                data.set('documentId', documentId)
                data.set('decision', 'START_REVIEW')
                const result = await reviewDocumentAction({ status: 'idle' }, data)
                toast({ title: result.message ?? 'Done', variant: result.status === 'error' ? 'error' : 'success' })
                router.refresh()
              }}
            >
              Mark under review
            </DropdownMenuItem>
          )}
          {can('REJECT') && <DropdownMenuItem onSelect={() => setDecision('REJECT')}>Reject…</DropdownMenuItem>}
          {can('REQUEST_REPLACEMENT') && (
            <DropdownMenuItem onSelect={() => setDecision('REQUEST_REPLACEMENT')}>
              Request replacement…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {decision && (
        <ReasonDialog
          open
          onOpenChange={(open) => !open && setDecision(null)}
          title={decision === 'REJECT' ? `Reject ${name}` : `Request a new ${name}`}
          description="The intern sees this reason and is notified."
          action={reviewDocumentAction}
          fields={{ documentId, decision }}
          reasonName="reason"
          confirmLabel={decision === 'REJECT' ? 'Reject' : 'Request replacement'}
          destructive={decision === 'REJECT'}
        />
      )}
    </>
  )
}
