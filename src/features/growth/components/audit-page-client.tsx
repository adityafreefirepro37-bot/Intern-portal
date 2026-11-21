'use client'

import * as React from 'react'

/** Counts a view once the page has been visible for a few seconds (link scanners and previews don't count). */
export function AuditViewBeacon({ token }: { token: string }) {
  React.useEffect(() => {
    const key = `audit-viewed-${token}`
    try {
      if (sessionStorage.getItem(key)) return
    } catch {
      // Storage unavailable: still count.
    }
    const timer = setTimeout(() => {
      if (document.visibilityState !== 'visible') return
      void fetch(`/api/audit/${token}/view`, { method: 'POST', keepalive: true }).catch(() => undefined)
      try {
        sessionStorage.setItem(key, '1')
      } catch {
        // ignore
      }
    }, 4000)
    return () => clearTimeout(timer)
  }, [token])
  return null
}

export function RemoveDataButton({ token }: { token: string }) {
  const [step, setStep] = React.useState<'idle' | 'confirm' | 'busy' | 'done' | 'error'>('idle')

  async function remove() {
    setStep('busy')
    try {
      const response = await fetch(`/api/audit/${token}/remove`, { method: 'POST' })
      setStep(response.ok ? 'done' : 'error')
    } catch {
      setStep('error')
    }
  }

  if (step === 'done') return <p className="text-small font-medium">Done. Your business’s details have been removed and you won’t be contacted.</p>
  if (step === 'confirm' || step === 'busy') {
    return (
      <p className="text-small">
        Remove this audit and your business’s details, and never be contacted?{' '}
        <button type="button" onClick={remove} disabled={step === 'busy'} className="font-medium text-destructive underline">
          {step === 'busy' ? 'Removing…' : 'Yes, remove'}
        </button>{' '}
        <button type="button" onClick={() => setStep('idle')} className="text-muted-foreground underline">
          Cancel
        </button>
      </p>
    )
  }
  return (
    <p className="text-small text-muted-foreground">
      Don’t want this?{' '}
      <button type="button" onClick={() => setStep('confirm')} className="underline">
        Remove my business’s data
      </button>
      {step === 'error' && <span className="text-destructive"> Something went wrong; please try again.</span>}
    </p>
  )
}
