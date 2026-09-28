'use client'

import * as React from 'react'
import { Input, Textarea } from '@/components/ui/input'
import { Field, FormMessage, SubmitButton } from '@/features/auth/components/form-bits'
import { updateOwnInternProfileAction } from '@/server/actions/interns'
import { useFormAction } from './use-form-action'
import { useUnsavedChanges } from './use-unsaved-changes'

/** The fields an intern may change about themselves. Everything else is managed by HR. */
export function OwnInternProfileForm({
  initial,
}: {
  initial: { phone: string | null; bio: string | null; city: string | null; state: string | null; country: string | null }
}) {
  const [dirty, setDirty] = React.useState(false)
  const [state, action] = useFormAction(updateOwnInternProfileAction, { onSuccess: () => setDirty(false) })
  useUnsavedChanges(dirty)
  const v = state.values
  const f = state.fields ?? {}
  return (
    <form action={action} onChange={() => setDirty(true)} className="grid gap-4 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2">
        <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
      </div>
      <Field label="Phone" htmlFor="own-phone" error={f.phone}>
        <Input id="own-phone" name="phone" type="tel" defaultValue={v?.phone ?? initial.phone ?? ''} />
      </Field>
      <Field label="City" htmlFor="own-city" error={f.city}>
        <Input id="own-city" name="city" defaultValue={v?.city ?? initial.city ?? ''} />
      </Field>
      <Field label="State" htmlFor="own-state" error={f.state}>
        <Input id="own-state" name="state" defaultValue={v?.state ?? initial.state ?? ''} />
      </Field>
      <Field label="Country" htmlFor="own-country" error={f.country}>
        <Input id="own-country" name="country" defaultValue={v?.country ?? initial.country ?? ''} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="About me" htmlFor="own-bio" error={f.bio} hint="Shown to your manager, mentor and HR.">
          <Textarea id="own-bio" name="bio" rows={4} maxLength={1000} defaultValue={v?.bio ?? initial.bio ?? ''} />
        </Field>
      </div>
      <div>
        <SubmitButton pendingLabel="Saving…" disabled={!dirty}>
          Save
        </SubmitButton>
      </div>
    </form>
  )
}
