'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { FormField } from '@/components/forms/form-field'
import { useToast } from '@/components/feedback/toast'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { approveOutreachAction, rejectOutreachAction, saveOutreachSettingsAction, stopOutreachAction } from '@/server/actions/outreach'

export interface OutreachSettingsValue {
  outreachEnabled: boolean
  senderName: string
  companyName: string
  companyWebsite: string
  postalAddress: string
  sendDays: number[]
  sendFromHour: number
  sendUntilHour: number
  mailboxDailyMax: number
  followUpGapDays: number[]
  approvalsRequired: number
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function useResult() {
  const router = useRouter()
  const { toast } = useToast()
  return (result: { status: string; message?: string }) => {
    toast({ title: result.message ?? 'Something went wrong', variant: result.status === 'success' ? 'success' : 'error' })
    if (result.status === 'success') router.refresh()
    return result.status === 'success'
  }
}

export function OutreachSettingsForm({ initial }: { initial: OutreachSettingsValue }) {
  const [s, setS] = React.useState(initial)
  const [busy, setBusy] = React.useState(false)
  const done = useResult()
  const set = (patch: Partial<OutreachSettingsValue>) => setS((v) => ({ ...v, ...patch }))

  async function save() {
    setBusy(true)
    done(await saveOutreachSettingsAction(s))
    setBusy(false)
  }

  return (
    <div className="grid gap-4">
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1" checked={s.outreachEnabled} onChange={(e) => set({ outreachEnabled: e.target.checked })} />
        <span>
          <span className="text-small font-medium">Send outreach emails automatically</span>
          <span className="block text-caption text-muted-foreground">Only after every readiness check passes. Hot leads that look like big businesses go to the team instead.</span>
        </span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Sender’s name" hint="Signs every email, e.g. “Aditya Rawat”">
          <Input value={s.senderName} maxLength={60} onChange={(e) => set({ senderName: e.target.value })} />
        </FormField>
        <FormField label="Company name">
          <Input value={s.companyName} maxLength={80} onChange={(e) => set({ companyName: e.target.value })} />
        </FormField>
      </div>
      <FormField label="Company website">
        <Input value={s.companyWebsite} maxLength={200} onChange={(e) => set({ companyWebsite: e.target.value })} />
      </FormField>
      <FormField label="Postal address" hint="Shown in every email’s footer, so businesses know who is writing">
        <Textarea rows={2} value={s.postalAddress} maxLength={200} onChange={(e) => set({ postalAddress: e.target.value })} />
      </FormField>
      <FormField label="Sending days (India time)">
        <div className="flex flex-wrap gap-3">
          {DAYS.map((label, i) => (
            <label key={label} className="flex items-center gap-1.5 text-small">
              <input
                type="checkbox"
                checked={s.sendDays.includes(i + 1)}
                onChange={(e) => set({ sendDays: e.target.checked ? [...s.sendDays, i + 1] : s.sendDays.filter((d) => d !== i + 1) })}
              />
              {label}
            </label>
          ))}
        </div>
      </FormField>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="From (hour)">
          <Input type="number" min={0} max={23} value={s.sendFromHour} onChange={(e) => set({ sendFromHour: Number(e.target.value) })} />
        </FormField>
        <FormField label="Until (hour)">
          <Input type="number" min={1} max={24} value={s.sendUntilHour} onChange={(e) => set({ sendUntilHour: Number(e.target.value) })} />
        </FormField>
        <FormField label="Per mailbox per day" hint="After warm-up (starts at 5, +3 a day)">
          <Input type="number" min={1} max={200} value={s.mailboxDailyMax} onChange={(e) => set({ mailboxDailyMax: Number(e.target.value) })} />
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Follow-up 1 after (days)">
          <Input type="number" min={1} max={30} value={s.followUpGapDays[0]} onChange={(e) => set({ followUpGapDays: [Number(e.target.value), s.followUpGapDays[1] ?? 4] })} />
        </FormField>
        <FormField label="Follow-up 2 after (days)">
          <Input type="number" min={1} max={30} value={s.followUpGapDays[1]} onChange={(e) => set({ followUpGapDays: [s.followUpGapDays[0] ?? 3, Number(e.target.value)] })} />
        </FormField>
        <FormField label="First emails to approve" hint="Then they send on their own">
          <Input type="number" min={0} max={1000} value={s.approvalsRequired} onChange={(e) => set({ approvalsRequired: Number(e.target.value) })} />
        </FormField>
      </div>
      <div>
        <Button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save outreach settings'}
        </Button>
      </div>
    </div>
  )
}

export function ApprovalCard({ message }: { message: { id: string; to: string; subject: string; body: string; lead: { id: string; name: string; city: string | null; tier: string | null } } }) {
  const [subject, setSubject] = React.useState(message.subject)
  const [body, setBody] = React.useState(message.body)
  const [busy, setBusy] = React.useState(false)
  const done = useResult()
  const edited = subject !== message.subject || body !== message.body

  async function approve() {
    setBusy(true)
    done(await approveOutreachAction({ messageId: message.id, ...(edited ? { subject, body } : {}) }))
    setBusy(false)
  }
  async function reject() {
    setBusy(true)
    done(await rejectOutreachAction(message.id))
    setBusy(false)
  }

  return (
    <div className="grid gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <a href={`/growth/leads/${message.lead.id}`} className="font-medium hover:underline">
          {message.lead.name}
          {message.lead.city ? <span className="font-normal text-muted-foreground"> · {message.lead.city}</span> : null}
        </a>
        <span className="text-caption text-muted-foreground">To {message.to}</span>
      </div>
      <FormField label="Subject">
        <Input value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} />
      </FormField>
      <FormField label="Email" hint="Exactly what will be sent. Keep the audit link and the unsubscribe line.">
        <Textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-caption" />
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button onClick={approve} disabled={busy}>
          {edited ? 'Save and approve' : 'Approve'}
        </Button>
        <Button variant="outline" onClick={reject} disabled={busy}>
          Don’t send
        </Button>
      </div>
    </div>
  )
}

export function StopOutreachButton({ leadId }: { leadId: string }) {
  const [busy, setBusy] = React.useState(false)
  const done = useResult()
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        done(await stopOutreachAction(leadId))
        setBusy(false)
      }}
    >
      Stop automatic emails
    </Button>
  )
}
