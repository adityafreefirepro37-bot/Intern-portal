'use client'

import * as React from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Detail } from '@/features/interns/components/profile-view'
import { useFormAction } from '@/features/interns/components/use-form-action'
import { formatDay } from '@/lib/utils'
import {
  removeEmergencyContactAction,
  saveCompensationAction,
  saveEmergencyContactAction,
  savePersonalInfoAction,
} from '@/server/actions/hr'
import type { FormState } from '@/server/actions/form-state'
import { ActionButton } from './action-form'

type Action = (previous: FormState, formData: FormData) => Promise<FormState>

interface Personal {
  preferred_name: string | null
  date_of_birth: Date | null
  gender: string | null
  address_line_1: string | null
  address_line_2: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  country: string | null
}

interface Contact {
  id: string
  name: string
  relationship: string
  phone: string
  alternate_phone: string | null
  email: string | null
}

interface Compensation {
  amount: number | null
  currency: string | null
  frequency: string | null
  notes: string | null
}

function FormDialog({
  title,
  description,
  action,
  trigger,
  children,
}: {
  title: string
  description?: string
  action: Action
  trigger: (open: () => void) => React.ReactNode
  children: (state: FormState) => React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const [state, formAction] = useFormAction(action, { onSuccess: () => setOpen(false) })
  return (
    <>
      {trigger(() => setOpen(true))}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <form action={formAction} className="grid gap-4">
            <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
            {children(state)}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton>Save</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

const FREQUENCY_LABELS: Record<string, string> = { MONTHLY: 'Monthly', ONE_TIME: 'One-time', NONE: 'Unpaid' }

/**
 * The HR record on an intern profile: personal information, emergency
 * contacts and stipend. The server only sends these to the intern and to
 * people allowed to see them; editing needs HR permissions.
 */
export function HrRecord({
  internId,
  personal,
  contacts,
  compensation,
  can,
}: {
  internId: string
  personal: Personal | null
  contacts: Contact[]
  compensation: Compensation | null
  can: { edit: boolean; editCompensation: boolean }
}) {
  const address = [
    personal?.address_line_1,
    personal?.address_line_2,
    personal?.city,
    personal?.state,
    personal?.postal_code,
    personal?.country,
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Personal information</CardTitle>
            <CardDescription>Confidential — visible to the intern and HR.</CardDescription>
          </div>
          {can.edit && (
            <FormDialog
              title="Edit personal information"
              action={savePersonalInfoAction}
              trigger={(open) => (
                <Button size="sm" variant="outline" onClick={open}>
                  <Pencil aria-hidden /> Edit
                </Button>
              )}
            >
              {(state) => (
                <>
                  <input type="hidden" name="internId" value={internId} />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Preferred name" htmlFor="p-pref" error={state.fields?.preferredName}>
                      <Input
                        id="p-pref"
                        name="preferredName"
                        maxLength={80}
                        defaultValue={personal?.preferred_name ?? ''}
                      />
                    </Field>
                    <Field label="Date of birth" htmlFor="p-dob" error={state.fields?.dateOfBirth}>
                      <Input
                        id="p-dob"
                        name="dateOfBirth"
                        type="date"
                        defaultValue={
                          personal?.date_of_birth ? new Date(personal.date_of_birth).toISOString().slice(0, 10) : ''
                        }
                      />
                    </Field>
                    <Field label="Gender" htmlFor="p-gender">
                      <Input id="p-gender" name="gender" maxLength={40} defaultValue={personal?.gender ?? ''} />
                    </Field>
                    <Field label="Address line 1" htmlFor="p-a1">
                      <Input
                        id="p-a1"
                        name="addressLine1"
                        maxLength={160}
                        defaultValue={personal?.address_line_1 ?? ''}
                      />
                    </Field>
                    <Field label="Address line 2" htmlFor="p-a2">
                      <Input
                        id="p-a2"
                        name="addressLine2"
                        maxLength={160}
                        defaultValue={personal?.address_line_2 ?? ''}
                      />
                    </Field>
                    <Field label="City" htmlFor="p-city">
                      <Input id="p-city" name="city" maxLength={80} defaultValue={personal?.city ?? ''} />
                    </Field>
                    <Field label="State" htmlFor="p-state">
                      <Input id="p-state" name="state" maxLength={80} defaultValue={personal?.state ?? ''} />
                    </Field>
                    <Field label="Postal code" htmlFor="p-postal">
                      <Input
                        id="p-postal"
                        name="postalCode"
                        maxLength={20}
                        defaultValue={personal?.postal_code ?? ''}
                      />
                    </Field>
                    <Field label="Country" htmlFor="p-country">
                      <Input id="p-country" name="country" maxLength={80} defaultValue={personal?.country ?? ''} />
                    </Field>
                  </div>
                </>
              )}
            </FormDialog>
          )}
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Detail label="Preferred name" value={personal?.preferred_name} />
            <Detail label="Date of birth" value={personal?.date_of_birth ? formatDay(personal.date_of_birth) : null} />
            <Detail label="Gender" value={personal?.gender} />
            <Detail label="Address" value={address} className="sm:col-span-2" />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <CardTitle>Emergency contacts</CardTitle>
          {can.edit && contacts.length < 5 && <ContactDialog internId={internId} />}
        </CardHeader>
        <CardContent className="space-y-3">
          {contacts.length === 0 && <p className="text-small text-muted-foreground">None recorded.</p>}
          {contacts.map((contact) => (
            <div key={contact.id} className="flex items-start gap-3 text-small">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {contact.name} <span className="font-normal text-muted-foreground">({contact.relationship})</span>
                </p>
                <p className="text-muted-foreground">
                  {[contact.phone, contact.alternate_phone && `alt. ${contact.alternate_phone}`, contact.email]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              {can.edit && (
                <>
                  <ContactDialog internId={internId} contact={contact} />
                  <ActionButton
                    action={removeEmergencyContactAction}
                    fields={{ internId, contactId: contact.id }}
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove ${contact.name}`}
                  >
                    <Trash2 aria-hidden />
                  </ActionButton>
                </>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {compensation && (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle>Stipend</CardTitle>
              <CardDescription>
                Restricted to people with compensation access. Payroll isn’t part of Intern OS.
              </CardDescription>
            </div>
            {can.editCompensation && (
              <FormDialog
                title="Edit stipend"
                description="Changes are recorded in the audit log."
                action={saveCompensationAction}
                trigger={(open) => (
                  <Button size="sm" variant="outline" onClick={open}>
                    <Pencil aria-hidden /> Edit
                  </Button>
                )}
              >
                {(state) => (
                  <>
                    <input type="hidden" name="internId" value={internId} />
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <Field label="Amount" htmlFor="c-amount" error={state.fields?.amount}>
                        <Input
                          id="c-amount"
                          name="amount"
                          type="number"
                          min={0}
                          step="0.01"
                          defaultValue={compensation.amount ?? ''}
                        />
                      </Field>
                      <Field label="Currency" htmlFor="c-currency" error={state.fields?.currency}>
                        <Input
                          id="c-currency"
                          name="currency"
                          maxLength={3}
                          defaultValue={compensation.currency ?? 'INR'}
                        />
                      </Field>
                      <Field label="Frequency" htmlFor="c-freq">
                        <select
                          id="c-freq"
                          name="frequency"
                          defaultValue={compensation.frequency ?? ''}
                          className={inputClassName}
                        >
                          <option value="">—</option>
                          {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <Field label="Notes" htmlFor="c-notes">
                      <Input id="c-notes" name="notes" maxLength={500} defaultValue={compensation.notes ?? ''} />
                    </Field>
                  </>
                )}
              </FormDialog>
            )}
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Detail
                label="Amount"
                value={
                  compensation.amount !== null
                    ? new Intl.NumberFormat('en-IN', {
                        style: 'currency',
                        currency: compensation.currency ?? 'INR',
                      }).format(compensation.amount)
                    : null
                }
              />
              <Detail
                label="Frequency"
                value={compensation.frequency ? FREQUENCY_LABELS[compensation.frequency] : null}
              />
              <Detail label="Notes" value={compensation.notes} />
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function ContactDialog({ internId, contact }: { internId: string; contact?: Contact }) {
  return (
    <FormDialog
      title={contact ? `Edit ${contact.name}` : 'Add emergency contact'}
      action={saveEmergencyContactAction}
      trigger={(open) =>
        contact ? (
          <Button size="icon-sm" variant="ghost" onClick={open} aria-label={`Edit ${contact.name}`}>
            <Pencil aria-hidden />
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={open}>
            <Plus aria-hidden /> Add
          </Button>
        )
      }
    >
      {(state) => (
        <>
          <input type="hidden" name="internId" value={internId} />
          {contact && <input type="hidden" name="contactId" value={contact.id} />}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="ec-name" error={state.fields?.name}>
              <Input id="ec-name" name="name" required maxLength={120} defaultValue={contact?.name} />
            </Field>
            <Field label="Relationship" htmlFor="ec-rel" error={state.fields?.relationship}>
              <Input id="ec-rel" name="relationship" required maxLength={60} defaultValue={contact?.relationship} />
            </Field>
            <Field label="Phone" htmlFor="ec-phone" error={state.fields?.phone}>
              <Input id="ec-phone" name="phone" type="tel" required defaultValue={contact?.phone} />
            </Field>
            <Field label="Alternate phone" htmlFor="ec-alt" error={state.fields?.alternatePhone}>
              <Input id="ec-alt" name="alternatePhone" type="tel" defaultValue={contact?.alternate_phone ?? ''} />
            </Field>
            <Field label="Email" htmlFor="ec-email" error={state.fields?.email}>
              <Input id="ec-email" name="email" type="email" defaultValue={contact?.email ?? ''} />
            </Field>
          </div>
        </>
      )}
    </FormDialog>
  )
}
