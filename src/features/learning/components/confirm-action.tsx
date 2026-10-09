'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ConfirmDialog } from '@/components/feedback/confirm-dialog'
import { useToast } from '@/components/feedback/toast'
import { Button, type ButtonProps } from '@/components/ui/button'
import type { FormState } from '@/server/actions/form-state'

type Action = (previous: FormState, formData: FormData) => Promise<FormState>

/** A button that asks for confirmation, then runs a server action with the given fields. */
export function ConfirmActionButton({
  action,
  fields,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = false,
  children,
  ...button
}: {
  action: Action
  fields: Record<string, string>
  title: string
  description: React.ReactNode
  confirmLabel?: string
  destructive?: boolean
  children: React.ReactNode
} & Omit<ButtonProps, 'onClick' | 'type'>) {
  const [open, setOpen] = React.useState(false)
  const router = useRouter()
  const { toast } = useToast()
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} {...button}>
        {children}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        destructive={destructive}
        onConfirm={async () => {
          const data = new FormData()
          for (const [key, value] of Object.entries(fields)) data.set(key, value)
          const result = await action({ status: 'idle' }, data)
          if (result.status === 'success') {
            toast({ title: result.message ?? 'Done', variant: 'success' })
            router.refresh()
          } else {
            toast({ title: result.message ?? 'Something went wrong', variant: 'error' })
          }
        }}
      />
    </>
  )
}
