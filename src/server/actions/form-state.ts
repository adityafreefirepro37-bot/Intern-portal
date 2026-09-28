import { toErrorBody, type FieldErrors } from '@/lib/errors'
import { logger } from '@/lib/logging'

/** State returned by form server actions (used with React's useActionState). */
export interface FormState<T = undefined> {
  status: 'idle' | 'success' | 'error'
  message?: string
  fields?: FieldErrors
  data?: T
  /** Echoed non-sensitive values so the form can be re-populated after an error. */
  values?: Record<string, string>
}

export const IDLE: FormState = { status: 'idle' }

/** Converts any error into a safe form state (no internals leak to the browser). */
export function formError(error: unknown, values?: Record<string, string>): FormState<never> {
  const { status, body } = toErrorBody(error)
  if (status >= 500) logger.error('Server action failed', { error })
  return { status: 'error', message: body.message, fields: body.fields, values }
}

/** FormData → plain object of string fields (files are excluded). */
export function formFields(formData: FormData): Record<string, string> {
  const fields: Record<string, string> = {}
  formData.forEach((value, key) => {
    if (typeof value === 'string' && !key.startsWith('$ACTION')) fields[key] = value
  })
  return fields
}

/** Removes secrets before echoing values back to the client. */
export function safeValues(fields: Record<string, string>): Record<string, string> {
  const echo: Record<string, string> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (!/password|token/i.test(key)) echo[key] = value
  }
  return echo
}
