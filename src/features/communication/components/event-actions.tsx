'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/feedback/confirm-dialog'
import { useToast } from '@/components/feedback/toast'
import { Button } from '@/components/ui/button'
import { deleteCalendarEventAction } from '@/server/actions/communication'

export function DeleteEventButton({ eventId, title }: { eventId: string; title: string }) {
  const [open, setOpen] = React.useState(false)
  const router = useRouter()
  const { toast } = useToast()
  return (
    <>
      <Button variant="outline" size="sm" className="text-destructive" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden /> Delete
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete “${title}”?`}
        description="It disappears from everyone’s calendar."
        confirmLabel="Delete event"
        destructive
        onConfirm={async () => {
          const formData = new FormData()
          formData.set('eventId', eventId)
          const result = await deleteCalendarEventAction({ status: 'idle' }, formData)
          if (result.status === 'success') {
            toast({ title: result.message ?? 'Event removed.', variant: 'success' })
            router.push('/calendar')
          } else {
            toast({ title: result.message ?? 'Could not delete the event', variant: 'error' })
          }
        }}
      />
    </>
  )
}
