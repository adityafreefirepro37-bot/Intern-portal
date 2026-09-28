'use client'

import { useEffect } from 'react'
import { RotateCcw } from 'lucide-react'
import { ErrorState } from '@/components/common/states'
import { Button } from '@/components/ui/button'

/**
 * Route-level error boundary. In production, server error messages are
 * replaced by Next.js with a generic message plus a digest that matches the
 * server log entry, so nothing internal is shown to the user.
 */
export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <ErrorState
      title="This page couldn’t load"
      description="Something went wrong on our side. Try again, and if it keeps happening share the reference below with the team."
      reference={error.digest}
      action={
        <Button variant="outline" onClick={() => retry()}>
          <RotateCcw aria-hidden /> Try again
        </Button>
      }
    />
  )
}
