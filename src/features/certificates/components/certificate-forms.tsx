'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Award, Check, Copy, Send, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/feedback/confirm-dialog'
import { useToast } from '@/components/feedback/toast'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input, inputClassName, Textarea } from '@/components/ui/input'
import { Field, FormMessage, SubmitButton } from '@/features/auth/components/form-bits'
import { ReasonDialog } from '@/features/hr/components/action-form'
import { useFormAction } from '@/features/interns/components/use-form-action'
import { CERTIFICATE_TYPE_HINTS, CERTIFICATE_TYPE_LABELS, CERTIFICATE_TYPES } from '@/lib/certificates/content'
import {
  deleteCertificateDraftAction,
  issueCertificateAction,
  revokeCertificateAction,
  saveCertificateDraftAction,
  saveCertificateSettingsAction,
} from '@/server/actions/certificates'

function TypeSelect({ id, defaultValue, onChange }: { id: string; defaultValue?: string; onChange?: (v: string) => void }) {
  return (
    <select
      id={id}
      name="type"
      defaultValue={defaultValue ?? 'COMPLETION'}
      onChange={(e) => onChange?.(e.target.value)}
      className={inputClassName}
    >
      {CERTIFICATE_TYPES.map((t) => (
        <option key={t} value={t}>
          {CERTIFICATE_TYPE_LABELS[t]}
        </option>
      ))}
    </select>
  )
}

/**
 * Prepare a draft for an intern. The text is filled in from their record and
 * can be edited on the draft before issuing.
 */
export function NewCertificate({
  interns,
  internId,
  internName,
  label = 'New certificate',
  size,
  variant,
}: {
  interns: { id: string; name: string; detail?: string | null }[]
  internId?: string
  internName?: string
  label?: string
  size?: 'sm' | 'default'
  variant?: 'default' | 'outline'
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [type, setType] = React.useState('COMPLETION')
  const [query, setQuery] = React.useState('')
  const [state, action] = useFormAction(saveCertificateDraftAction, {
    onSuccess: (result) => {
      setOpen(false)
      if (result.data?.id) router.push(`/certificates/${result.data.id}`)
    },
  })
  const id = React.useId()
  const q = query.trim().toLowerCase()
  const shown = interns.filter((i) => !q || i.name.toLowerCase().includes(q) || i.detail?.toLowerCase().includes(q))
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)}>
        <Award aria-hidden /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{internName ? `Prepare a certificate for ${internName}` : 'Prepare a certificate'}</DialogTitle>
            <DialogDescription>
              We fill in the name, role, team and dates from the intern’s record. You can check and edit everything before
              issuing.
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="grid gap-4">
            <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
            {internId ? (
              <input type="hidden" name="internId" value={internId} />
            ) : (
              <Field label="Intern" htmlFor={`${id}-intern`} error={state.fields?.internId}>
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name or code…"
                  aria-label="Search interns"
                />
                <select id={`${id}-intern`} name="internId" required size={6} className={`${inputClassName} h-auto py-1`}>
                  {shown.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                      {i.detail ? ` · ${i.detail}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Certificate" htmlFor={`${id}-type`} hint={CERTIFICATE_TYPE_HINTS[type as keyof typeof CERTIFICATE_TYPE_HINTS]}>
              <TypeSelect id={`${id}-type`} onChange={setType} />
            </Field>
            {type === 'EXCELLENCE' && (
              <Field label="Citation (optional)" htmlFor={`${id}-citation`} hint="One sentence on what it recognises.">
                <Textarea id={`${id}-citation`} name="citation" rows={2} maxLength={300} />
              </Field>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton pendingLabel="Preparing…">Prepare draft</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export interface DraftValues {
  id: string
  type: string
  recipientName: string
  programTitle: string | null
  departmentName: string | null
  periodStart: string
  periodEnd: string
  citation: string | null
  signatoryName: string | null
  signatoryTitle: string | null
  isCourse: boolean
  hasSignature: boolean
}

export function DraftEditor({ draft }: { draft: DraftValues }) {
  const [state, action] = useFormAction(saveCertificateDraftAction)
  const id = React.useId()
  const v = state.values
  return (
    <form action={action} className="grid gap-4">
      <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
      <input type="hidden" name="certificateId" value={draft.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Certificate" htmlFor={`${id}-type`}>
          <TypeSelect id={`${id}-type`} defaultValue={v?.type ?? draft.type} />
        </Field>
        <Field label="Recipient name" htmlFor={`${id}-name`} error={state.fields?.recipientName} hint="Exactly as it should be printed.">
          <Input id={`${id}-name`} name="recipientName" required minLength={2} maxLength={120} defaultValue={v?.recipientName ?? draft.recipientName} />
        </Field>
        <Field label={draft.isCourse ? 'Course' : 'Role'} htmlFor={`${id}-program`} error={state.fields?.programTitle}>
          <Input id={`${id}-program`} name="programTitle" maxLength={120} defaultValue={v?.programTitle ?? draft.programTitle ?? ''} placeholder="Web Development Intern" />
        </Field>
        <Field label="Team / department" htmlFor={`${id}-dept`} error={state.fields?.departmentName}>
          <Input id={`${id}-dept`} name="departmentName" maxLength={120} defaultValue={v?.departmentName ?? draft.departmentName ?? ''} />
        </Field>
        <Field label="From" htmlFor={`${id}-start`} error={state.fields?.periodStart}>
          <Input id={`${id}-start`} name="periodStart" type="date" defaultValue={v?.periodStart ?? draft.periodStart} />
        </Field>
        <Field label="To" htmlFor={`${id}-end`} error={state.fields?.periodEnd}>
          <Input id={`${id}-end`} name="periodEnd" type="date" defaultValue={v?.periodEnd ?? draft.periodEnd} />
        </Field>
        <Field
          label="Signatory name"
          htmlFor={`${id}-sig`}
          error={state.fields?.signatoryName}
          hint={
            draft.hasSignature
              ? 'Their signature is printed above the name.'
              : 'No signature image: only the default signatory’s saved signature can be printed.'
          }
        >
          <Input id={`${id}-sig`} name="signatoryName" maxLength={120} defaultValue={v?.signatoryName ?? draft.signatoryName ?? ''} />
        </Field>
        <Field label="Signatory title" htmlFor={`${id}-sigt`} error={state.fields?.signatoryTitle}>
          <Input id={`${id}-sigt`} name="signatoryTitle" maxLength={160} defaultValue={v?.signatoryTitle ?? draft.signatoryTitle ?? ''} placeholder="Head of People" />
        </Field>
      </div>
      <Field label="Citation (optional)" htmlFor={`${id}-citation`} error={state.fields?.citation} hint="Printed in italics under the main text.">
        <Textarea id={`${id}-citation`} name="citation" rows={2} maxLength={300} defaultValue={v?.citation ?? draft.citation ?? ''} />
      </Field>
      <SubmitButton variant="outline" className="justify-self-start" pendingLabel="Saving…">
        Save changes
      </SubmitButton>
    </form>
  )
}

function useActionCall(action: (previous: { status: 'idle' }, formData: FormData) => Promise<{ status: string; message?: string }>) {
  const router = useRouter()
  const { toast } = useToast()
  return async (fields: Record<string, string>, after?: () => void) => {
    const formData = new FormData()
    for (const [k, v] of Object.entries(fields)) formData.set(k, v)
    const result = await action({ status: 'idle' }, formData)
    toast({ title: result.message ?? (result.status === 'success' ? 'Done' : 'Something went wrong'), variant: result.status === 'success' ? 'success' : 'error' })
    if (result.status === 'success') {
      after?.()
      router.refresh()
    }
  }
}

export function IssueCertificateButton({ certificateId, recipientName }: { certificateId: string; recipientName: string }) {
  const [open, setOpen] = React.useState(false)
  const call = useActionCall(issueCertificateAction)
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Send aria-hidden /> Issue certificate
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Issue to ${recipientName}?`}
        description="It gets a permanent number and a public verification link, the text can no longer be edited, and the intern is notified. You can revoke it later if needed."
        confirmLabel="Issue"
        onConfirm={() => call({ certificateId })}
      />
    </>
  )
}

export function DeleteDraftButton({ certificateId }: { certificateId: string }) {
  const [open, setOpen] = React.useState(false)
  const router = useRouter()
  const call = useActionCall(deleteCertificateDraftAction)
  return (
    <>
      <Button variant="outline" className="text-destructive" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden /> Delete draft
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this draft?"
        description="Nothing was issued, so nothing else changes."
        confirmLabel="Delete draft"
        destructive
        onConfirm={() => call({ certificateId }, () => router.push('/certificates'))}
      />
    </>
  )
}

export function RevokeCertificateButton({ certificateId, number }: { certificateId: string; number: string }) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button variant="outline" className="text-destructive" onClick={() => setOpen(true)}>
        Revoke
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title={`Revoke ${number}?`}
        description="Anyone checking it will see that it was revoked. The intern is notified. This can’t be undone — issue a new certificate if it needs correcting."
        action={revokeCertificateAction}
        fields={{ certificateId }}
        reasonName="reason"
        reasonLabel="Reason (kept in the audit trail, not shown publicly)"
        confirmLabel="Revoke certificate"
        destructive
      />
    </>
  )
}

export function CopyLinkButton({ url, label = 'Copy verification link' }: { url: string; label?: string }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <Button
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } catch {
          window.prompt('Copy this link', url)
        }
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? 'Copied' : label}
    </Button>
  )
}

type PartnerSetting = { enabled: boolean; approvalRef: string | null }

function PartnerLogoField({
  id,
  name,
  label,
  image,
  setting,
  error,
}: {
  id: string
  name: 'msme' | 'digitalIndia'
  label: string
  image: string
  setting: PartnerSetting
  error?: string
}) {
  return (
    <fieldset className="grid gap-3 rounded-lg border p-3">
      <legend className="px-1 text-small font-medium">{label}</legend>
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand image */}
        <img src={image} alt="" className="h-10 w-auto rounded bg-white p-1" />
        <label className="flex items-start gap-2 text-small">
          <input type="checkbox" name={`${name}Logo`} defaultChecked={setting.enabled} className="mt-0.5 size-4 accent-primary" />
          <span>Show on certificates</span>
        </label>
      </div>
      <Field
        label="Approval reference"
        htmlFor={`${id}-${name}-ref`}
        error={error}
        hint="Letter or permission number of the written approval to use this logo. Required to show it."
      >
        <Input id={`${id}-${name}-ref`} name={`${name}ApprovalRef`} maxLength={200} defaultValue={setting.approvalRef ?? ''} />
      </Field>
    </fieldset>
  )
}

export function CertificateSettingsForm({
  settings,
}: {
  settings: {
    signatoryName: string | null
    signatoryTitle: string | null
    autoCourse: boolean
    msmeLogo: PartnerSetting
    digitalIndiaLogo: PartnerSetting
  }
}) {
  const [state, action] = useFormAction(saveCertificateSettingsAction)
  const id = React.useId()
  return (
    <form action={action} className="grid max-w-xl gap-4">
      <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
      <Field label="Default signatory name" htmlFor={`${id}-name`} hint="Printed under the signature line. You can change it per certificate.">
        <Input id={`${id}-name`} name="signatoryName" maxLength={120} defaultValue={settings.signatoryName ?? ''} placeholder="Kavya Nair" />
      </Field>
      <Field label="Signatory title" htmlFor={`${id}-title`}>
        <Input id={`${id}-title`} name="signatoryTitle" maxLength={160} defaultValue={settings.signatoryTitle ?? ''} placeholder="Head of People, Ayava Creatives" />
      </Field>
      <label className="flex items-start gap-2 text-small">
        <input type="checkbox" name="autoCourse" defaultChecked={settings.autoCourse} className="mt-0.5 size-4 accent-primary" />
        <span>
          <span className="font-medium">Issue course certificates automatically</span>
          <span className="block text-caption text-muted-foreground">When an intern completes a course, they get a certificate of completion for it.</span>
        </span>
      </label>
      <div className="grid gap-3">
        <p className="text-small font-medium">Government programme logos</p>
        <p className="text-caption text-muted-foreground">
          These marks may only be used with written permission from the issuing authority. Each stays off until you enter
          the approval reference; use the official logo file supplied with the approval.
        </p>
        <PartnerLogoField id={id} name="msme" label="Ministry of MSME logo" image="/brand/partner-msme.png" setting={settings.msmeLogo} error={state.fields?.msmeApprovalRef} />
        <PartnerLogoField
          id={id}
          name="digitalIndia"
          label="Digital India logo"
          image="/brand/partner-digital-india.png"
          setting={settings.digitalIndiaLogo}
          error={state.fields?.digitalIndiaApprovalRef}
        />
      </div>
      <SubmitButton className="justify-self-start" pendingLabel="Saving…">
        Save settings
      </SubmitButton>
    </form>
  )
}
