'use client'

import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/feedback/toast'
import type { FormState } from '@/server/actions/form-state'

type Action<T> = (previous: FormState<T>, formData: FormData) => Promise<FormState<T>>

/**
 * useActionState + success toast + router refresh. Errors stay in the returned
 * state so forms can show field messages next to the inputs.
 */
export function useFormAction<T = undefined>(action: Action<T>, options: { onSuccess?: (state: FormState<T>) => void; toast?: boolean } = {}) {
  const router = useRouter()
  const { toast } = useToast()
  return useActionState<FormState<T>, FormData>(async (previous, formData) => {
    const result = await action(previous, formData)
    if (result.status === 'success') {
      if (options.toast !== false) toast({ title: result.message ?? 'Saved', variant: 'success' })
      options.onSuccess?.(result)
      router.refresh()
    } else if (result.status === 'error' && !result.fields) {
      toast({ title: result.message ?? 'Something went wrong', variant: 'error' })
    }
    return result
  }, { status: 'idle' } as FormState<T>)
}
