import { redirect } from 'next/navigation'
import { EmptyState } from '@/components/common/states'
import { requirePageContext } from '@/server/context'
import { internService } from '@/server/services/intern.service'

/** Shortcut for interns: their own profile, resolved from the session (never from a URL id). */
export default async function MyInternshipPage() {
  const ctx = await requirePageContext()
  const internId = await internService.myInternId(ctx)
  if (internId) redirect(`/interns/${internId}`)
  return <EmptyState title="No internship record" description="Your account isn’t linked to an internship." />
}
