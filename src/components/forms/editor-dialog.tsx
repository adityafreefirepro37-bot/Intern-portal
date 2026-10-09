'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { inputClassName } from '@/components/ui/input'
import { FormMessage, SubmitButton } from '@/features/auth/components/form-bits'
import { useFormAction } from '@/features/interns/components/use-form-action'
import type { FormState } from '@/server/actions/form-state'

/** A dialog wrapping one server-action form (closes and refreshes on success). */
type Action<T = undefined> = (previous: FormState<T>, formData: FormData) => Promise<FormState<T>>

export function EditorDialog<T>({
  trigger,
  title,
  description,
  action,
  onSuccess,
  wide,
  children,
}: {
  trigger: (open: () => void) => React.ReactNode
  title: string
  description?: string
  action: Action<T>
  onSuccess?: (state: FormState<T>) => void
  wide?: boolean
  children: (state: FormState<T>) => React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const [state, formAction] = useFormAction(action, {
    onSuccess: (s) => {
      setOpen(false)
      onSuccess?.(s)
    },
  })
  return (
    <>
      {trigger(() => setOpen(true))}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={wide ? 'max-w-2xl' : 'max-w-lg'}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <form action={formAction} className="grid gap-4">
            <FormMessage status={state.status === 'error' ? 'error' : 'idle'} message={state.message} />
            {children(state)}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function Check({ name, label, defaultChecked, hint }: { name: string; label: string; defaultChecked?: boolean; hint?: string }) {
  return (
    <label className="flex items-start gap-2.5 text-small">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4" />
      <span>
        {label}
        {hint && <span className="block text-caption text-muted-foreground">{hint}</span>}
      </span>
    </label>
  )
}

export function Select({
  id,
  name,
  defaultValue,
  options,
  empty,
}: {
  id: string
  name: string
  defaultValue?: string | null
  options: { value: string; label: string }[]
  empty?: string
}) {
  return (
    <select id={id} name={name} defaultValue={defaultValue ?? ''} className={inputClassName}>
      {empty !== undefined && <option value="">{empty}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

