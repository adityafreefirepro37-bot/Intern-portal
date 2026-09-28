'use client'

import * as React from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Date picker built on the native date input: fully keyboard- and
 * screen-reader-accessible, localized by the browser, and mobile-friendly.
 * Values are ISO dates (YYYY-MM-DD); validate them on the server with
 * `isoDateSchema`.
 */
export const DatePicker = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'min' | 'max'> & {
    value?: string
    onValueChange?: (value: string) => void
    min?: string
    max?: string
  }
>(({ className, value, onValueChange, ...props }, ref) => (
  <Input
    ref={ref}
    type="date"
    value={value}
    onChange={(event) => onValueChange?.(event.target.value)}
    className={cn('w-full sm:w-44 [&::-webkit-calendar-picker-indicator]:opacity-60', className)}
    {...props}
  />
))
DatePicker.displayName = 'DatePicker'
