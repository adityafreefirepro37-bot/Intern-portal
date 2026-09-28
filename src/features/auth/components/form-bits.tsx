'use client'

import * as React from 'react'
import { useFormStatus } from 'react-dom'
import { CheckCircle2, Eye, EyeOff, Loader2, TriangleAlert } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { checkPassword, PASSWORD_MAX_LENGTH } from '@/lib/auth/password-policy'
import { cn } from '@/lib/utils'

/** Success/error banner for a form, announced to screen readers. */
export function FormMessage({ status, message }: { status: 'idle' | 'success' | 'error'; message?: string }) {
  if (!message || status === 'idle') return null
  const error = status === 'error'
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-lg px-3 py-2.5 text-small',
        error ? 'bg-destructive/10 text-destructive' : 'bg-success/12 text-success',
      )}
    >
      {error ? (
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      ) : (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
      )}
      <span>{message}</span>
    </div>
  )
}

/** Submit button that shows progress while its form's action runs. */
export function SubmitButton({ children, pendingLabel, ...props }: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {pending ? (pendingLabel ?? children) : children}
    </Button>
  )
}

/** Labelled input with an optional error, wired for assistive technology. */
export function Field({
  label,
  error,
  hint,
  children,
  htmlFor,
  action,
}: {
  label: string
  error?: string
  hint?: string
  htmlFor: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={htmlFor}>{label}</Label>
        {action}
      </div>
      {children}
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="text-caption text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="text-caption font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

const STRENGTH = {
  weak: { label: 'Weak', width: '25%', className: 'bg-destructive' },
  fair: { label: 'Fair', width: '50%', className: 'bg-warning' },
  good: { label: 'Good', width: '75%', className: 'bg-info' },
  strong: { label: 'Strong', width: '100%', className: 'bg-success' },
} as const

/** Password input with a visibility toggle and (optionally) a live strength/policy check. */
export function PasswordInput({
  id,
  name,
  autoComplete,
  error,
  showStrength = false,
  minLength = 10,
  email,
  required = true,
}: {
  id: string
  name: string
  autoComplete: 'current-password' | 'new-password'
  error?: string
  showStrength?: boolean
  minLength?: number
  email?: string
  required?: boolean
}) {
  const [visible, setVisible] = React.useState(false)
  const [value, setValue] = React.useState('')
  const check = showStrength && value ? checkPassword(value, { minLength, email }) : null
  const describedBy = [error ? `${id}-error` : null, showStrength ? `${id}-strength` : null].filter(Boolean).join(' ')

  return (
    <div className="grid gap-2">
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          required={required}
          maxLength={PASSWORD_MAX_LENGTH}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          aria-controls={id}
        >
          {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </div>
      {showStrength && (
        <div id={`${id}-strength`} aria-live="polite" className="grid gap-1.5">
          <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
            {check && (
              <div
                className={cn('h-full transition-[width]', STRENGTH[check.strength].className)}
                style={{ width: STRENGTH[check.strength].width }}
              />
            )}
          </div>
          <p className="text-caption text-muted-foreground">
            {check
              ? check.valid
                ? `Strength: ${STRENGTH[check.strength].label}`
                : check.errors[0]
              : `At least ${minLength} characters. A short phrase is easier to remember and harder to guess.`}
          </p>
        </div>
      )}
    </div>
  )
}
