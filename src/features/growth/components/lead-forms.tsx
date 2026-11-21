'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { FormField } from '@/components/forms/form-field'
import { useToast } from '@/components/feedback/toast'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, inputClassName, Textarea } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { addLeadAction, updateLeadAction } from '@/server/actions/leads'
import { LEAD_STATUS_LABELS } from './lead-badges'

/** Add a business by hand (a referral, a website enquiry); it is audited like the rest. */
export function AddLeadButton({ industries }: { industries: { id: string; name: string }[] }) {
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const f = new FormData(event.currentTarget)
    const value = (name: string) => String(f.get(name) ?? '').trim() || undefined
    setBusy(true)
    const result = await addLeadAction({
      name: String(f.get('name') ?? ''),
      website: value('website'),
      phone: value('phone'),
      email: value('email'),
      city: value('city'),
      industryId: value('industryId'),
    })
    setBusy(false)
    setErrors(result.fields ?? {})
    toast({ title: result.message ?? 'Could not add the lead', variant: result.status === 'success' ? 'success' : 'error' })
    if (result.status === 'success' && result.data) {
      setOpen(false)
      router.push(`/growth/leads/${result.data.id}`)
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Add lead
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a lead</DialogTitle>
            <DialogDescription>For a business you found yourself. It gets the same audit and score.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid gap-4">
            <FormField label="Business name" required error={errors.name}>
              <Input name="name" required maxLength={200} />
            </FormField>
            <FormField label="Website" hint="Leave empty if they have none" error={errors.website}>
              <Input name="website" placeholder="example.com" maxLength={300} />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Phone" error={errors.phone}>
                <Input name="phone" type="tel" maxLength={30} />
              </FormField>
              <FormField label="Email" error={errors.email}>
                <Input name="email" type="email" maxLength={120} />
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="City">
                <Input name="city" maxLength={60} />
              </FormField>
              <FormField label="Industry">
                <select name="industryId" className={inputClassName} defaultValue="">
                  <option value="">Not sure</option>
                  {industries.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Adding…' : 'Add lead'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

interface Checklist {
  instagramActive?: 'yes' | 'no' | 'none' | null
  runsAds?: 'yes' | 'no' | 'unknown' | null
  decisionMaker?: string | null
}

/**
 * The reviewer's part (often an intern): the checks the portal can't automate
 * (Instagram activity, ads), the owner's name, notes and the decision.
 */
export function LeadReviewForm({
  leadId,
  status,
  notes,
  email,
  checklist,
  links,
}: {
  leadId: string
  status: string
  notes: string | null
  email: string | null
  checklist: Checklist
  links: { instagram?: string; facebook?: string; adLibrary: string }
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [busy, setBusy] = React.useState(false)
  const [state, setState] = React.useState({
    status: status === 'DO_NOT_CONTACT' ? 'NEW' : status,
    notes: notes ?? '',
    email: email ?? '',
    instagramActive: checklist.instagramActive ?? '',
    runsAds: checklist.runsAds ?? '',
    decisionMaker: checklist.decisionMaker ?? '',
  })
  const set = (patch: Partial<typeof state>) => setState((s) => ({ ...s, ...patch }))

  async function save() {
    setBusy(true)
    const result = await updateLeadAction({
      leadId,
      status: state.status as 'NEW' | 'REVIEWED' | 'READY' | 'NOT_A_FIT',
      notes: state.notes.trim() || null,
      email: state.email.trim() || null,
      checklist: {
        instagramActive: state.instagramActive || null,
        runsAds: state.runsAds || null,
        decisionMaker: state.decisionMaker.trim() || null,
      },
    })
    setBusy(false)
    toast({ title: result.message ?? 'Could not save', variant: result.status === 'success' ? 'success' : 'error' })
    if (result.status === 'success') router.refresh()
  }

  return (
    <div className="grid gap-4">
      <FormField label="Instagram" hint={links.instagram ? 'Open it and check the date of the last post' : 'No Instagram linked from their website: search for it'}>
        <select className={inputClassName} value={state.instagramActive} onChange={(e) => set({ instagramActive: e.target.value })}>
          <option value="">Not checked yet</option>
          <option value="yes">Active (posted in the last 30 days)</option>
          <option value="no">Inactive (nothing for 30+ days)</option>
          <option value="none">No Instagram account</option>
        </select>
      </FormField>
      <div className="-mt-2 flex flex-wrap gap-3 text-caption">
        {links.instagram && (
          <a href={links.instagram} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            Open Instagram ↗
          </a>
        )}
        {links.facebook && (
          <a href={links.facebook} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            Open Facebook ↗
          </a>
        )}
      </div>
      <FormField label="Running ads?" hint="Meta Ad Library shows every ad a page is running">
        <select className={inputClassName} value={state.runsAds} onChange={(e) => set({ runsAds: e.target.value })}>
          <option value="">Not checked yet</option>
          <option value="yes">Yes, running ads</option>
          <option value="no">No ads</option>
          <option value="unknown">Couldn’t tell</option>
        </select>
      </FormField>
      <a href={links.adLibrary} target="_blank" rel="noopener noreferrer" className="-mt-2 text-caption text-primary hover:underline">
        Search Meta Ad Library ↗
      </a>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Owner / decision-maker" hint="Name, if you found it">
          <Input value={state.decisionMaker} maxLength={120} onChange={(e) => set({ decisionMaker: e.target.value })} />
        </FormField>
        <FormField label="Email" hint="Correct it if the audit found the wrong one">
          <Input type="email" value={state.email} maxLength={120} onChange={(e) => set({ email: e.target.value })} />
        </FormField>
      </div>
      <FormField label="Notes">
        <Textarea rows={3} value={state.notes} maxLength={4000} onChange={(e) => set({ notes: e.target.value })} />
      </FormField>
      <FormField label="Decision">
        <select className={cn(inputClassName)} value={state.status} onChange={(e) => set({ status: e.target.value })}>
          {(['NEW', 'REVIEWED', 'READY', 'NOT_A_FIT'] as const).map((s) => (
            <option key={s} value={s}>
              {LEAD_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </FormField>
      <div>
        <Button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save review'}
        </Button>
      </div>
    </div>
  )
}
