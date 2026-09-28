import * as React from 'react'
import { cn } from '@/lib/utils'

export const inputClassName =
  'flex h-9 w-full min-w-0 rounded-md border border-input bg-card px-3 py-1 text-body shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:outline-destructive/30 file:border-0 file:bg-transparent file:text-small file:font-medium sm:text-small'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input ref={ref} type={type} className={cn(inputClassName, className)} {...props} />
  ),
)
Input.displayName = 'Input'

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(inputClassName, 'min-h-20 h-auto py-2', className)} {...props} />
  ),
)
Textarea.displayName = 'Textarea'

export { Input, Textarea }
