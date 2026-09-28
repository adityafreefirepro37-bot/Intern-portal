'use client'

import * as React from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Toasts announce results of actions (Radix: ARIA live region, swipe/Escape
 * to dismiss, F8 to focus the viewport).
 *
 *   const { toast } = useToast()
 *   toast({ title: 'Saved', variant: 'success' })
 */
type ToastVariant = 'default' | 'success' | 'error'

interface ToastInput {
  title: string
  description?: string
  variant?: ToastVariant
}

interface ToastItem extends ToastInput {
  id: number
}

const ToastContext = React.createContext<{ toast: (input: ToastInput) => void } | null>(null)

const icons: Record<ToastVariant, React.ComponentType<{ className?: string }>> = {
  default: Info,
  success: CheckCircle2,
  error: TriangleAlert,
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([])
  const nextId = React.useRef(0)

  const toast = React.useCallback((input: ToastInput) => {
    nextId.current += 1
    const id = nextId.current
    setItems((current) => [...current.slice(-2), { ...input, id }])
  }, [])

  const value = React.useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right" duration={5000}>
        {children}
        {items.map((item) => {
          const Icon = icons[item.variant ?? 'default']
          return (
            <ToastPrimitive.Root
              key={item.id}
              type={item.variant === 'error' ? 'foreground' : 'background'}
              onOpenChange={(open) => {
                if (!open) setItems((current) => current.filter((entry) => entry.id !== item.id))
              }}
              className="flex items-start gap-3 rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg"
            >
              <Icon
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  item.variant === 'success' && 'text-success',
                  item.variant === 'error' && 'text-destructive',
                  (!item.variant || item.variant === 'default') && 'text-info',
                )}
                aria-hidden
              />
              <div className="grid flex-1 gap-0.5">
                <ToastPrimitive.Title className="text-label">{item.title}</ToastPrimitive.Title>
                {item.description && (
                  <ToastPrimitive.Description className="text-small text-muted-foreground">
                    {item.description}
                  </ToastPrimitive.Description>
                )}
              </div>
              <ToastPrimitive.Close className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                <X className="size-4" aria-hidden />
                <span className="sr-only">Dismiss</span>
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          )
        })}
        <ToastPrimitive.Viewport className="fixed bottom-20 right-4 z-[60] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2 outline-none md:bottom-4" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = React.useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside <ToastProvider>')
  return context
}
