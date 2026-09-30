'use client'

import * as React from 'react'
import type { ButtonProps } from '@/components/ui/button'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/input'
import { Field, FormMessage, SubmitButton } from '@/features/auth/components/form-bits'
import { useFormAction } from '@/features/interns/components/use-form-action'
import type { FormState } from '@/server/actions/form-state'

type Action = (previous: FormState, formData: FormData) => Promise<FormState>

function Hidden({ fields }: { fields: Record<string, string> }) {
  return (
    <>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </>
  )
}

/** A one-click server action (hidden fields + submit button) with toast feedback. */
export function ActionButton({
  action,
  fields,
  children,
  pendingLabel,
  ...button
}: {
  action: Action
  fields: Record<string, string>
  children: React.ReactNode
  pendingLabel?: string
} & Omit<ButtonProps, 'type' | 'formAction'>) {
  const [, formAction] = useFormAction(action)
  return (
    <form action={formAction} className="inline-flex">
      <Hidden fields={fields} />
      <SubmitButton pendingLabel={pendingLabel} {...button}>
        {children}
      </SubmitButton>
    </form>
  )
}

/**
 * A decision that needs (or allows) a written reason — rejecting leave,
 * rejecting a document, asking an intern for more information.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  action,
  fields,
  reasonName = 'comment',
  reasonLabel = 'Reason',
  reasonHint,
  required = true,
  confirmLabel,
  destructive = false,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  action: Action
  fields: Record<string, string>
  reasonName?: string
  reasonLabel?: string
  reasonHint?: string
  required?: boolean
  confirmLabel: string
  destructive?: boolean
  /** Extra inputs rendered above the reason. */
  children?: React.ReactNode
}) {
  const [state, formAction] = useFormAction(action, { onSuccess: () => onOpenChange(false) })
  const id = React.useId()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form action={formAction} className="grid gap-4">
          <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
          <Hidden fields={fields} />
          {children}
          <Field
            label={required ? reasonLabel : `${reasonLabel} (optional)`}
            htmlFor={`${id}-reason`}
            hint={reasonHint}
            error={state.fields?.[reasonName]}
          >
            <Textarea
              id={`${id}-reason`}
              name={reasonName}
              required={required}
              maxLength={1000}
              defaultValue={state.values?.[reasonName]}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <SubmitButton variant={destructive ? 'destructive' : 'default'}>{confirmLabel}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
