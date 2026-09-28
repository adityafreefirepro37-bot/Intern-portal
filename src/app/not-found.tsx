import Link from 'next/link'
import { Compass } from 'lucide-react'
import { EmptyState } from '@/components/common/states'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you’re looking for doesn’t exist or may have moved."
        action={
          <Button asChild>
            <Link href="/">Back to overview</Link>
          </Button>
        }
      />
    </main>
  )
}
