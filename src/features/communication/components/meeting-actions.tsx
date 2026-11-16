'use client'

import * as React from 'react'
import { Check, CircleHelp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ActionButton, ReasonDialog } from '@/features/hr/components/action-form'
import { cn } from '@/lib/utils'
import { cancelMeetingAction, respondToMeetingAction } from '@/server/actions/communication'

const RESPONSES = [
  { value: 'ACCEPTED', label: 'Accept', icon: Check },
  { value: 'TENTATIVE', label: 'Maybe', icon: CircleHelp },
  { value: 'DECLINED', label: 'Decline', icon: X },
] as const

/** Accept / maybe / decline; the current answer is shown pressed. */
export function MeetingResponse({ meetingId, current }: { meetingId: string; current: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Your reply">
      {RESPONSES.map(({ value, label, icon: Icon }) => {
        const active = current === value
        return (
          <ActionButton
            key={value}
            action={respondToMeetingAction}
            fields={{ meetingId, response: value }}
            variant={active ? 'default' : 'outline'}
            size="sm"
            aria-pressed={active}
            className={cn(active && 'pointer-events-none')}
          >
            <Icon aria-hidden /> {label}
          </ActionButton>
        )
      })}
    </div>
  )
}

export function CancelMeetingButton({ meetingId, title }: { meetingId: string; title: string }) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="text-destructive">
        Cancel meeting
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title={`Cancel “${title}”?`}
        description="Everyone invited is told it’s cancelled. This can’t be undone — schedule a new meeting instead."
        action={cancelMeetingAction}
        fields={{ meetingId }}
        reasonName="reason"
        reasonLabel="Message to attendees"
        required={false}
        confirmLabel="Cancel meeting"
        destructive
      />
    </>
  )
}
